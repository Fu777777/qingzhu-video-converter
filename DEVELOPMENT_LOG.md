# 开发记录

## 2026-10-28 · 阶段一：环境检查与技术选择

- **现状**：工作目录原先为空，无既有 Git 仓库、项目文件或 `AGENTS.md`。Node.js v24.15.0、npm 11.12.1、Git 可用；未安装 .NET SDK。系统可找到 FFmpeg 和 FFprobe。
- **决策**：采用 Electron + 原生 HTML/CSS/JavaScript。理由：当前目录无既有技术栈，Node 工具链可用；Electron 可在限时内提供真实 Windows 桌面窗口、文件对话框和子进程调用。备选为 WPF（缺少 .NET SDK）和 Tauri（会增加 Rust/打包环境准备）。代价是 Electron 体积较大，FFmpeg 需单独安装。
- **实现**：创建 Electron 主进程、隔离 preload、中文界面骨架；完成视频选择/拖放、FFprobe 元信息、FFmpeg 缩略图、格式/画质/输出位置设置、进度事件、取消、成功后的打开文件/定位文件、覆盖保护和友好错误提示。
- **开发者反馈**：本会话中开发者提供了完整的验收要求并明确强调桌面客户端、真实用户易用性、三天范围、开发决策记录、GitHub 交付和实际验证。暂未收到对具体视觉风格或技术选型的后续调整。
- **AI 方案采纳**：界面先采用简洁中文工作区和三步流程；转换按格式选择 H.264/AAC 或 VP9/Opus；通过 Electron IPC 将文件操作留在主进程。
- **验证**：已检查运行环境；代码文件已创建。依赖安装和应用运行验证待进行。
- **风险/限制**：尚未验证打包安装器。程序依赖用户 PATH 中的 FFmpeg/FFprobe；编码器可用性取决于用户安装的构建。

## 2026-10-28 · 阶段二：实现与运行验证

- **实现**：补充 FFmpeg/FFprobe 启动检查，显示真实引擎状态；拖放使用 Electron `webUtils.getPathForFile` 获取文件路径；失败或取消时清理不完整输出；帧率以 fps 形式显示。移除在线字体依赖，让界面离线可用。
- **验证**：`npm install --no-audit --no-fund` 成功（319 packages）；三个 JavaScript 文件均通过 `node --check`。使用路径含中文和空格的 3 秒样本，FFprobe 正确读到 640×360、24 fps、H.264/AAC；FFmpeg 成功提取 JPG 缩略图并转出 MP4，输出可由 FFprobe 重新读取（约 3.02 秒、640×360、H.264/AAC）。重复转换到现存目标时，`-n` 拒绝覆盖。`npm run dist` 成功生成 Windows x64 NSIS 安装包。
- **桌面启动**：Electron 创建了标题为“轻转视频”的窗口；当前计算机使用界面检查工具无法读取其状态（Windows 返回窗口最小化状态）。因此无文件空状态、控件操作、实际拖放及进度/取消 UI 尚未通过人工界面确认。
- **未验证**：MOV、MKV、WebM 编码输出、转换取消行为、损坏输入提示、安装包安装后启动及跨平台构建。系统 FFmpeg 可用，因此“FFmpeg 缺失”状态未在界面中实测。
- **交付整理**：初始化本地 Git `main` 分支并创建提交；源码 zip 与 Windows x64 安装包已放到 `outputs/`。
- **已知限制**：转换编码器依赖系统 FFmpeg 构建。打包日志提示使用默认 Electron 图标，尚未定制图标或签名安装包。当前没有 GitHub remote，环境未检测到 `gh` CLI，GitHub 插件也未提供仓库创建能力，因此没有真实 GitHub 链接。

## 2026-10-28 · 阶段三：复核与安全加固

- **复核发现**：原实现先检查目标文件，再直接启动 FFmpeg 写最终文件；若转换期间目标路径被其他文件占用，失败清理可能误删该文件。
- **修复**：FFmpeg 现在写入输出目录内的随机临时文件。成功后使用硬链接原子发布；若文件系统不支持硬链接，回退到独占创建并流式复制。已有目标时发布失败且保留目标内容。异常/取消时只清理本次临时文件。
- **安全加固**：升级 Electron 到当前稳定版本 45.1.0；对所有 IPC 请求校验发送页面，拒绝导航到其他页面及新窗口。保留 context isolation、sandbox、Node integration 关闭和限制性 CSP。
- **理由**：当前日期的 Electron 官方发布页列出 45.1.0 为稳定版，安全清单建议使用当前版本和验证 IPC sender。参考：[官方发布页](https://releases.electronjs.org/)、[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)。
- **验证**：更新后 `electron@45.1.0` 已安装，四个 JS 文件语法检查通过。Electron 45 桌面窗口可创建。使用中文与空格路径分别转换 MP4、MOV、MKV、WebM 并通过 FFprobe 重新读取：MP4/MOV H.264 640×360，MKV H.264 640×360，WebM VP9 640×360；时长约 3 秒。共享临时输出发布模块验证了成功发布，以及最终文件名在编码期间被占用时返回 `EEXIST` 且原内容保持不变。Windows x64 Electron 45 安装包成功构建。
- **开发者反馈**：开发者要求先审查项目是否达到标准并提升质量；据此先修复竞态覆盖问题、升级 Electron 并强化 IPC 来源校验，再继续仓库推送。
- **GitHub**：已创建公开仓库 `https://github.com/Fu777777/qingzhu-video-converter`，并将本地 `main` 推送为 `origin/main`。
