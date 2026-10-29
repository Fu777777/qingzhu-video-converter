// 把媒体元数据格式化成界面上的中文文案。读不到的值一律显示“未知”，不猜测。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.videoFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CODEC_LABELS = {
    h264: 'H.264',
    hevc: 'H.265',
    h265: 'H.265',
    vp8: 'VP8',
    vp9: 'VP9',
    av1: 'AV1',
    mpeg4: 'MPEG-4',
    mpeg2video: 'MPEG-2',
    mjpeg: 'MJPEG',
    prores: 'ProRes',
    theora: 'Theora',
  };

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '未知';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '未知';
    if (bytes < 1024) return `${Math.round(bytes)} 字节`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const text = value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, '');
    return `${text} ${units[unitIndex]}`;
  }

  function formatFps(value) {
    const rounded = Math.round(value * 100) / 100;
    return `${String(rounded)} fps`;
  }

  function formatFrameRate(value) {
    if (typeof value !== 'string' || !value.trim() || value === '0/0' || value.toUpperCase() === 'N/A') return '未知';
    const fraction = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(value.trim());
    if (fraction) {
      const numerator = Number(fraction[1]);
      const denominator = Number(fraction[2]);
      if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0 || numerator <= 0) return '未知';
      return formatFps(numerator / denominator);
    }
    const plain = Number(value);
    if (Number.isFinite(plain) && plain > 0) return formatFps(plain);
    return '未知';
  }

  function displayCodec(codec) {
    if (typeof codec !== 'string' || !codec.trim()) return '未知';
    const key = codec.trim().toLowerCase();
    if (key === 'unknown' || key === 'none') return '未知';
    return CODEC_LABELS[key] || codec.trim().toUpperCase();
  }

  return { formatDuration, formatSize, formatFrameRate, displayCodec };
});
