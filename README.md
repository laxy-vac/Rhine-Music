# Rhine Music · Windows 音乐播放器

**朋友品尝版：`0.3.1-preview.1`**。这是仍在开发中的预览，不代表项目完成或正式发布。安装器文件名为 `Rhine-Music-0.3.1-preview.1-Setup.exe`，校验值随 `.sha256` 文件提供，实际验证范围见[品尝版说明](docs/PREVIEW-RELEASE.md)。

项目基于 RhineLabUI，加入本地音乐播放、Future/Rhine 与 Punk/Audio Archive 两套主题，以及 Windows 原生音频处理。音乐适配与维护：**Copyright (c) 2026 RonaldDeng**；上游：**Copyright (c) 2026 LBEILC**。

## 安装品尝版

使用 Windows x64 安装器选择普通用户可写的目录，安装后运行其中的 `Rhine Music Preview.exe`。目录内提供 `Uninstall.exe`；应用数据与预设集中在该目录，卸载默认保留，只有用户明确选择清除时才删除。程序不提权、不改目录权限，不可写时也不回退到 AppData。安装和设备验收分开记录，具体步骤见[品尝版安装与交付说明](docs/PREVIEW-RELEASE.md)。

应用不会自动扫描音乐目录。首次使用时由用户在设置中选择目录并主动启动扫描；个人曲库、凭据和现有配置不会随源码交付。

## 源码运行与离线验证

当前已有源码验证入口：

```powershell
node scripts/build-source-preview.mjs --interface-only
```

构建完成后运行根目录的 `启动源码验证.cmd`。如果修改了原生宿主或桌面组件，使用 `构建源码验证.cmd`，再完整退出并重新启动窗口。入口复用现有工具，不会自动安装依赖、下载组件或扫描曲库；缺少组件时按项目维护说明处理。

标准命令入口为：`npm run desktop`、`npm run build:preview`、`npm test`、`npm run package:preview` 和 `npm run export:source`。`npm test` 运行选定的离线合成检查；安装包构建复用准备好的项目内工具。干净源码不携带依赖或桌面工具，新机器准备方式见 [CONTRIBUTING](CONTRIBUTING.md) 与[本地开发](docs/LOCAL-DEVELOPMENT.md)。

## 项目结构

- `src/`：播放器界面与应用逻辑；`desktop/`：Electron 主进程和预加载层。
- `native/`、`vendor/`：原生音频代码及依赖；各组件许可和来源不同。
- `public/`、`art/`：运行资源、模型与建模资料，版权范围见 [NOTICE](NOTICE.md)。
- `scripts/`、`windows/`：开发、离线检查和 Windows 相关脚本。
- `docs/`、`verification/`：当前状态、架构、操作说明及历史验收证据。

私有工作仓库仍跟踪旧构建产物和 Git 历史，不应直接作为干净源码提交。`npm run export:source` 生成独立 source ZIP，不含 `.git`、`node_modules/`、`dist/`、`release/`、`.tools/`、调试符号或本机配置；历史进度 Markdown 与原有 NOTICE 继续保留。解压后由用户自行审核并初始化自己的 Git 仓库。此过程不改写现有私有历史。

## 当前进度与已知限制

项目仍按四步架构计划推进：

1. **公共状态与设置：验收通过。**
2. **公共展示与交互：用户于2026-10-15确认验收通过。**
3. **公共渲染与资源：未实施，按用户要求暂不推进。** 尚未统一 Three.js/WebGL 渲染，Future 货架与地面资源、性能检测也未完成。当前 Future 选择货架时画面暂回退到阵列；Punk 货架尚未迁入公共三维渲染。
4. **验收后清退旧分支：未实施。** 需要等功能、视觉和性能验收后再进行。

第二阶段已获用户整体验收；本轮仅记录结果，不自动接续第三阶段。RTX 5080 上仍掉帧是用户反馈，尚无基准测试或性能检测结果，完整硬件验收也未完成。阶段细节、证据和其余待办以[全局状态](docs/PROJECT-STATUS.md)及[统一架构方案](docs/UNIFIED-ARCHITECTURE.md)为准。已交付安装器和源码ZIP保留打包时快照，当前验收状态以这些文档为准。

## 许可与署名

有权授权的应用代码、建模脚本和技术文档沿用 [MIT License](LICENSE)，并保留上游与适配者署名。MIT 不自动覆盖模型、字体、商标、原作相关视觉或声音、Sony 组件、BASS/ASIO/DSD 与其他依赖；它们按各自权利和许可处理。请先阅读 [NOTICE](NOTICE.md)，不要将所有资源描述为 MIT 或保证可公开再分发。

## 文档索引

从[文档索引](docs/README.md)进入当前开发说明、产品专项、历史发布记录和验收证据。新用户试用流程以[品尝版安装与交付说明](docs/PREVIEW-RELEASE.md)为准；旧版 Windows EXE 记录仅作历史参考。
