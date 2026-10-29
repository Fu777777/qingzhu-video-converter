const api = window.videoApp;
const $ = (selector) => document.querySelector(selector);
const els = {
  dropzone: $('#dropzone'), choose: $('#choose-btn'), videoCard: $('#video-card'), thumbnail: $('#thumbnail'),
  fileName: $('#file-name'), filePath: $('#file-path'), meta: $('#video-meta'), remove: $('#remove-btn'),
  format: $('#format'), quality: $('#quality'), outputName: $('#output-name'), extension: $('#extension'),
  outputDir: $('#output-dir'), folder: $('#folder-btn'), convert: $('#convert-btn'), progress: $('#progress-card'),
  progressLabel: $('#progress-label'), progressValue: $('#progress-value'), progressFill: $('#progress-fill'),
  progressDetail: $('#progress-detail'), cancel: $('#cancel-btn'), notice: $('#notice'), success: $('#success-card'),
  successDetail: $('#success-detail'), openOutput: $('#open-output-btn'), revealOutput: $('#reveal-output-btn'),
  settings: [$('#format'), $('#quality'), $('#output-name'), $('#folder-btn')],
};
const engineStatus = document.querySelector('.engine-status');
let video = null;
let outputPath = null;
let converting = false;
let loadingVideo = false;
let progressDuration = 0;

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '未知';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '未知';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatFrameRate(value) {
  if (!value || value === '0/0') return '未知';
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return value;
  return `${(numerator / denominator).toFixed(2).replace(/\.00$/, '')} fps`;
}
function showNotice(message) { els.notice.textContent = message; els.notice.classList.remove('hidden'); }
function clearNotice() { els.notice.textContent = ''; els.notice.classList.add('hidden'); }
function refreshConvertButton() {
  els.convert.disabled = !video || converting || loadingVideo || !els.outputName.value.trim() || !els.outputDir.dataset.path;
}
function setInputBusy(busy) {
  els.choose.disabled = busy;
  els.remove.disabled = busy;
  els.dropzone.setAttribute('aria-disabled', String(busy));
  els.settings.forEach((control) => { control.disabled = busy; });
  refreshConvertButton();
}
api.checkTools().then(({ ready, ffmpeg, ffprobe }) => {
  const missing = [!ffmpeg && 'FFmpeg', !ffprobe && 'FFprobe'].filter(Boolean).join(' / ');
  engineStatus.innerHTML = `<i></i>${ready ? 'FFmpeg 就绪' : `缺少 ${missing}`}`;
  if (!ready) engineStatus.classList.add('engine-warning');
});
function renderVideo(info) {
  video = info;
  els.dropzone.classList.add('hidden');
  els.videoCard.classList.remove('hidden');
  els.thumbnail.src = info.thumbnail;
  els.fileName.textContent = info.name;
  els.filePath.textContent = info.path;
  const fps = formatFrameRate(info.frameRate);
  els.meta.innerHTML = '';
  [['时长', formatDuration(info.duration)], ['分辨率', info.width && info.height ? `${info.width} × ${info.height}` : '未知'], ['视频编码', info.codec.toUpperCase()], ['文件大小', formatSize(info.size)], ['帧率', fps]].forEach(([label, value]) => {
    const item = document.createElement('div'); item.className = 'meta-item';
    const name = document.createElement('span'); name.textContent = label;
    const val = document.createElement('strong'); val.textContent = value;
    item.append(name, val); els.meta.append(item);
  });
  els.outputDir.textContent = info.outputDir;
  els.outputDir.dataset.path = info.outputDir;
  els.outputName.value = info.outputName.replace(/\.mp4$/i, '');
  els.success.classList.add('hidden');
  refreshConvertButton();
}
async function loadVideo(filePath) {
  if (!filePath || converting || loadingVideo) return;
  loadingVideo = true;
  setInputBusy(true);
  clearNotice();
  els.success.classList.add('hidden');
  els.dropzone.querySelector('.drop-copy strong').textContent = '正在读取视频信息…';
  try { renderVideo(await api.probe(filePath)); }
  catch (error) { showNotice(error.message || '读取视频失败。'); }
  finally {
    loadingVideo = false;
    setInputBusy(false);
    els.dropzone.querySelector('.drop-copy strong').textContent = '拖放视频到这里';
  }
}
els.choose.addEventListener('click', async (event) => { event.stopPropagation(); await loadVideo(await api.chooseVideo()); });
els.dropzone.addEventListener('click', async () => { if (!loadingVideo && !converting) await loadVideo(await api.chooseVideo()); });
els.dropzone.addEventListener('keydown', (event) => { if (!loadingVideo && !converting && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); els.choose.click(); } });
els.dropzone.addEventListener('dragover', (event) => { event.preventDefault(); els.dropzone.classList.add('dragover'); });
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
els.dropzone.addEventListener('drop', async (event) => {
  event.preventDefault(); els.dropzone.classList.remove('dragover');
  if (loadingVideo || converting) { showNotice('当前任务完成后再更换视频。'); return; }
  const file = event.dataTransfer.files[0];
  if (file) await loadVideo(await api.getPathForDroppedFile(file));
});
els.remove.addEventListener('click', () => {
  if (loadingVideo || converting) return;
  video = null; els.videoCard.classList.add('hidden'); els.dropzone.classList.remove('hidden');
  els.outputDir.textContent = '请先选择视频'; delete els.outputDir.dataset.path;
  els.outputName.value = ''; clearNotice(); els.success.classList.add('hidden'); refreshConvertButton();
});
els.format.addEventListener('change', () => { els.extension.textContent = `.${els.format.value}`; els.success.classList.add('hidden'); });
els.outputName.addEventListener('input', refreshConvertButton);
els.folder.addEventListener('click', async () => {
  if (loadingVideo || converting) return;
  const folder = await api.chooseOutputFolder(els.outputDir.dataset.path);
  if (folder) { els.outputDir.textContent = folder; els.outputDir.dataset.path = folder; refreshConvertButton(); }
});
els.convert.addEventListener('click', async () => {
  if (!video || converting) return;
  clearNotice(); els.success.classList.add('hidden'); converting = true; progressDuration = video.duration;
  setInputBusy(true);
  els.progress.classList.remove('hidden'); els.progressLabel.textContent = '正在转换';
  els.progress.classList.toggle('indeterminate', !progressDuration);
  els.progressValue.textContent = progressDuration ? '0%' : '处理中';
  els.progressFill.style.width = progressDuration ? '0%' : '30%';
  els.progressDetail.textContent = progressDuration ? '正在启动 FFmpeg…' : '视频时长未知，正在处理；完成时间取决于文件大小。';
  refreshConvertButton();
  try {
    const result = await api.convert({
      input: video.path, outputDir: els.outputDir.dataset.path, outputName: els.outputName.value,
      format: els.format.value, quality: els.quality.value,
    });
    els.progress.classList.remove('indeterminate');
    outputPath = result.outputPath;
    els.progress.classList.add('hidden');
    els.successDetail.textContent = `${result.outputPath} · ${formatSize(result.size)}`;
    els.success.classList.remove('hidden');
  } catch (error) {
    els.progress.classList.remove('indeterminate');
    els.progress.classList.add('hidden');
    const message = error.message || '视频转换失败。';
    if (message.includes('取消')) { showNotice('转换已取消。'); }
    else showNotice(message);
  } finally { converting = false; els.cancel.disabled = false; setInputBusy(false); }
});
api.onProgress(({ elapsed }) => {
  if (!converting || !progressDuration) return;
  const percent = Math.max(0, Math.min(99, Math.floor((elapsed / progressDuration) * 100)));
  els.progressValue.textContent = `${percent}%`; els.progressFill.style.width = `${percent}%`;
  els.progressDetail.textContent = `已处理 ${formatDuration(elapsed)} / ${formatDuration(progressDuration)}`;
});
els.cancel.addEventListener('click', async () => { els.cancel.disabled = true; els.progressLabel.textContent = '正在取消…'; await api.cancel(); });
els.openOutput.addEventListener('click', () => { if (outputPath) api.openPath(outputPath); });
els.revealOutput.addEventListener('click', () => { if (outputPath) api.reveal(outputPath); });
