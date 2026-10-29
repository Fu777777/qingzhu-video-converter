const fs = require('node:fs/promises');
const fsNative = require('node:fs');
const { pipeline } = require('node:stream/promises');

// 编码先写到临时文件。发布时优先创建硬链接：目标已存在会失败，因此不会覆盖。
// 文件系统不支持硬链接时，用独占方式（wx）新建目标再复制。复制失败且不是“文件已存在”时，删掉这次留下的不完整文件。
async function publishOutput(tempPath, outputPath) {
  try {
    await fs.link(tempPath, outputPath);
    return;
  } catch (error) {
    if (error.code === 'EEXIST') throw error;
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
  }

  try {
    await pipeline(
      fsNative.createReadStream(tempPath),
      fsNative.createWriteStream(outputPath, { flags: 'wx' }),
    );
  } catch (error) {
    if (error.code !== 'EEXIST') await fs.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = publishOutput;
