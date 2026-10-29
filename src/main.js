const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const publishOutput = require('./publish-output');

let mainWindow;
let activeConversion = null;
const appPageUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;

const FORMATS = {
  mp4: { video: 'libx264', audio: 'aac', ext: '.mp4' },
  mov: { video: 'libx264', audio: 'aac', ext: '.mov' },
  mkv: { video: 'libx264', audio: 'aac', ext: '.mkv' },
  webm: { video: 'libvpx-vp9', audio: 'libopus', ext: '.webm' },
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 790,
    minWidth: 860,
    minHeight: 680,
    title: '轻转视频',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    show: false,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== appPageUrl) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.senderFrame?.url !== appPageUrl) throw new Error('拒绝来自非应用页面的请求。');
    return handler(event, ...args);
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    child.once('error', (error) => reject(new Error(`无法启动 ${command}：${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} 退出，代码 ${code}`));
    });
  });
}

async function findTool(name) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const { stdout } = await run(command, [name]);
    return stdout.split(/\r?\n/).find(Boolean)?.trim() || name;
  } catch {
    return null;
  }
}

function friendlyError(error) {
  const message = error?.message || String(error);
  if (['EACCES', 'EPERM'].includes(error?.code)) return '没有权限读取输入文件或写入目标位置，请更换文件或输出文件夹。';
  if (error?.code === 'ENOSPC') return '磁盘空间不足，请清理空间后重试。';
  if (/already exists|not overwriting|File exists/i.test(message)) return '目标文件已存在，请修改文件名或选择其他位置。';
  if (error?.code === 'ENOENT' || /无法启动 (ffmpeg|ffprobe):|not recognized/i.test(message)) {
    return '未找到 FFmpeg 或 FFprobe。请先安装 FFmpeg，并将其加入系统 PATH 后重启应用。';
  }
  if (/permission|denied|拒绝访问/i.test(message)) return '没有权限读取输入文件或写入目标位置，请更换文件或输出文件夹。';
  if (/No space left|disk full|磁盘空间/i.test(message)) return '磁盘空间不足，请清理空间后重试。';
  if (/Invalid data|Invalid argument|moov atom not found|does not contain any stream/i.test(message)) {
    return '无法读取该视频，文件可能损坏或格式不受支持。请尝试其他视频文件。';
  }
  if (/No such file|does not exist/i.test(message)) return '找不到输入视频或相关文件，请重新选择视频并检查文件是否仍在原位置。';
  if (/Unknown encoder|encoder .* not found|Error initializing output stream/i.test(message)) {
    return '当前 FFmpeg 缺少所需编码器。请安装包含 H.264/AAC（或 WebM 所需 VP9/Opus）的版本后重试。';
  }
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const usefulLine = [...lines].reverse().find((line) => /error|failed|invalid|denied|space left|already exists/i.test(line));
  return (usefulLine || lines.at(-1) || message).slice(0, 240);
}

registerHandler('video:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频',
    properties: ['openFile'],
    filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpeg', 'mpg', '3gp', 'wmv', 'flv'] }, { name: '所有文件', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

registerHandler('video:output-folder', async (_event, currentPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择输出文件夹',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: currentPath || app.getPath('videos'),
  });
  return result.canceled ? null : result.filePaths[0];
});

