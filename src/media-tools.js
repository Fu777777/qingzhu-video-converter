const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');
const publishOutput = require('./publish-output');

const FORMATS = {
  mp4: { video: 'libx264', audio: 'aac', ext: '.mp4' },
  mov: { video: 'libx264', audio: 'aac', ext: '.mov' },
  mkv: { video: 'libx264', audio: 'aac', ext: '.mkv' },
  webm: { video: 'libvpx-vp9', audio: 'libopus', ext: '.webm' },
};

const KNOWN_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpeg', 'mpg', '3gp', 'wmv', 'flv'];
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function userError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

function friendlyError(error) {
  if (error?.userMessage) return error.userMessage;
  const message = error?.message || String(error);
  if (['EACCES', 'EPERM'].includes(error?.code)) return '没有权限读取输入文件或写入目标位置，请更换文件或输出文件夹。';
  if (error?.code === 'ENOSPC') return '磁盘空间不足，请清理空间后重试。';
  if (error?.code === 'EEXIST' || /already exists|not overwriting|File exists/i.test(message)) {
    return '目标文件已存在，未覆盖原文件。请修改文件名或选择其他位置。';
  }
  const missingCommand = path.basename(error?.command || error?.path || '').replace(/\.exe$/i, '').toLowerCase();
  if (['ffmpeg', 'ffprobe'].includes(missingCommand) || /无法启动 .*?(ffmpeg|ffprobe)|(?:ffmpeg|ffprobe)(?:\.exe)?\s+not found|not recognized/i.test(message)) {
    return '未找到 FFmpeg 或 FFprobe。请先安装 FFmpeg，并将其加入系统 PATH 后重启应用。';
  }
  if (/permission|denied|拒绝访问/i.test(message)) return '没有权限读取输入文件或写入目标位置，请更换文件或输出文件夹。';
  if (/No space left|disk full|磁盘空间/i.test(message)) return '磁盘空间不足，请清理空间后重试。';
  if (/Invalid data|Invalid argument|moov atom not found|does not contain any stream|Invalid data found/i.test(message)) {
    return '无法读取该视频，文件可能损坏或格式不受支持。请尝试其他视频文件。';
  }
  if (/No such file|does not exist/i.test(message)) return '找不到需要的文件。请确认视频还在原位置，并且保存文件夹有效。';
  if (/Unknown encoder|encoder .* not found|Error initializing output stream/i.test(message)) {
    return '当前 FFmpeg 缺少所需编码器。请安装包含 H.264/AAC（或 WebM 所需 VP9/Opus）的版本后重试。';
  }
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const usefulLine = [...lines].reverse().find((line) => /error|failed|invalid|denied|space left|already exists/i.test(line));
  return (usefulLine || lines.at(-1) || '操作失败，请重试。').slice(0, 240);
}

