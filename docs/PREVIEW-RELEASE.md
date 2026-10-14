# Rhine Music 0.3.1-preview.1 · 品尝版安装与交付


历史交付快照说明：下文按品尝版打包/验证时状态保留。之后用户于2026-10-15确认第二阶段验收通过，并要求暂不推进第三阶段；详见[当前验收记录](UNIFIED-ARCHITECTURE.md)。后续将本地开发与GitHub发布并入同一仓库，旧两仓目录及导出ZIP后git init的发布流程已退役。安装器和源码ZIP仍是原交付快照，此处不重测、不重生成，也不改写当时的验证范围。

这是未完成项目的朋友体验版。第一阶段已验收，第二阶段实现待验收，第三阶段统一渲染、Future货架/地面、性能检测，以及第四阶段旧逻辑清退均未实施。RTX 5080掉帧是用户反馈，尚无本轮实测基准；打包不代表性能问题已解决。完整进度见 [PROJECT-STATUS](PROJECT-STATUS.md) 与 [UNIFIED-ARCHITECTURE](UNIFIED-ARCHITECTURE.md)，历史说明和验收材料见[文档索引](README.md)。

## 安装和首次使用

交付文件为 `Rhine-Music-0.3.1-preview.1-Setup.exe` 及同名 `.sha256`。本地工作区的交付副本位于 `packaging/installers`；源码ZIP位于 `packaging/source`。本次没有自动上传GitHub或发布远程下载。

1. 运行安装器，选择普通用户可写的独立文件夹。默认是安装器旁的 `Rhine Music Preview`；不提权、不改ACL，不可写就拒绝继续，不改存AppData。未知非空目录会被拒绝，已有本应用标记的目录可用于重新安装。
2. 安装结束后自行运行目录中的 `Rhine Music Preview.exe`；完成页的启动勾选默认关闭。
3. 在设置 → 音乐库选择自己的音乐目录并主动扫描。启动不自动扫描、不携带作者的曲库、凭据或配置。
4. 首次画质为均衡。性能检测和60FPS推荐仍待第三阶段；日常不自动切画质。

安装器未做代码签名。应用的原生音频、Sony、ASIO/DSD/DoP支持范围应结合实际设备验证，不把隔离GUI检查当作硬件验收。

## 安装目录与预设

```text
<安装目录>/
  Rhine Music Preview.exe
  Uninstall.exe
  presets/
    themes/theme-presets.json
    eq/audio-processing-presets.json
  data/
    config/preferences.json
    session/
    logs/
    library/
    lsp/
    tmp/
    crashes/
  resources/app/
    docs/                   # 进度、四阶段方案与本说明
    LICENSE
    NOTICE.md
    vendor/licenses/
```

预设文件在用户保存时创建。两主题的个人盒体预设分别存为 `futurePunkPresets`、`archivePunkPresets`，仍各最多50条、互不覆盖；EQ/音频预设独立保存。浏览器会话、索引、默认缓存和LSP状态使用安装目录的data。用户主动选择外部歌词缓存路径时保留现有功能；预设路径固定在安装目录。Windows自身的临时文件/系统记录与应用预设是不同概念。

程序会检查目录可写性；坏预设或启动后被外部修改的文件会拒绝覆盖并报告。此版不自动复制作者的旧profile、LSP用户数据或私人缓存。源码预览只兼容读取原profile中旧内嵌主题预设/旧EQ文件，用户再次保存才写新预设文件，原文件保留。

## 卸载

从安装目录运行 `Uninstall.exe`，也可使用Windows的已安装应用入口。默认保留data和presets；只有明确勾选删除数据时才递归清除此安装目录内这两个目录。外部音乐目录不在卸载清单中。程序文件按打包清单删除，不递归删除整个安装目录；保留的数据与标记可供原目录重新安装使用。

安装器实际运行会为当前用户写入应用卸载登记（HKCU）；不修改文件关联、服务、启动项、系统PATH或ACL，也不安装系统依赖。编译安装器不等于运行安装器。

## 源码运行、测试与打包

| 入口 | 实际用途 |
| --- | --- |
| `npm run desktop` / `启动源码验证.cmd` | 使用准备好的项目内Electron直接打开源码桌面 |
| `npm run build:preview` | TypeScript/Vite离线界面构建 |
| `npm test` | 合成存储、公共状态、窗口比例、盒体预设、音频处理数学检查 |
| `npm run package:preview` / `打包品尝版.cmd` | 离线校验输入并生成NSIS安装器 |
| `npm run export:source` | 无Git历史的干净源码ZIP和SHA-256 |

没有npm的既有环境可直接运行对应 `node scripts/...mjs`。普通入口不自动执行npm安装或下载工具。当前NSIS 3.13仅经批准解压在项目 `.tools/installer-tools/nsis/3.13/nsis-3.13`；其它运行组件复用现有准备结果，详情见[本地开发](LOCAL-DEVELOPMENT.md)。打包拒绝过期源码指纹和缺失组件，不会静默用旧app/dist补位。

原工作仓库历史含node_modules/dist/release等大文件，保持原样。干净ZIP另行排除Git历史、依赖、工具、产物、私人数据、机器验证JSON及PDB符号；保留源码、必需资源、许可、当前进度和历史验收Markdown。自行提交GitHub时审核ZIP，解压后git init，见 [CONTRIBUTING](../CONTRIBUTING.md)。

## 验证口径

本轮默认离线检查通过；存储junction逃逸测试在沙箱下因EPERM跳过。TypeScript/Vite界面构建通过（2341模块），打包输入检查通过（服务模块闭包、18个生产包、13个native/LSP运行文件及源码/文件指纹）。Sony x86旧产物与源码不匹配，已用已有Zig离线重建并通过指纹检查，未调用设备。

安装器编译、隔离GUI、实际安装/卸载分别记录在交付目录的交付验证说明与构建报告中；未列明通过的项目仍待验收。当前没有真实音频设备、个人曲库或60FPS性能测试结果。使用合成数据的隐藏GUI检查不会替代第二阶段用户验收。

## 许可与署名

有权授权的应用代码、建模脚本和技术文档沿用MIT，保留RonaldDeng及RhineLabUI/LBEILC署名。Sony组件、模型、视觉/声音、字体、商标、BASS/ASIO/DSD及其它依赖按各自权利和许可处理。Electron许可保留在安装根，应用LICENSE/NOTICE及第三方许可在resources/app；MIT不会自动覆盖全部资源。公开前阅读 [NOTICE](../NOTICE.md)，不把安装包或源码ZIP视作全部资源可公开再分发的保证。
