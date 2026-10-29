const { formatDuration, formatSize, formatFrameRate, displayCodec } = window.videoFormat;
const api = window.videoApp;
const $ = (selector) => document.querySelector(selector);
const els = {
  dropzone: $('#dropzone'),
  choose: $('#choose-btn'),
  videoCard: $('#video-card'),
  preview: $('#preview-wrap'),
  thumbnail: $('#thumbnail'),
  thumbnailFallback: $('#thumbnail-fallback'),
  previewTag: $('#preview-tag'),
  fileName: $('#file-name'),
  filePath: $('#file-path'),
  meta: $('#video-meta'),
  remove: $('#remove-btn'),
  format: $('#format'),
  quality: $('#quality'),
  outputName: $('#output-name'),
  extension: $('#extension'),
  outputDir: $('#output-dir'),
  folder: $('#folder-btn'),
  convert: $('#convert-btn'),
  progress: $('#progress-card'),
  progressLabel: $('#progress-label'),
  progressValue: $('#progress-value'),
  progressFill: $('#progress-fill'),
  progressDetail: $('#progress-detail'),
  cancel: $('#cancel-btn'),
  notice: $('#notice'),
  success: $('#success-card'),
  successDetail: $('#success-detail'),
  openOutput: $('#open-output-btn'),
  revealOutput: $('#reveal-output-btn'),
  settings: [$('#format'), $('#quality'), $('#output-name'), $('#folder-btn')],
};
const engineStatus = document.querySelector('.engine-status');
const dropTitle = document.querySelector('.drop-copy strong');
let video = null;
let outputPath = null;
let converting = false;
let loadingVideo = false;
let choosing = false;
let progressDuration = 0;

function showNotice(message, tone) {
  els.notice.textContent = message;
  els.notice.classList.toggle('notice-warning', tone === 'warning');
  els.notice.classList.remove('hidden');
}
function clearNotice() {
  els.notice.textContent = '';
  els.notice.classList.add('hidden');
  els.notice.classList.remove('notice-warning');
}
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
function setEngineStatus(text, warning) {
  engineStatus.replaceChildren();
  const dot = document.createElement('i');
  engineStatus.append(dot, document.createTextNode(text));
  engineStatus.classList.toggle('engine-warning', Boolean(warning));
}
function setOutputDirectory(folder) {
  els.outputDir.textContent = folder;
  els.outputDir.dataset.path = folder;
  els.outputDir.title = folder;
}
function clearOutputDirectory() {
  els.outputDir.textContent = '请先选择视频';
  els.outputDir.title = '';
  delete els.outputDir.dataset.path;
}
function showThumbnail(info) {
  const failed = !info.thumbnail;
  els.thumbnail.classList.toggle('hidden', failed);
  els.thumbnailFallback.classList.toggle('hidden', !failed);
  els.previewTag.classList.toggle('hidden', failed);
  els.preview.classList.toggle('preview-failed', failed);
  if (failed) {
    els.thumbnail.removeAttribute('src');
    els.thumbnailFallback.textContent = '无法生成预览';
    return;
  }
  els.thumbnail.src = info.thumbnail;
  els.thumbnail.alt = `${info.name} 的预览画面`;
}
function renderVideo(info) {
  video = info;
  els.dropzone.classList.add('hidden');
  els.videoCard.classList.remove('hidden');
  showThumbnail(info);
  els.fileName.textContent = info.name;
  els.fileName.title = info.name;
  els.filePath.textContent = info.path;
  els.filePath.title = info.path;
  const fields = [
    ['文件名', info.name || '未知'],
    ['文件大小', formatSize(info.size)],
    ['时长', formatDuration(info.duration)],
    ['分辨率', info.width && info.height ? `${info.width} × ${info.height}` : '未知'],
    ['视频编码', displayCodec(info.codec)],
    ['帧率', formatFrameRate(info.frameRate)],
  ];
  els.meta.replaceChildren();
  fields.forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'meta-item';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('strong');
    val.textContent = value;
    item.append(name, val);
    els.meta.append(item);
  });
  setOutputDirectory(info.outputDir);
  els.outputName.value = info.outputName;
  els.success.classList.add('hidden');
  refreshConvertButton();
}
async function loadVideo(filePath) {
  if (!filePath || converting || loadingVideo) return false;
  loadingVideo = true;
  setInputBusy(true);
  clearNotice();
  els.success.classList.add('hidden');
  dropTitle.textContent = '正在读取视频信息…';
  try {
    const info = await api.probe(filePath);
    renderVideo(info);
    if (info.thumbnailError) showNotice(info.thumbnailError, 'warning');
    return true;
  } catch (error) {
    showNotice(error.message || '读取视频失败。');
    return false;
  } finally {
    loadingVideo = false;
    setInputBusy(false);
    dropTitle.textContent = '拖放视频到这里';
  }
}
async function chooseFromSystemDialog() {
  if (loadingVideo || converting) {
    showNotice('当前任务完成后再更换视频。');
    return;
  }
  if (choosing) return;
  choosing = true;
  try {
    await loadVideo(await api.chooseVideo());
  } finally {
    choosing = false;
  }
}

api.checkTools().then(({ ready, ffmpeg, ffprobe }) => {
  if (ready) {
    setEngineStatus('FFmpeg 就绪', false);
    return;
  }
  const missing = [!ffmpeg && 'FFmpeg', !ffprobe && 'FFprobe'].filter(Boolean).join(' / ');
  setEngineStatus(`缺少 ${missing}`, true);
  showNotice(`没有找到 ${missing}。请先安装 FFmpeg，把 ffmpeg 和 ffprobe 加入系统 PATH，然后重新打开应用。`, 'warning');
}).catch(() => {
  setEngineStatus('无法检查 FFmpeg', true);
  showNotice('暂时无法检查 FFmpeg 是否已安装。请确认安装后重新打开应用。', 'warning');
});

