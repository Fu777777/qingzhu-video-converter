# 轻转视频

一款面向普通用户的 Windows 桌面视频格式转换器。采用 Electron 45 构建桌面窗口，在本机通过 FFmpeg / FFprobe 命令行读取视频信息、生成缩略图并进行格式转换；视频文件不会上传到网络。

GitHub 仓库：[Fu777777/qingzhu-video-converter](https://github.com/Fu777777/qingzhu-video-converter)

## 功能

- 通过系统文件选择器或拖放导入视频，展示时长、分辨率、编码、帧率和文件大小。
- 提取代表性画面作为缩略图，临时图像在读取后清理。
- 转换为 MP4、MOV、MKV 或 WebM，提供标准、高画质和较小文件三档。
- 显示转换进度，支持取消；转换结束可打开结果或在文件夹中查看。
- 转换时锁定素材和输出设置，避免界面状态与正在处理的任务不一致；无法读取时长的视频使用动态进度提示。
- 检查输出文件名和目标路径，不会覆盖已有文件。
- 使用隔离的 Electron preload 和参数数组启动 FFmpeg 子进程。
- Windows 安装包使用与应用品牌一致的自定义图标。
- FFmpeg 先写入临时文件，成功后再无覆盖地发布到目标位置；转换失败或取消不会误删原有目标文件。

## 环境要求

- Windows 10 或更新版本（本项目配置了 Windows NSIS 安装包）。
- Node.js 20 或更新版本、npm。
- FFmpeg 与 FFprobe，并将两个可执行文件加入系统 `PATH`。安装后重启应用使路径生效。

应用当前使用系统安装的 FFmpeg，不会自动下载或捆绑它。不同 FFmpeg 构建支持的编码器可能不同；WebM 转换需要 `libvpx-vp9` 和 `libopus`，MP4/MOV/MKV 需要 `libx264` 与 AAC 编码器。

## 开发运行

```powershell
npm install
npm start
```

## 打包

```powershell
npm run dist
```

安装包会生成在 `dist/`。签名证书和 macOS/Linux 打包配置不包含在本项目范围内。

## 使用步骤

1. 点击“选择视频文件”或将视频拖到导入区域。
2. 检查视频预览和读取到的基本信息。
3. 选择输出格式、画质、文件名和保存目录。
4. 点击“开始转换”；需要时可取消。
5. 完成后选择“打开文件”或“查看文件夹”。

## 常见问题

**提示找不到 FFmpeg / FFprobe**：安装 FFmpeg，将 `ffmpeg.exe` 和 `ffprobe.exe` 所在目录加入系统 PATH，然后重启应用。

**提示编码器不可用**：更换包含对应编码器的 FFmpeg 构建。MP4/MOV/MKV 使用 H.264 与 AAC，WebM 使用 VP9 与 Opus。

**转换失败**：检查源视频是否有效、输出目录是否可写、磁盘空间是否充足，并确认目标文件名没有与已有文件冲突。

## 验证状态

已用含中文和空格的路径验证 FFprobe 信息读取、缩略图提取及 MP4、MOV、MKV、WebM 转换，输出均能由 FFprobe 重新读取。已从桌面窗口完成文件选择和一次 MP4 转换，并验证目标文件名竞态保护及 Windows x64 NSIS 安装包构建。拖放导入、取消和损坏文件提示尚待可见界面确认；详细记录见 [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) 与 [SESSION_SUMMARY.md](SESSION_SUMMARY.md)。

## 技术选择

采用 Electron + 原生 HTML/CSS/JavaScript。空白目录中没有现成客户端框架，且当前环境提供 Node/npm 与 Windows FFmpeg，Electron 能在限时内完成桌面文件选择、子进程管理和可打包的 Windows 窗口。代价是 Electron 安装包较大，并且需用户安装 FFmpeg。
