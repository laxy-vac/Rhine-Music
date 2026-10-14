# 本地构建、启动与排查

更新：2026-10-15。状态见 [PROJECT-STATUS](PROJECT-STATUS.md)，权限见 [AGENTS](../AGENTS.md)。命令索引不构成安装、音乐扫描或设备测试授权。

## 工作目录与入口

唯一活动Git仓库是 `Rhine-Music-Demo-AudioEnhanced`；它同时用于本地开发和用户自行发布到GitHub。所有命令都在该仓库根目录执行，先检查Git状态并保留用户改动。日常开发不导出或同步第二份源码。

main从干净基线提交 `167d140` 建立，基线包含4062个源码文件。本机 `node_modules/`、`.tools/`、`dist/`、`release/` 和运行数据留在原位并由Git忽略；新克隆需在用户批准后自行准备依赖与桌面工具。旧主线在本地历史分支 `archive/pre-github-main-2026-10-15`，旧 `local/development` 停在 `052bf9a`，原有标签保留为本地历史。用户自行设置远程并只推送 `main`；不推历史分支或标签，不使用 `--all`、`--mirror` 或强推。

当前入口 **启动源码验证.cmd** 或 `npm run desktop` 直接打开“Rhine Music · 源码验证”Electron桌面窗口。朋友品尝版采用独立NSIS安装包；旧 `release/Rhine Music.exe` 是历史自解压产物，不用它验收当前源码。

- 启动器不自动构建、安装、下载或扫描曲库。
- desktop/服务来自源码，界面优先 `.tools/source-preview-interface`；来源清单不一致会拒绝启动。
- 调试界面缺失时存在回退上游dist的旧逻辑，不能把回退产物当新版。
- 修改磁盘不热替换旧窗口/GLTF缓存。前端/模型完成必要构建；desktop/preload/服务/原生变更后必须完整退出再开。

## 必要构建

仅界面、CSS、模型/资源变更，复用已有Node：

```powershell
node scripts/build-source-preview.mjs --interface-only
```

该命令含TypeScript/Vite，输出 `.tools/source-preview-interface` 与manifest，不覆盖上游dist、不完整打包。

原生/宿主也修改时，已有完整入口：

```powershell
.构建源码验证.cmd
```

等价核心为 `node scripts/build-source-preview.mjs`。完整入口处理已准备的原生/LSP组件并构建界面；缺组件先说明并获批，不自动npm安装或运行准备工具。构建后完整退出旧窗口，再运行：

```powershell
.启动源码验证.cmd
```

界面源码验证构建通过（2341模块）。统一架构第一阶段已获用户验收；第二阶段共用目录、阵列镜头/坐标与导航，并在两主题STYLE加入“视图与浏览”和公共网格。Future选货架暂回退阵列但保留偏好，完整货架/地面资源和Punk原生图像货架迁移属于第三阶段。已有HEX、个人预设、精细款光学与徽标保持，Punk不加格式徽标；GLB/PNG未改。2026-10-15用户已确认第二阶段通过；按其要求暂不推进第三阶段。启动源码验证.cmd及原验收步骤继续用于后续回归参考。

第二阶段已于2026-10-15获用户验收通过，用户要求本轮先只记录、暂不推进第三阶段。此前视觉补验步骤保留作回归参考：Future浏览页左上角显示/分组/排序、无整块玻璃底的原资料区、小号ACCESS ALBUM和分段揭示；再看STYLE同步与Punk保持，不需要重扫曲库、重置偏好或换模型。此次通过不扩展到性能、硬件或独立模型专项。

## 模型更新与缓存

本地服务对/assets使用长期immutable缓存。public/构建文件同哈希或窗口重启，都不足以单独证明无版本URL刷新。

当前Punk：导出脚本生成 `src/punk-case-asset.ts` 内容哈希URL，`case-model.ts` 引用；`interface-source-manifest.mjs` 纳入public GLB并校验版本一致。模型-only变更也同步版本、重建。当前地址：

```text
assets/punk-reference-case.glb?v=f48266d5fa51
```

不要用清用户缓存、重置偏好或放宽校验替代。极简盒已有同类music-cd-asset机制。

## 没看到新版的排查

1. 确认源码入口与目标主题，而非旧EXE；新版Punk只使用自制可调盒体，不再有旧CASE SKIN列表/原PNG切换。
2. 只读核对仓库旁 `music-data-source-preview/desktop/desktop-preview.json` 的project/interface目录、origin、pid。它是运行记录，不能凭旧visible字段认定进程仍存活。
3. 核对manifest ready、当前源码/GLB/版本与构建产物。
4. 区分旧进程内存、HTTP缓存及旧保存材质；custom/手改保留是设计，不擅自覆盖来制造新版外观。
5. 按任务授权做隔离检查，或由用户重启确认。未启动实际窗口时如实说明。

