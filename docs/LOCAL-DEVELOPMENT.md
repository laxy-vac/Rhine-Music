# 本地开发

更新：2026-10-18。功能见 [PROJECT-STATUS](PROJECT-STATUS.md)，下一阶段见 [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md)，权限和保护点见 [AGENTS](../AGENTS.md)。

## 源码与启动

工作区：`D:\CodexLocalWorkContent\PersonalMusicPlayer`。唯一活动仓库：`source\Rhine-Music-Demo-AudioEnhanced`，当前分支 `main`。所有项目命令在仓库根执行，先查看 Git 状态并保留用户改动。

```powershell
node scripts/build-source-preview.mjs --interface-only
.\启动源码验证.cmd
```

`--interface-only` 只执行现有项目的 TypeScript/Vite，输出 `.tools/source-preview-interface` 及来源清单，不运行包管理器或原生组件准备。等价入口为 `npm run build:preview` 与 `npm run desktop`。

修改宿主、预加载层、服务或原生组件时按需要使用 `构建源码验证.cmd`，核心为 `node scripts/build-source-preview.mjs`；缺组件先说明，不自动安装、下载或修复环境。

- 启动器不会自动构建、准备工具或扫描曲库；前端优先使用源码预览，并检查指纹。
- `.tools/source-preview-interface` 缺失时可能回退旧 `dist`，不能把它当成新版。
- 磁盘修改不替换旧窗口内存；必要构建后完整退出并重开。
- 当前源码预览的生产文件已构建到 `1bef54f` 功能代码。文档整理和检查脚本退役不改变生产前端，无需为此重建。
- 窗口首次显示受初始化/首帧门控制；已显示窗口重载保持可见。Future 入场可跳过，Punk 不播放入场。
- `启动音乐播放器.bat`、`.command` 与旧 launcher 仅保留兼容引用，不是日常开发入口。

## 既有环境

| 内容 | 位置 |
| --- | --- |
| 项目依赖 | `node_modules/` |
| Electron | `.tools/source-preview-electron` |
| 前端、指纹、Vite cache | `.tools/source-preview-interface`、`.tools/source-preview-interface.manifest.json`、`.tools/source-preview-vite-cache` |
| 原生主机/DLL | `.tools/source-preview-native-audio` |
| PCM 解码组件 | `.tools/audio-codecs`、`vendor/audio/codec-sdk` |
| LSP | `.tools/lsp-plugin` |
| Zig 与缓存 | `.tools/walkman/compiler/zig-x86_64-windows-0.15.2`、`.tools/zig-cache` |
| 安装器工具 | `.tools/installer-tools/nsis/3.13/nsis-3.13` |
| 临时测量与报告 | 专用 `.tools/<任务名>`，不进入源码交付 |

这些位置不构成安装或变更授权。prepare/runtime/codec/LSP 等脚本可能联网、下载或修改环境，不能当作普通接手步骤。缺少 Node、依赖或桌面组件时报告，不自动执行 pnpm/npm install、恢复缓存或修改 PATH/全局配置。

### 当前运行时报警

2026-10-18，用户报告卡巴斯基删除 `PDM:Trojan.Win32.Generic` 对象：`C:\Users\Entropy\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\dist\pnpm.mjs`，发起进程为同一运行时的 `node.exe`，PID 22036，时间 20:37:07（Asia/Shanghai）。

只读排查确认 Codex 工具包 `26.1011.51657` 声明 Node v24.19.0、pnpm 11.25.0；Node 的 OpenJS Foundation 数字签名有效。排查时 pnpm 的 `bin/pnpm.mjs` 和 `dist/pnpm.mjs` 均缺失，随后现有 Node 仍完成了项目构建。项目构建入口及其直接 helper 没有 pnpm、安装/下载或共享运行时写入调用。

具体触发行为及是否误报未确认；缺少卡巴斯基完整命令行、父进程和行为链。用户曾自行退出卡巴允许继续，不能据此假定后续保护状态或性能基准环境。Agent 未恢复文件、添加白名单、安装依赖或修改安全设置。后续若受阻，先核对现状和完整事件，不绕过保护或自动修复运行时。

## 个人数据

源码启动器在 `source/<仓库>` 布局下使用工作区根的 `music-data-source-preview`；其他布局使用仓库父目录下同名目录。最终路径由 `scripts/launch-source-preview.mjs` 计算，不自动迁移。

| 内容 | 位置/规则 |
| --- | --- |
| 桌面 profile、偏好 | `music-data-source-preview/desktop`；`preferences.json` |
| 索引、封面与默认缓存 | `music-data-source-preview/music-data` |
| 主题预设 | profile 旁 `presets/themes/theme-presets.json`，两主题独立 |
| EQ | profile 旁 `presets/eq/standard`、`standard-eq-library.json`、兼容聚合预设 |
| 歌词 | 用户指定缓存目录，每曲 SHA-256 的 V3 容器，Local/Cloud 双 bank，见 [LYRICS](LYRICS.md) |
| 安装版 | 安装目录中的 `data` 与 `presets`，与源码 profile 独立 |

目录移除不删除音乐；歌词导入只复制文本。坏文件、外部编辑和未知文件不能自动覆盖。性能优化、文档清理或 Git 回滚均不能清个人数据、重置预设或迁移缓存来制造结果。

## 必要检查与排查

`--interface-only` 包含类型检查和前端构建；其它检查按 [优化基线](OPTIMIZATION-BASELINE.md) 选择。只做与改动直接相关的有限验证，视觉效果交用户，不默认多轮自动审查或大截图矩阵。

既有整窗探针使用独立 profile、合成目录和 mock 音频，不能代替个人曲库、设备或硬件性能测量。音频原生检查先在本次命令进程内设置 `RHINE_NATIVE_TEST_MODE=mock-only`；不带此设置的既有套件可能访问真实设备，不能默认运行。

实际运行性能应记录真实帧间隔、环境和操作；现有 `stats().frameTime` 是场景时钟。当前没有整机性能基准报告，旧动效 ready 时间、截图 FPS 和通过数都不能用于判断掉帧原因。

看不到修改时先检查源码入口、主题、来源清单、是否重开窗口和模型版本。不要清个人缓存或重置偏好。显卡选择需完全退出后重启；可用 `node scripts/launch-source-preview.mjs --gpu-auto` 仅本次自动选卡，再由用户调整 Settings 偏好。

## 交付与历史

`npm run package:preview` / `打包品尝版.cmd` 使用已有工具生成安装器；`npm run export:source` 导出源码 ZIP。两者不会自动准备依赖；打包不等于安装或设备验收。当前旧安装器未因源码变化更新。

只维护当前仓库 `main`，不恢复第二套活动源码。远程发布由用户处理，不自动 fetch/pull/push。历史试验、旧顶屏方案和专项验收脚本从 Git 按需追溯；本轮删除的忽略目录合成报告未纳入 Git，不承诺恢复。回滚用审阅后的 `git revert`，不硬重置、不强制检出或迁移个人数据。来源与许可始终见 [NOTICE](../NOTICE.md)。
