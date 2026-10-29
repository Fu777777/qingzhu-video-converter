const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { formatFrameRate, displayCodec } = require('../src/format');
const {
  buildFfmpegArgs,
  friendlyError,
  parseOutTime,
  probeVideoFile,
  runProcess,
  startConversion,
  userError,
  validateOutputFileName,
} = require('../src/media-tools');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    child.killed = true;
    child.signalCode = 'SIGTERM';
  };
  return child;
}

async function sha256(file) {
  const data = await fs.readFile(file);
  return crypto.createHash('sha256').update(data).digest('hex');
}

// 从 PATH 查找可执行文件。Windows 上 where.exe 会返回 ffmpeg.exe 的完整路径。
async function findExecutable(name) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const { stdout } = await runProcess(locator, [name]);
    const found = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (found) return found;
  } catch {
    // where/which 不在 PATH 里时，下面仍用命令名，让系统继续查找。
  }
  return name;
}

async function writeFakeFfmpeg(dir) {
  const file = path.join(dir, 'fake-ffmpeg.js');
  await fs.writeFile(file, 'process.exit(1);\n');
  return file;
}

async function inspectMedia(file) {
  const probeTool = await findExecutable('ffprobe');
  const { stdout } = await runProcess(probeTool, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
  const data = JSON.parse(stdout);
  return {
    duration: Number(data.format?.duration),
    video: data.streams.find((stream) => stream.codec_type === 'video'),
    audio: data.streams.find((stream) => stream.codec_type === 'audio'),
  };
}

describe('纯逻辑', () => {
  test('进度时间遇到 N/A 或残缺值时不产生数字', () => {
    assert.equal(parseOutTime('N/A'), null);
    assert.equal(parseOutTime(''), null);
    assert.equal(parseOutTime('1:2'), null);
    assert.equal(parseOutTime('00:00:01.500000'), 1.5);
    assert.equal(parseOutTime('01:02:03'), 3723);
  });

  test('输出文件名保留中间的点，并拒绝路径和 Windows 非法名称', () => {
    assert.equal(validateOutputFileName('假期.海边', 'mp4'), '假期.海边.mp4');
    assert.equal(validateOutputFileName('假期.海边.mp4', 'webm'), '假期.海边.webm');
    assert.equal(validateOutputFileName('  示例 视频  ', 'mov'), '示例 视频.mov');
    assert.throws(() => validateOutputFileName('文件夹/视频', 'mp4'), /路径符号/);
    assert.throws(() => validateOutputFileName('视频*最终', 'mp4'), /不允许的字符/);
    assert.throws(() => validateOutputFileName('CON', 'mp4'), /保留名称/);
    assert.throws(() => validateOutputFileName('视频.', 'mkv'), /句点结尾/);
    assert.throws(() => validateOutputFileName('   ', 'mp4'), /请输入输出文件名/);
    assert.throws(() => validateOutputFileName('视频', 'gif'), /不支持该输出格式/);
  });

  test('FFmpeg 参数是数组，用户路径单独占一项', () => {
    const input = '/资料/我的 视频/示例.mp4';
    const tempPath = '/输出 目录/.示例.partial.mp4';
    const args = buildFfmpegArgs({ input, tempPath, format: 'mp4', quality: 'high' });
    assert.equal(Array.isArray(args), true);
    assert.equal(args.includes(input), true);
    assert.equal(args.at(-1), tempPath);
    assert.equal(args.includes('-n'), true);
    assert.equal(args.includes('libx264'), true);
    assert.equal(typeof args.join, 'function');
    assert.equal(args.some((item) => item.includes('&&') || item.includes(';')), false);
  });

  test('常见错误会转成中文说明', () => {
    const missing = new Error('spawn ffmpeg ENOENT');
    missing.code = 'ENOENT';
    missing.command = 'ffmpeg';
    assert.match(friendlyError(missing), /未找到 FFmpeg 或 FFprobe/);
    assert.match(friendlyError(Object.assign(new Error('no space'), { code: 'ENOSPC' })), /磁盘空间不足/);
    assert.match(friendlyError(Object.assign(new Error('exists'), { code: 'EEXIST' })), /未覆盖原文件/);
    assert.match(friendlyError(new Error('Invalid data found when processing input')), /损坏或格式不受支持/);
    assert.match(friendlyError(new Error('Unknown encoder libx264')), /缺少所需编码器/);
    assert.match(friendlyError(new Error('No such file or directory')), /保存文件夹有效/);
    assert.equal(friendlyError(userError('转换已取消。')), '转换已取消。');
  });

  test('假 ffmpeg 脚本由当前 Node 启动并返回失败', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qingzhu-fake-'));
    try {
      const fakeFfmpeg = await writeFakeFfmpeg(dir);
      await assert.rejects(
        () => runProcess(fakeFfmpeg, ['-i', '中文 路径.mp4']),
        /退出，代码 1/,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('启动进程时关闭 shell，路径不会被拼进命令', async (t) => {
    const child = fakeChild();
    let captured;
    t.mock.method(childProcess, 'spawn', (command, args, options) => {
      captured = { command, args, options };
      process.nextTick(() => child.emit('close', 0));
      return child;
    });
    const input = '/tmp/轻转 测试/示例 视频.mp4';
    await runProcess('ffprobe', ['-v', 'error', input]);
    assert.equal(captured.options.shell, false);
    assert.deepEqual(captured.args, ['-v', 'error', input]);
  });
});

describe('真实 FFmpeg', { concurrency: 1, timeout: 180000 }, () => {
  let root;
  let sample;
  let outputDir;
  let ffmpeg;
  let ffprobe;

  before(async () => {
    ffmpeg = await findExecutable('ffmpeg');
    ffprobe = await findExecutable('ffprobe');
    try {
      await runProcess(ffmpeg, ['-version']);
      await runProcess(ffprobe, ['-version']);
    } catch (error) {
      throw new Error(`测试需要 PATH 中的 ffmpeg 和 ffprobe。${error.message}`);
    }
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'qingzhu-media-'));
    const sourceDir = path.join(root, '轻转 测试');
    outputDir = path.join(root, '输出 目录');
    await fs.mkdir(sourceDir);
    await fs.mkdir(outputDir);
    sample = path.join(sourceDir, '示例 视频.mp4');
    await runProcess(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
      '-t', '1', '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      sample,
    ]);
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  test('读取中文和空格路径中的视频信息与缩略图', async () => {
    const info = await probeVideoFile({ filePath: sample, ffprobePath: ffprobe, ffmpegPath: ffmpeg, tempDir: root });
    assert.equal(info.name, '示例 视频.mp4');
    assert.equal(info.width, 640);
    assert.equal(info.height, 360);
    assert.equal(info.codec, 'h264');
    assert.equal(displayCodec(info.codec), 'H.264');
    assert.equal(formatFrameRate(info.frameRate), '24 fps');
    assert.ok(info.duration > 0.5 && info.duration < 2);
    assert.ok(info.size > 0);
    assert.equal(info.outputName, '示例 视频_已转换');
    assert.match(info.thumbnail, /^data:image\/jpeg;base64,/);
    const bytes = Buffer.from(info.thumbnail.split(',')[1], 'base64');
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.equal(info.thumbnailError, null);
    const leftovers = (await fs.readdir(root)).filter((name) => name.endsWith('.jpg'));
    assert.equal(leftovers.length, 0);
  });

  test('缩略图失败时仍返回视频信息，并给出明确原因', async () => {
    const fakeFfmpeg = await writeFakeFfmpeg(root);
    const info = await probeVideoFile({ filePath: sample, ffprobePath: ffprobe, ffmpegPath: fakeFfmpeg, tempDir: root });
    assert.equal(info.thumbnail, null);
    assert.match(info.thumbnailError, /缩略图提取失败/);
    assert.equal(info.width, 640);
    assert.equal(info.codec, 'h264');
  });

  test('无效输入有明确中文提示', async () => {
    const emptyFile = path.join(root, '空文件.mp4');
    const textFile = path.join(root, '笔记.txt');
    const folder = path.join(root, '一个文件夹');
    await fs.writeFile(emptyFile, '');
    await fs.writeFile(textFile, '这不是视频');
    await fs.mkdir(folder);
    await assert.rejects(() => probeVideoFile({ filePath: emptyFile, ffprobePath: ffprobe, ffmpegPath: ffmpeg, tempDir: root }), /空的/);
    await assert.rejects(() => probeVideoFile({ filePath: textFile, ffprobePath: ffprobe, ffmpegPath: ffmpeg, tempDir: root }), /损坏或格式不受支持|没有可读取的视频画面/);
    await assert.rejects(() => probeVideoFile({ filePath: folder, ffprobePath: ffprobe, ffmpegPath: ffmpeg, tempDir: root }), /文件夹/);
    await assert.rejects(() => probeVideoFile({ filePath: path.join(root, '不存在.mp4'), ffprobePath: ffprobe, ffmpegPath: ffmpeg, tempDir: root }), /找不到这个视频文件/);
    await assert.rejects(() => probeVideoFile({ filePath: sample, ffprobePath: null, ffmpegPath: null, tempDir: root }), /未找到 FFmpeg 或 FFprobe/);
  });

  test('转换中文路径和带空格路径，输出可用 ffprobe 重新读取', async () => {
    const expectations = {
      mp4: { video: 'h264', audio: 'aac' },
      mov: { video: 'h264', audio: 'aac' },
      mkv: { video: 'h264', audio: 'aac' },
      webm: { video: 'vp9', audio: 'opus' },
    };
    for (const [format, expected] of Object.entries(expectations)) {
      const job = await startConversion({
        ffmpegPath: ffmpeg,
        input: sample,
        outputDir,
        outputName: `示例 视频_${format}`,
        format,
        quality: 'small',
      });
      const result = await job.done;
      assert.equal(result.outputPath, path.join(outputDir, `示例 视频_${format}.${format}`));
      const media = await inspectMedia(result.outputPath);
      assert.equal(media.video.codec_name, expected.video);
      assert.equal(media.audio.codec_name, expected.audio);
      assert.equal(media.video.width, 640);
      assert.equal(media.video.height, 360);
      assert.ok(media.duration > 0.5 && media.duration < 2);
      const leftovers = (await fs.readdir(outputDir)).filter((name) => name.includes('.partial'));
      assert.deepEqual(leftovers, []);
    }
  });

  test('带点和特殊符号的文件名按原样保存', async () => {
    const job = await startConversion({
      ffmpegPath: ffmpeg,
      input: sample,
      outputDir,
      outputName: '假期.海边 $5',
      format: 'mp4',
      quality: 'small',
    });
    const result = await job.done;
    assert.equal(path.basename(result.outputPath), '假期.海边 $5.mp4');
    const media = await inspectMedia(result.outputPath);
    assert.equal(media.video.codec_name, 'h264');
  });

  test('目标已存在时不覆盖', async () => {
    const existing = path.join(outputDir, '不能覆盖.mp4');
    await fs.writeFile(existing, '保留这个文件');
    const before = await sha256(existing);
    await assert.rejects(() => startConversion({
      ffmpegPath: ffmpeg,
      input: sample,
      outputDir,
      outputName: '不能覆盖',
      format: 'mp4',
      quality: 'small',
    }), /未覆盖原文件/);
    assert.equal(await sha256(existing), before);
    assert.equal(await fs.readFile(existing, 'utf8'), '保留这个文件');
  });

  test('保存位置不存在、不是文件夹或不可写时给出明确提示', async () => {
    const base = {
      ffmpegPath: ffmpeg,
      input: sample,
      outputName: '结果',
      format: 'mp4',
      quality: 'small',
    };
    await assert.rejects(() => startConversion({ ...base, outputDir: path.join(root, '没有这个目录') }), /保存位置不存在/);
    const notDirectory = path.join(root, '其实是文件');
    await fs.writeFile(notDirectory, 'file');
    await assert.rejects(() => startConversion({ ...base, outputDir: notDirectory }), /不是文件夹/);
    const locked = path.join(root, '只读目录');
    await fs.mkdir(locked);
    await fs.chmod(locked, 0o555);
    try {
      await assert.rejects(() => startConversion({ ...base, outputDir: locked }), /没有权限写入保存位置/);
    } finally {
      await fs.chmod(locked, 0o755);
    }
  });

  test('缺少 FFmpeg 时不会开始写入', async () => {
    await assert.rejects(() => startConversion({
      ffmpegPath: '',
      input: sample,
      outputDir,
      outputName: '没有引擎',
      format: 'mp4',
      quality: 'small',
    }), /未找到 FFmpeg/);
    const missing = await startConversion({
      ffmpegPath: path.join(root, 'missing-ffmpeg'),
      input: sample,
      outputDir,
      outputName: '没有引擎',
      format: 'mp4',
      quality: 'small',
    });
    await assert.rejects(() => missing.done, /未找到 FFmpeg/);
    assert.equal((await fs.readdir(outputDir)).includes('没有引擎.mp4'), false);
  });

  test('取消转换后不留下最终文件和临时文件', async () => {
    const longDir = path.join(root, '长视频');
    await fs.mkdir(longDir);
    const longVideo = path.join(longDir, '长 视频.mp4');
    await runProcess(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '20', '-shortest',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      longVideo,
    ]);
    const cancelDir = path.join(root, '取消输出');
    await fs.mkdir(cancelDir);
    const job = await startConversion({
      ffmpegPath: ffmpeg,
      input: longVideo,
      outputDir: cancelDir,
      outputName: '不应留下',
      format: 'mp4',
      quality: 'high',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    job.cancel();
    await assert.rejects(() => job.done, /转换已取消/);
    const names = await fs.readdir(cancelDir);
    assert.equal(names.some((name) => name.includes('不应留下')), false);
    assert.equal(names.some((name) => name.includes('.partial')), false);
    await assert.rejects(() => fs.stat(job.tempPath), (error) => error.code === 'ENOENT');
  });

  test('进度里的 N/A 不会被当成百分比', async (t) => {
    const child = fakeChild();
    const samples = [];
    t.mock.method(childProcess, 'spawn', () => child);
    const job = await startConversion({
      ffmpegPath: ffmpeg,
      input: sample,
      outputDir,
      outputName: '进度样本',
      format: 'mp4',
      quality: 'small',
      onProgress: ({ elapsed }) => samples.push(elapsed),
    });
    child.stdout.emit('data', Buffer.from('out_time=N/A\nout_time=00:00:01.250000\nout_time=坏值\n'));
    child.emit('close', 1);
    await assert.rejects(() => job.done);
    assert.deepEqual(samples, [1.25]);
    assert.equal((await fs.readdir(outputDir)).includes('进度样本.mp4'), false);
  });
});