缓存修复已构建，隔离浏览器跨重启验证通过；用户实际效果确认仍待反馈。

## 已有工具与落点

| 内容 | 位置/说明 |
| --- | --- |
| Electron及其Node | `.tools/source-preview-electron`；cmd复用，不能混入旧resources/app |
| 前端/清单/Vite缓存 | `.tools/source-preview-interface`、同名前缀manifest、`.tools/source-preview-vite-cache` |
| 原生主机/复制DLL | `.tools/source-preview-native-audio`，启动校验指纹，不覆盖vendor旧EXE |
| Zig0.15.2 | `.tools/walkman/compiler/zig-x86_64-windows-0.15.2`；缓存.tools/zig-cache，不改PATH |
| PCM运行库/SDK | `.tools/audio-codecs`、`vendor/audio/codec-sdk`，固定来源见codec-components |
| LSP工具/运行库/偏好 | `.tools/lsp-plugin`，普通构建不联网 |
| Blender/Chrome | 复用本机已装版本；不因此授权升级，建模不保存用户偏好 |
| 日志/临时样本 | 仓库旁 `.task-tmp` 或项目专用忽略.tools，核对绝对路径 |

prepare-source-preview-runtime、prepare-lsp-plugin、prepare-pcm-codecs及Build-Windows-EXE是准备/打包入口，部分会下载或改变环境，不能作普通接手的默认步骤。

## 个人数据

| 内容 | 位置/规则 |
| --- | --- |
| 源码验证profile | 仓库旁 `music-data-source-preview/desktop`，不提交 |
| 界面偏好 | profile/preferences.json，style/caseProfiles及全局画质/比例 |
| 公共视图 | 同一preferences.json的view，保存shelf/array/grid和show/group/sort；foobarArchive保留兼容投影，新值优先，不新增个人数据目录 |
| Future盒体个人预设 | profile旁presets/themes/theme-presets.json的futurePunkPresets；仅Future使用，整盒材质/部件快照，最多50条，不改内置预设 |
| Punk主题盒体个人预设 | 同一主题文件的archivePunkPresets；仅Punk主题使用，独立最多50条，不复制或覆盖Future个人库 |
| EQ预设/模式工作区 | profile旁presets/eq/audio-processing-presets.json，独立于HTTP端口 |
| 验证索引/封面/音频缓存 | 仓库旁 `music-data-source-preview/music-data`，不自动扫描/迁移/删除 |
| 原音乐/FTP凭据/歌词缓存 | 用户指定位置，不入库或随代码交接 |

音乐目录在设置 → 音乐库，先改草稿、保存并扫描生效；移除目录不删文件、不改系统PATH。歌词换缓存目录不自动迁移旧内容。标签写回需用户主动选择。

品尝版安装后使用 `<安装目录>/data` 和 `<安装目录>/presets`，不使用源码profile、不自动迁移现有个人文件。源码预览兼容读取旧preferences内嵌主题预设，以及新EQ文件缺失时的旧profile/audio-processing-presets.json；下一次用户保存才写入新预设目录，旧文件保留。两主题预设与EQ分开持久化，坏文件或启动后的外部编辑会拒绝覆盖并报告。

## 品尝版打包与交付源码ZIP

`npm test`（或 `node scripts/test-preview.mjs`）是默认离线检查入口，仅合成状态、窗口比例模型、主题预设和音频处理数学，不开设备、不联网、不读个人库。`npm run build:preview` 构建界面；`npm run package:preview` 或 `打包品尝版.cmd` 复用已准备的Electron、原生组件、Python/Unicorn和NSIS生成安装器。`Build-Windows-EXE.cmd` 现在转到此入口。旧package-desktop/build-windows脚本留作历史，可能联网准备依赖，不作为当前默认入口。

打包不会自动执行 npm ci 或下载缺项。NSIS 3.13经用户批准，仅解压在 `.tools/installer-tools/nsis/3.13/nsis-3.13`，ZIP来自官方SourceForge，SHA-256为 `ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8`；不改系统PATH、注册表或权限。构建产物位于 `.tools/preview-release/<版本>-<时间>/`，交付副本放外层packaging目录。安装器实际运行才会在HKCU登记应用和生成卸载器，不能把编译通过当作安装/卸载通过。

`npm run export:source` 是可选交付步骤，输出源码ZIP到 `.tools/preview-release/source`，含文件清单和校验值；不包含Git历史、依赖、工具、产物、个人数据或机器验证JSON。它不是GitHub同步流程；本地开发与用户自行上传都在当前仓库的 `main` 完成。此次main以干净首提交 `167d140` 建立，旧主线改名为本地历史分支 `archive/pre-github-main-2026-10-15`，旧 `local/development`、原有标签保留。新机器需由用户先批准，再准备项目依赖和Electron/原生桌面工具；普通命令不自动下载或安装。详细目录、边界和交付验收结果见[品尝版说明](PREVIEW-RELEASE.md)。