// 参数数组启动，并强制关闭 shell，避免用户路径被拼进命令字符串。
function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { ...options, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr = (stderr + data.toString()).slice(-8000); });
    child.once('error', (error) => {
      const wrapped = new Error(`无法启动 ${path.basename(command)}：${error.message}`);
      wrapped.code = error.code;
      wrapped.command = path.basename(command);
      reject(wrapped);
    });
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${path.basename(command)} 退出，代码 ${code}`));
    });
  });
}

function parseOutTime(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().toUpperCase() === 'N/A') return null;
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const elapsed = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(elapsed) ? elapsed : null;
}

function stripKnownExtension(name) {
  const pattern = new RegExp(`\\.(${KNOWN_EXTENSIONS.join('|')})$`, 'i');
  return name.replace(pattern, '');
}

function validateOutputFileName(outputName, format) {
  const profile = FORMATS[format];
  if (!profile) throw userError('不支持该输出格式。');
  if (typeof outputName !== 'string') throw userError('请输入输出文件名。');
  const trimmed = outputName.trim();
  if (!trimmed) throw userError('请输入输出文件名。');
  if (/[\\/]/.test(trimmed)) throw userError('文件名不能包含路径符号（/ 或 \\）。请只填写文件名。');
  const base = stripKnownExtension(trimmed);
  if (!base || base === '.' || base === '..') throw userError('请输入有效的输出文件名。');
  if (/[<>:"|?*\u0000-\u001F]/.test(base)) throw userError('文件名包含 Windows 不允许的字符（\\ / : * ? " < > |）。请修改后再转换。');
  if (/[. ]$/.test(base)) throw userError('文件名不能以空格或句点结尾，请修改后再转换。');
  if (WINDOWS_RESERVED.test(base)) throw userError('这个文件名是 Windows 保留名称，请换一个名称。');
  if (base.length > 180) throw userError('文件名过长，请缩短到 180 个字符以内。');
  return `${base}${profile.ext}`;
}

function isInsideDirectory(directory, target) {
  const relative = path.relative(path.resolve(directory), path.resolve(target));
  if (!relative || path.isAbsolute(relative)) return false;
  return !relative.split(path.sep).includes('..');
}

function samePath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (process.platform === 'win32') return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  return resolvedLeft === resolvedRight;
}

async function assertReadableVideo(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw userError('请选择一个视频文件。');
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw userError('找不到这个视频文件，请确认它还在原来的位置。');
    if (error.code === 'EACCES' || error.code === 'EPERM') throw userError('没有权限读取这个视频文件，请更换文件或检查权限。');
    throw error;
  }
  if (stat.isDirectory()) throw userError('选择的是文件夹，请改为选择视频文件。');
  if (!stat.isFile()) throw userError('无法读取这个路径，请选择视频文件。');
  if (stat.size === 0) throw userError('这个文件是空的，请选择有效的视频文件。');
  return stat;
}

async function assertOutputDirectory(outputDir) {
  if (typeof outputDir !== 'string' || !outputDir.trim()) throw userError('请选择保存位置。');
  let stat;
  try {
    stat = await fs.stat(outputDir);
  } catch (error) {
    if (error.code === 'ENOENT') throw userError('保存位置不存在，请重新选择文件夹。');
    if (error.code === 'EACCES' || error.code === 'EPERM') throw userError('没有权限使用这个保存位置，请更换文件夹。');
    throw error;
  }
  if (!stat.isDirectory()) throw userError('保存位置不是文件夹，请重新选择。');
  try {
    await fs.access(outputDir, fsConstants.W_OK | fsConstants.X_OK);
  } catch {
    throw userError('没有权限写入保存位置，请更换文件夹。');
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function probeVideoFile({ filePath, ffprobePath, ffmpegPath, tempDir }) {
  if (!ffprobePath || !ffmpegPath) {
    throw userError('未找到 FFmpeg 或 FFprobe。请先安装 FFmpeg，并将其加入系统 PATH 后重启应用。');
  }
  if (typeof tempDir !== 'string' || !tempDir.trim()) throw userError('无法创建临时预览文件，请检查系统临时目录。');
  const stat = await assertReadableVideo(filePath);
  let data;
  try {
    const { stdout } = await runProcess(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath]);
    data = JSON.parse(stdout);
  } catch (error) {
    if (error instanceof SyntaxError) throw userError('无法读取该视频的信息，文件可能损坏或格式不受支持。');
    if (error.userMessage) throw error;
    throw userError(friendlyError(error));
  }

  const video = (data.streams || []).find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  if (!video) throw userError('这个文件里没有可读取的视频画面，请选择视频文件。');

  const durationNumber = Number(data.format?.duration);
  const duration = Number.isFinite(durationNumber) && durationNumber > 0 ? durationNumber : null;
  const codec = typeof video.codec_name === 'string' && video.codec_name.trim() ? video.codec_name.trim() : null;
  const parsed = path.parse(filePath);
  const result = {
    path: filePath,
    name: parsed.base,
    size: stat.size,
    duration,
    width: positiveInteger(video.width),
    height: positiveInteger(video.height),
    codec,
    frameRate: typeof video.avg_frame_rate === 'string' && video.avg_frame_rate ? video.avg_frame_rate : (video.r_frame_rate || ''),
    thumbnail: null,
    thumbnailError: null,
    outputDir: parsed.dir,
    outputName: `${parsed.name}_已转换`,
  };

  const thumbPath = path.join(tempDir, `qingzhu-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  try {
    const seek = duration ? Math.max(0, Math.min(duration * 0.1, Math.max(0, duration - 0.5))) : 0;
    await runProcess(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(seek), '-i', filePath, '-frames:v', '1', '-vf', 'scale=640:-2', '-y', thumbPath]);
    const bytes = await fs.readFile(thumbPath);
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      result.thumbnailError = '缩略图提取失败，视频信息仍可查看，也可以继续转换。';
    } else {
      result.thumbnail = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    }
  } catch {
    result.thumbnailError = '缩略图提取失败，视频信息仍可查看，也可以继续转换。';
  } finally {
    await fs.rm(thumbPath, { force: true }).catch(() => {});
  }
  return result;
}

