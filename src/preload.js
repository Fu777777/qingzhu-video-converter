const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('videoApp', {
  chooseVideo: () => ipcRenderer.invoke('video:choose'),
  chooseOutputFolder: (currentPath) => ipcRenderer.invoke('video:output-folder', currentPath),
  probe: (filePath) => ipcRenderer.invoke('video:probe', filePath),
  checkTools: () => ipcRenderer.invoke('video:check-tools'),
  convert: (options) => ipcRenderer.invoke('video:convert', options),
  cancel: () => ipcRenderer.invoke('video:cancel'),
  openPath: (targetPath) => ipcRenderer.invoke('video:open-path', targetPath),
  reveal: (targetPath) => ipcRenderer.invoke('video:reveal', targetPath),
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