## 检查索引与边界

只运行当前任务必要且已授权的检查：

| 入口 | 范围 |
| --- | --- |
| `scripts/check-case-system.mjs` | 隔离盒体/迁移/插页/生命周期/缓存合成 |
| `scripts/check-unified-state.mjs` | 公共状态、旧配置迁移、冻结view/最近空间布局、真实应用函数编排与模拟UI/渲染/音频端口、桌面偏好白名单；不启动实际播放器或读取个人数据 |
| `scripts/check-music-display.mjs` | 第二阶段真实公共catalog/shelves/array模块，合成专辑/曲目身份、分组/筛选/排序、缓存、导航循环/边界和布局能力回退；纯Node，不启动浏览器或个人播放器 |
| `scripts/check-foobar-tracks.mjs` | 公共目录和旧UI适配层的TRACKS身份、导航、货架与卡片合成检查 |
| `scripts/check-foobar-layout.mjs --display` | 第二阶段真实STYLE/浏览控件、grid组件及生产事件处理器，目录/Scene/播放器/保存端口明确模拟；检查右栏/详情/曲目保持、两主题网格节点迁移、排列别名和Esc，以及Future左上控件与STYLE同步、信息区/ACCESS尺寸、日夜浏览/详情截图与Punk保持；与实际Scene验证分开 |
| `scripts/check-foobar-layout.mjs --glass` | 真实Future顶栏SVG、歌词组件和terminal-lighting的离线光效回归；日夜×四档、受光对象/留白/内部裁切/窄屏滚动，报告和截图在foobar-layout-check/terminal-glass/current。`--baseline`仅用于修复前留证，`--compare-existing`只分析已有A/B PNG底边像素，不重拍；严格模拟歌词请求，不启动音乐服务或设备 |
| `scripts/check-foobar-layout.mjs --navigation` | 第一阶段管理页返回专用合成DOM检查；生产打开/ARCHIVE点击、STYLE/主题切换/关闭及全局键盘函数，真实面板与过渡控制器，模拟播放器/Scene；实际CDP鼠标/键盘，报告management-navigation.json。不运行114项宽布局矩阵或个人播放器 |
| `scripts/check-case-system.mjs --punk-view` | 真实Scene/本地GLB/合成曲库，两主题公共阵列/TRACKS与网格详情、Future精细父编号、空过滤恢复、Punk机位/鼠标命中、右区裁切与JSON布局偏好；不启动播放器 |
| `scripts/check-case-user-presets.mjs` | 个人预设JSON往返、独立快照、输入校验与桌面偏好白名单；不读取个人配置或设备 |
| `scripts/check-archive-label.mjs` | 上游Canvas标签编号、缩放/图像就绪及真实源格式分类；不读取个人曲库 |
| `scripts/check-rhine-shell-geometry.mjs` | Rhine原GLB混用材质的完整连通岛筛选、标签/压纹避让、卡片与清晰窗范围；不修改资产 |
| 上述命令 `--reference` | 实际GLB与源PNG对照，产物.tools/case-system-check/punk-reference |
| `scripts/check-foobar-layout.mjs`，`--panel`/`--pixels` | 隔离布局、面板、字轮像素 |
| `.tools/punk-reference-case/cache-refresh-check` | 本机缓存回归helper/profile/report，不随Git交付 |
| `核验音频核心.cmd` | 历史离线合成，具体行为按脚本核实 |
| `核验WASAPI稳定性.cmd` | 会使用默认真实设备，不是通用离线检查 |
| `启动源码验证.cmd --check-settings-page` | 历史隔离桌面检查含旧导航断言，不等于当前完整UI验收 |

不为文档整理补跑截图/音乐/设备。最新边界见状态；历史证据见 [音频专项](AUDIO-CHAIN-FIX-REPORT-2026-10-10.md)、[WASAPI](WASAPI-STABILITY.md)。另一台机器可能没有忽略的报告，不自动安装工具来复现。

## Git与回滚

明确暂存相关文件，本地提交，不推送，不改全局Git身份。回滚前检查用户改动/运行进程并保留必要备份；审阅后 `git revert <commit>`，按对应版本重建并重新启动。Git不恢复个人配置、曲库或忽略的构建。

仅在明确LSP退役任务中审查 `--retire-lsp-plugin-runtime`，它处理清单/哈希匹配的生成副本；普通整理不执行。历史EXE/上游发行记录见WINDOWS、DESIGN、verification和RELEASE文档，当前最终打包/目录/发布仍待用户决定。