function buildFfmpegArgs({ input, tempPath, format, quality }) {
  const profile = FORMATS[format];
  if (!profile) throw userError('不支持该输出格式。');
  const safeQuality = quality === 'high' || quality === 'small' ? quality : 'balanced';
  const args = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', input, '-c:v', profile.video];
  if (format === 'webm') {
    const crf = safeQuality === 'small' ? '38' : safeQuality === 'high' ? '28' : '33';
    args.push('-crf', crf, '-b:v', '0', '-deadline', 'good', '-cpu-used', '4');
  } else {
    const crf = safeQuality === 'small' ? '28' : safeQuality === 'high' ? '18' : '23';
    args.push('-preset', 'medium', '-crf', crf);
  }
  args.push('-c:a', profile.audio, '-b:a', format === 'webm' ? '128k' : '192k', '-n', tempPath);
  return args;
}

function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill(); } catch { /* 进程可能已经退出。 */ }
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch { /* 强行结束失败时由退出流程继续清理。 */ }
    }
  }, 3000);
  if (typeof timer.unref === 'function') timer.unref();
  child.once('close', () => clearTimeout(timer));
}

async function startConversion({ ffmpegPath, input, outputDir, outputName, format, quality, onProgress }) {
  if (!FORMATS[format]) throw userError('不支持该输出格式。');
  if (!ffmpegPath) throw userError('未找到 FFmpeg。请先安装 FFmpeg，并将其加入系统 PATH 后重启应用。');
  const fileName = validateOutputFileName(outputName, format);
  await assertReadableVideo(input);
  await assertOutputDirectory(outputDir);
  const outputPath = path.join(outputDir, fileName);
  if (!isInsideDirectory(outputDir, outputPath)) throw userError('输出路径无效，请修改文件名或保存位置。');
  if (samePath(input, outputPath)) throw userError('输出文件不能与原视频相同，请修改文件名或保存位置。');
  try {
    await fs.stat(outputPath);
    throw userError('目标文件已存在，未覆盖原文件。请修改文件名或选择其他位置。');
  } catch (error) {
    if (error.userMessage) throw error;
    if (error.code !== 'ENOENT') throw userError(friendlyError(error));
  }

  const extension = FORMATS[format].ext;
  const tempPath = path.join(
    outputDir,
    `.${path.basename(fileName, extension)}-${Date.now()}-${Math.random().toString(16).slice(2)}.partial${extension}`,
  );
  const args = buildFfmpegArgs({ input, tempPath, format, quality });
  const child = childProcess.spawn(ffmpegPath, args, { windowsHide: true, shell: false });
  const state = { cancelled: false };
  let stderr = '';
  let buffer = '';
  let settled = false;

  let resolve;
  let reject;
  const done = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  const cleanup = () => fs.rm(tempPath, { force: true }).catch(() => {});
  const finish = (handler) => {
    if (settled) return;
    settled = true;
    Promise.resolve()
      .then(handler)
      .then((result) => cleanup().then(() => result))
      .then(resolve, (error) => cleanup().then(() => {
        reject(error?.userMessage ? error : new Error(friendlyError(error)));
      }));
  };

  child.stdout?.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const separator = line.indexOf('=');
      if (separator === -1 || line.slice(0, separator) !== 'out_time') continue;
      const elapsed = parseOutTime(line.slice(separator + 1));
      if (elapsed != null && typeof onProgress === 'function') onProgress({ elapsed });
    }
  });
  child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-8000); });
  child.once('error', (error) => {
    if (error.code === 'ENOENT') {
      finish(() => { throw userError('未找到 FFmpeg。请先安装 FFmpeg，并将其加入系统 PATH 后重启应用。'); });
      return;
    }
    const wrapped = new Error(`无法启动 FFmpeg：${error.message}`);
    wrapped.code = error.code;
    wrapped.command = 'ffmpeg';
    finish(() => { throw wrapped; });
  });
  child.once('close', (code) => {
    finish(async () => {
      if (state.cancelled) throw userError('转换已取消。');
      if (code !== 0) throw new Error(stderr.trim() || `FFmpeg 退出，代码 ${code}`);
      const stat = await fs.stat(tempPath).catch((error) => {
        if (error.code === 'ENOENT') throw userError('转换结束，但没有生成有效的视频文件。请更换格式或检查源视频。');
        throw error;
      });
      if (!stat.isFile() || stat.size <= 0) throw userError('转换结束，但没有生成有效的视频文件。请更换格式或检查源视频。');
      await publishOutput(tempPath, outputPath);
      return { outputPath, size: stat.size };
    });
  });

  return {
    done,
    tempPath,
    outputPath,
    quitRequested: false,
    cancel() {
      state.cancelled = true;
      stopProcess(child);
    },
  };
}

module.exports = {
  FORMATS,
  userError,
  friendlyError,
  runProcess,
  parseOutTime,
  validateOutputFileName,
  probeVideoFile,
  buildFfmpegArgs,
  startConversion,
};
