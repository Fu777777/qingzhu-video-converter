const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const publishOutput = require('../src/publish-output');

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'qingzhu-publish-'));
}

test('发布成功后目标文件与临时文件内容一致', async () => {
  const dir = await tempDir();
  const temp = path.join(dir, '临时.partial.mp4');
  const output = path.join(dir, '结果 视频.mp4');
  await fs.writeFile(temp, '视频内容');
  await publishOutput(temp, output);
  const [tempStat, outputStat] = await Promise.all([fs.stat(temp), fs.stat(output)]);
  assert.equal(tempStat.ino, outputStat.ino);
  assert.equal(await fs.readFile(output, 'utf8'), '视频内容');
  await fs.rm(dir, { recursive: true, force: true });
});

test('目标已存在时拒绝发布并保留原内容', async () => {
  const dir = await tempDir();
  const temp = path.join(dir, '新文件.partial.mp4');
  const output = path.join(dir, '已有文件.mp4');
  await fs.writeFile(temp, '新的内容');
  await fs.writeFile(output, '原来的内容');
  await assert.rejects(() => publishOutput(temp, output), (error) => error.code === 'EEXIST');
  assert.equal(await fs.readFile(output, 'utf8'), '原来的内容');
  await fs.rm(dir, { recursive: true, force: true });
});

test('不能硬链接时改为复制，失败则不留下目标文件', async (t) => {
  const dir = await tempDir();
  const output = path.join(dir, '复制结果.mp4');
  const temp = path.join(dir, '源.partial.mp4');
  t.mock.method(fs, 'link', async () => {
    const error = new Error('EXDEV, link');
    error.code = 'EXDEV';
    throw error;
  });

  await fs.writeFile(temp, '复制后的内容');
  await publishOutput(temp, output);
  assert.equal(await fs.readFile(output, 'utf8'), '复制后的内容');
  const [tempStat, outputStat] = await Promise.all([fs.stat(temp), fs.stat(output)]);
  assert.notEqual(tempStat.ino, outputStat.ino);

  const missing = path.join(dir, '不存在.partial.mp4');
  const failedOutput = path.join(dir, '失败结果.mp4');
  await assert.rejects(() => publishOutput(missing, failedOutput));
  await assert.rejects(() => fs.stat(failedOutput), (error) => error.code === 'ENOENT');
  await fs.rm(dir, { recursive: true, force: true });
});
