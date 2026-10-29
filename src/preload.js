const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result?.__videoAppError) throw new Error(result.message);
  return result;
}

contextBridge.exposeInMainWorld('videoApp', {
  chooseVideo: () => invoke('video:choose'),
  chooseOutputFolder: (currentPath) => invoke('video:output-folder', currentPath),
  probe: (filePath) => invoke('video:probe', filePath),
  checkTools: () => invoke('video:check-tools'),
  convert: (options) => invoke('video:convert', options),
  cancel: () => invoke('video:cancel'),
  openPath: (targetPath) => invoke('video:open-path', targetPath),
  reveal: (targetPath) => invoke('video:reveal', targetPath),
  getPathForDroppedFile: (file) => webUtils.getPathForFile(file),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('video:progress', listener);
    return () => ipcRenderer.removeListener('video:progress', listener);
  },
  onChooseVideo: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:choose-video', listener);
    return () => ipcRenderer.removeListener('app:choose-video', listener);
  },
});
