const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration, formatSize, formatFrameRate, displayCodec } = require('../src/format');

test('时长、大小、帧率和编码读不到时显示未知', () => {
  assert.equal(formatDuration(0), '未知');
  assert.equal(formatDuration(Number.NaN), '未知');
  assert.equal(formatDuration(null), '未知');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3661), '1:01:01');

  assert.equal(formatSize(Number.NaN), '未知');
  assert.equal(formatSize(-1), '未知');
  assert.equal(formatSize(400), '400 字节');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(5 * 1024 * 1024), '5 MB');

  assert.equal(formatFrameRate(''), '未知');
  assert.equal(formatFrameRate('0/0'), '未知');
  assert.equal(formatFrameRate('N/A'), '未知');
  assert.equal(formatFrameRate('0/1'), '未知');
  assert.equal(formatFrameRate('24/1'), '24 fps');
  assert.equal(formatFrameRate('30000/1001'), '29.97 fps');
  assert.equal(formatFrameRate('不是帧率'), '未知');

  assert.equal(displayCodec(''), '未知');
  assert.equal(displayCodec(null), '未知');
  assert.equal(displayCodec('unknown'), '未知');
  assert.equal(displayCodec('h264'), 'H.264');
  assert.equal(displayCodec('vp9'), 'VP9');
  assert.equal(displayCodec('av1'), 'AV1');
});