registerHandler('video:probe', async (_event, filePath) => {
  try {
    const ffprobe = await findTool('ffprobe');
    const ffmpeg = await findTool('ffmpeg');
    if (!ffprobe || !ffmpeg) throw new Error('FFmpeg/FFprobe not found');
    const { stdout } = await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath]);
    const data = JSON.parse(stdout);
    const video = data.streams?.find((stream) => stream.codec_type === 'video');
    if (!video) throw new Error('does not contain any stream');
    const stat = await fs.stat(filePath);
    const thumbPath = path.join(app.getPath('temp'), `qingzhu-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
    try {
      const duration = Number(data.format?.duration || 0);
      const seek = Math.max(0, Math.min(duration * 0.1, Math.max(0, duration - 0.5)));
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(seek), '-i', filePath, '-frames:v', '1', '-vf', 'scale=640:-2', '-y', thumbPath]);
      const thumbnail = `data:image/jpeg;base64,${(await fs.readFile(thumbPath)).toString('base64')}`;
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        duration,
        width: video.width || null,
        height: video.height || null,
        codec: video.codec_name || '未知',
        frameRate: video.avg_frame_rate || video.r_frame_rate || '',
        thumbnail,
        outputDir: path.dirname(filePath),
        outputName: `${path.parse(filePath).name}_converted.mp4`,
      };
    } finally {
      await fs.rm(thumbPath, { force: true }).catch(() => {});
    }
  } catch (error) {
    throw new Error(friendlyError(error));
  }
});

registerHandler('video:check-tools', async () => {
  const [ffmpeg, ffprobe] = await Promise.all([findTool('ffmpeg'), findTool('ffprobe')]);
  return { ready: Boolean(ffmpeg && ffprobe), ffmpeg: Boolean(ffmpeg), ffprobe: Boolean(ffprobe) };
});

registerHandler('video:convert', async (event, options) => {
  if (activeConversion) throw new Error('已有转换任务正在进行。');
  const { input, outputDir, outputName, format, quality } = options;
  const profile = FORMATS[format];
  if (!profile) throw new Error('不支持该输出格式。');
  const safeName = path.basename(String(outputName || '')).trim();
  if (!safeName) throw new Error('请输入输出文件名。');
  const outputPath = path.join(outputDir, safeName.replace(/\.[^.]+$/, '') + profile.ext);
  const tempPath = path.join(outputDir, `.${path.basename(outputPath, profile.ext)}-${Date.now()}-${Math.random().toString(16).slice(2)}.partial${profile.ext}`);
  if (path.resolve(input) === path.resolve(outputPath)) throw new Error('输出文件不能与原视频相同。');
  try {
    await fs.access(outputPath);
    throw new Error('同名文件已存在，请修改文件名或选择其他位置。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const ffmpeg = await findTool('ffmpeg');
  if (!ffmpeg) throw new Error('未找到 FFmpeg。请先安装 FFmpeg，并将其加入系统 PATH 后重启应用。');
  const crf = quality === 'small' ? '28' : quality === 'high' ? '18' : '23';
  const args = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', input, '-c:v', profile.video];
  if (format === 'webm') args.push('-crf', quality === 'small' ? '38' : quality === 'high' ? '28' : '33', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4');
  else args.push('-preset', 'medium', '-crf', crf);
  args.push('-c:a', profile.audio, '-b:a', format === 'webm' ? '128k' : '192k', '-n', tempPath);

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    const conversion = { child, cancelled: false, tempPath };
    activeConversion = conversion;
    let buffer = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const [key, value] = line.split('=', 2);
        if (key === 'out_time' && value) {
          const parts = value.split(':').map(Number);
          const elapsed = parts[0] * 3600 + parts[1] * 60 + parts[2];
          if (!event.sender.isDestroyed()) event.sender.send('video:progress', { elapsed });
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      activeConversion = null;
      void fs.rm(tempPath, { force: true }).catch(() => {});
      reject(new Error(friendlyError(error)));
    });
    child.once('close', async (code) => {
      activeConversion = null;
      if (code === 0) {
        try {
          const stat = await fs.stat(tempPath);
          // Publish only after the encode succeeds and never replace a file
          // that appeared after the initial existence check.
          await publishOutput(tempPath, outputPath);
          await fs.rm(tempPath, { force: true }).catch(() => {});
          resolve({ outputPath, size: stat.size });
        } catch (error) {
          await fs.rm(tempPath, { force: true }).catch(() => {});
          reject(new Error(friendlyError(error)));
        }
      } else {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        if (conversion.cancelled) reject(new Error('转换已取消。'));
        else reject(new Error(friendlyError(new Error(stderr.trim() || `FFmpeg 退出，代码 ${code}`))));
      }
    });
  });
});

registerHandler('video:cancel', () => {
  if (activeConversion) {
    activeConversion.cancelled = true;
    activeConversion.child.kill();
  }
});
registerHandler('video:open-path', async (_event, targetPath) => shell.openPath(targetPath));
registerHandler('video:reveal', async (_event, targetPath) => shell.showItemInFolder(targetPath));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (activeConversion) activeConversion.child.kill(); });
