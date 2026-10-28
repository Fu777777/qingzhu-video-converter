const fs = require('node:fs/promises');
const fsNative = require('node:fs');
const { pipeline } = require('node:stream/promises');

async function publishOutput(tempPath, outputPath) {
  try {
    await fs.link(tempPath, outputPath);
    return;
  } catch (error) {
    if (error.code === 'EEXIST') throw error;
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
  }

  // Some filesystems do not support hard links. Reserve the final name with
  // exclusive creation, then stream into that owned file without clobbering.
  const handle = await fs.open(outputPath, 'wx');
  try {
    await pipeline(fsNative.createReadStream(tempPath), handle.createWriteStream({ autoClose: false }));
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = publishOutput;