els.choose.addEventListener('click', async (event) => {
  event.stopPropagation();
  await chooseFromSystemDialog();
});
api.onChooseVideo(() => { chooseFromSystemDialog(); });
els.dropzone.addEventListener('click', () => { chooseFromSystemDialog(); });
els.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    chooseFromSystemDialog();
  }
});
['dragenter', 'dragover'].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    if (!loadingVideo && !converting) els.dropzone.classList.add('dragover');
  });
});
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
els.dropzone.addEventListener('drop', async (event) => {
  event.preventDefault();
  els.dropzone.classList.remove('dragover');
  if (loadingVideo || converting) {
    showNotice('当前任务完成后再更换视频。');
    return;
  }
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) {
    showNotice('没有读取到拖入的文件，请改用“选择视频文件”。');
    return;
  }
  let filePath = '';
  try {
    filePath = api.getPathForDroppedFile(files[0]);
  } catch {
    showNotice('无法读取拖入的文件，请改用“选择视频文件”。');
    return;
  }
  const loaded = await loadVideo(filePath);
  if (loaded && files.length > 1 && els.notice.classList.contains('hidden')) {
    showNotice('一次只能处理一个视频，已导入第一个文件。', 'warning');
  }
});
els.remove.addEventListener('click', () => {
  if (loadingVideo || converting) return;
  video = null;
  outputPath = null;
  els.videoCard.classList.add('hidden');
  els.dropzone.classList.remove('hidden');
  els.thumbnail.removeAttribute('src');
  clearOutputDirectory();
  els.outputName.value = '';
  clearNotice();
  els.success.classList.add('hidden');
  els.progress.classList.add('hidden');
  refreshConvertButton();
});
els.format.addEventListener('change', () => {
  els.extension.textContent = `.${els.format.value}`;
  els.success.classList.add('hidden');
});
els.outputName.addEventListener('input', refreshConvertButton);
els.folder.addEventListener('click', async () => {
  if (loadingVideo || converting) return;
  const folder = await api.chooseOutputFolder(els.outputDir.dataset.path);
  if (!folder) return;
  setOutputDirectory(folder);
  els.success.classList.add('hidden');
  refreshConvertButton();
});
els.convert.addEventListener('click', async () => {
  if (!video || converting) return;
  els.outputName.value = els.outputName.value.trim();
  if (!els.outputName.value) {
    refreshConvertButton();
    showNotice('请输入输出文件名。');
    return;
  }
  clearNotice();
  els.success.classList.add('hidden');
  converting = true;
  progressDuration = video.duration;
  setInputBusy(true);
  els.progress.classList.remove('hidden');
  els.progressLabel.textContent = '正在转换';
  els.progress.classList.toggle('indeterminate', !progressDuration);
  els.progressValue.textContent = progressDuration ? '0%' : '处理中';
  els.progressFill.style.width = progressDuration ? '0%' : '30%';
  els.progressDetail.textContent = progressDuration ? '正在启动 FFmpeg…' : '视频时长未知，正在处理；完成时间取决于文件大小。';
  refreshConvertButton();
  try {
    const result = await api.convert({
      input: video.path,
      outputDir: els.outputDir.dataset.path,
      outputName: els.outputName.value,
      format: els.format.value,
      quality: els.quality.value,
    });
    els.progress.classList.remove('indeterminate');
    outputPath = result.outputPath;
    els.progress.classList.add('hidden');
    els.successDetail.textContent = `${result.outputPath}（${formatSize(result.size)}）`;
    els.successDetail.title = result.outputPath;
    els.success.classList.remove('hidden');
  } catch (error) {
    els.progress.classList.remove('indeterminate');
    els.progress.classList.add('hidden');
    const message = error.message || '视频转换失败。';
    showNotice(message.includes('取消') ? '转换已取消。可以修改设置后重新开始。' : message);
  } finally {
    converting = false;
    els.cancel.disabled = false;
    setInputBusy(false);
  }
});
api.onProgress(({ elapsed }) => {
  if (!converting || !progressDuration || !Number.isFinite(elapsed)) return;
  const percent = Math.max(0, Math.min(99, Math.floor((elapsed / progressDuration) * 100)));
  els.progressValue.textContent = `${percent}%`;
  els.progressFill.style.width = `${percent}%`;
  els.progressDetail.textContent = `已处理 ${formatDuration(elapsed)} / ${formatDuration(progressDuration)}`;
});
els.cancel.addEventListener('click', async () => {
  if (!converting) return;
  els.cancel.disabled = true;
  els.progressLabel.textContent = '正在取消…';
  try {
    await api.cancel();
  } catch (error) {
    els.cancel.disabled = false;
    els.progressLabel.textContent = '正在转换';
    showNotice(error.message || '暂时无法取消转换，请稍后重试。');
  }
});
els.openOutput.addEventListener('click', async () => {
  if (!outputPath) return;
  try { await api.openPath(outputPath); }
  catch (error) { showNotice(error.message || '无法打开文件。'); }
});
els.revealOutput.addEventListener('click', async () => {
  if (!outputPath) return;
  try { await api.reveal(outputPath); }
  catch (error) { showNotice(error.message || '无法打开所在文件夹。'); }
});
