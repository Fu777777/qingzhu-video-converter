const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const {
  friendlyError,
  probeVideoFile,
  runProcess,
  startConversion,
  userError,
} = require('./media-tools');

let mainWindow;
let activeConversion = null;
const appPageUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;

function installAppMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: '选择视频…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:choose-video');
          },
        },
        { type: 'separator' },
        { label: '退出', role: 'quit', accelerator: 'CmdOrCtrl+Q' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' }, { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' }, { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' },
        { type: 'separator' }, { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [{ label: '最小化', role: 'minimize' }, { label: '关闭窗口', role: 'close' }],
    },
    {
      label: '帮助',
      submenu: [{
        label: '关于轻转视频',
        click: () => dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '关于轻转视频',
          message: '轻转视频',
          detail: `版本 ${app.getVersion()}\n本地视频格式转换工具，由 FFmpeg 提供媒体处理能力。`,
        }),
      }],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 980,
    minWidth: 860,
    minHeight: 760,
    title: '轻转视频',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== appPageUrl) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function isAppSender(event) {
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) return false;
  try {
    return path.normalize(fileURLToPath(frameUrl)) === path.normalize(fileURLToPath(appPageUrl));
  } catch {
    return false;
  }
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!isAppSender(event)) throw userError('拒绝来自非应用页面的请求。');
      return await handler(event, ...args);
    } catch (error) {
      return { __videoAppError: true, message: error?.userMessage || friendlyError(error) };
    }
  });
}

async function findTool(name) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const { stdout } = await runProcess(command, [name]);
    return stdout.split(/\r?\n/).find(Boolean)?.trim() || null;
  } catch {
    return null;
  }
}

registerHandler('video:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频',
    properties: ['openFile'],
    filters: [
      { name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpeg', 'mpg', '3gp', 'wmv', 'flv'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

registerHandler('video:output-folder', async (_event, currentPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择输出文件夹',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: typeof currentPath === 'string' && currentPath.trim() ? currentPath : app.getPath('videos'),
  });
  return result.canceled ? null : result.filePaths[0];
});

registerHandler('video:probe', async (_event, filePath) => {
  const [ffprobe, ffmpeg] = await Promise.all([findTool('ffprobe'), findTool('ffmpeg')]);
  return probeVideoFile({
    filePath,
    ffprobePath: ffprobe,
    ffmpegPath: ffmpeg,
    tempDir: app.getPath('temp'),
  });
});

registerHandler('video:check-tools', async () => {
  const [ffmpeg, ffprobe] = await Promise.all([findTool('ffmpeg'), findTool('ffprobe')]);
  return { ready: Boolean(ffmpeg && ffprobe), ffmpeg: Boolean(ffmpeg), ffprobe: Boolean(ffprobe) };
});

registerHandler('video:convert', async (event, options) => {
  if (activeConversion) throw userError('已有转换任务正在进行。');
  const safeOptions = options && typeof options === 'object' ? options : {};
  const ffmpeg = await findTool('ffmpeg');
  const job = await startConversion({
    ffmpegPath: ffmpeg,
    input: safeOptions.input,
    outputDir: safeOptions.outputDir,
    outputName: safeOptions.outputName,
    format: safeOptions.format,
    quality: safeOptions.quality,
    onProgress: (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('video:progress', progress);
    },
  });
  activeConversion = job;
  try {
    return await job.done;
  } finally {
    if (activeConversion === job) activeConversion = null;
    if (job.quitRequested) app.quit();
  }
});

registerHandler('video:cancel', () => {
  if (activeConversion) activeConversion.cancel();
  return true;
});

registerHandler('video:open-path', async (_event, targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath.trim()) throw userError('没有可打开的文件。');
  try {
    await fs.stat(targetPath);
  } catch {
    throw userError('找不到输出文件，可能已被移动或删除。');
  }
  const errorMessage = await shell.openPath(targetPath);
  if (errorMessage) throw userError('无法打开文件。请到保存位置手动查看。');
  return true;
});

registerHandler('video:reveal', async (_event, targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath.trim()) throw userError('没有可查看的文件。');
  try {
    await fs.stat(targetPath);
  } catch {
    throw userError('找不到输出文件，可能已被移动或删除。');
  }
  shell.showItemInFolder(targetPath);
  return true;
});

app.setName('轻转视频');
app.whenReady().then(() => {
  installAppMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', (event) => {
  if (!activeConversion || activeConversion.quitRequested) return;
  event.preventDefault();
  activeConversion.quitRequested = true;
  activeConversion.cancel();
});
