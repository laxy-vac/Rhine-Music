# 本地构建、启动与排查

更新：2026-10-15。状态见 [PROJECT-STATUS](PROJECT-STATUS.md)，权限见 [AGENTS](../AGENTS.md)。命令索引不构成安装、音乐扫描或设备测试授权。

## 工作目录与入口

唯一活动Git仓库是 `Rhine-Music-Demo-AudioEnhanced`；它同时用于本地开发和用户自行发布到GitHub。所有命令都在该仓库根目录执行，先检查Git状态并保留用户改动。日常开发与验证均在 `main` 源码上进行。

main从干净基线提交 `167d140` 建立，基线包含4062个源码文件。本机 `node_modules/`、`.tools/`、`dist/`、`release/` 和运行数据留在原位并由Git忽略；新克隆需在用户批准后自行准备依赖与桌面工具。旧主线在本地历史分支 `archive/pre-github-main-2026-10-15`，旧 `local/development` 停在 `052bf9a`，原有标签保留为本地历史。用户自行设置远程并只推送 `main`；不推历史分支或标签，不使用 `--all`、`--mirror` 或强推。

当前 `main` 入口 **启动源码验证.cmd** 或 `npm run desktop` 打开“Rhine Music · 源码验证”Electron窗口，使用原源码验证profile进行日常开发与验证。朋友品尝版采用独立NSIS安装包，旧 `release/Rhine Music.exe` 是历史自解压产物。

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

阶段一于2026-10-14、阶段二于2026-10-15获用户验收通过。用户于2026-10-15要求将第三、四阶段记录为基本完成，后续按反馈逐步修复细节；实现及必要自动验证均已完成。当前在 `main` 源码上继续按反馈修复；基本完成不追加逐项人工或硬件验收结论。两主题实体托盘、连续排列与网格详情共用ArchiveScene/WebGL；`quality-benchmark.html`与Vite配置均纳入源码manifest。第三阶段界面构建通过（1652模块）；朋友品尝版原安装器/源码ZIP保持不变。

第三阶段公共状态/目录/转场、控件/管理页返回、实际Scene/GLB和隔离benchmark浏览器检查已通过。检测使用合成数据；独立iframe存储为空只读，父公共目录、非首曲、详情与测试哨兵保持，音频API、外站/API/音频请求均为0。历史隐藏mock GUI检查12项、阶段文件哈希核验通过；这些结果不等于个人播放器、Electron整窗、60FPS硬件验收或用户阶段通过。阶段报告分别位于`.tools/unified-architecture-stage3`和`.tools/unified-architecture-stage4/stage3-independent-*`；第四阶段目标与验收见[统一架构](UNIFIED-ARCHITECTURE.md)。

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
| 公共视图 | 同一preferences.json的view保存稳定key `shelf/array/grid`和show/group/sort：实体ARRAY对应`shelf`、MATRIX对应`array`、GRID对应`grid`；foobarArchive保留兼容投影，新值优先，不新增个人数据目录。两主题实体ARRAY仅选中列沿槽位方向滑动；盒体水波不跨排，离开的旧排可沿Y自然回落而Z位置冻结。bell峰值`.748`，selected额外`1.35`，总目标`2.098`并保留净空。仅选中entry hover额外抬升`.5`，不改selection；TRACKS以entryKey定位。Reduced motion保留静态target；MATRIX原有动作不变。 |
| ARRAY列位置 | 两主题共用列scroll anchor：默认各列首张对齐，选中项只移动当前列；切走将该列velocity归零并保留anchor，切回沿用。运行态Map按列保存，目录返回另以`rememberedSlots`恢复选中槽；均不写入磁盘。列移出视口仍隐藏，右侧旧列不会因已保存anchor留在画面；壳体、封面、纸卡、标题、托盘、框及点击命中同步隐藏。resize时pane暂不可测则按窗口比例缩放旧`arrayBrowseWidth`，native浏览clip使用相同`availableWidth`；Archive尺寸回退覆盖1040/1248/1664与65%边界，Future保留全scene宽度。native ARRAY固定`navigationOrbit=0`，MATRIX保留原orbit。 |
| ARRAY强度与带起 | `off/basic/reduced/full`与持久化值不变，范围为每侧0/1/2/4张实际专辑，边界不填虚拟唱片。当前选中对应单凸起，integer距离`d`的bell为`0.748*(1+cos(pi*abs(d)/(R+1)))/2`，`abs(d)>R`严格为0，采样不低于托盘；selected目标`.748+1.35=2.098`。同列邻居用critical damping spring速率13/7平滑追随，不传播或累积packet；被选中时继承已有高度保持连续。仅选中entry hover `+.5`，不抢selection/focus。ARRAY“水波强度”四档label为仅抬起/轻柔/适中/强烈，shelf hint为“单凸起；档位越高，同列带起的前后专辑越多。”；MATRIX label/hint及原波不变。参数是用户反馈驱动的本项目观感模拟。 |
| Future盒体个人预设 | profile旁presets/themes/theme-presets.json的futurePunkPresets；仅Future使用，整盒材质/部件快照，最多50条，不改内置预设 |
| Punk主题盒体个人预设 | 同一主题文件的archivePunkPresets；仅Punk主题使用，独立最多50条，不复制或覆盖Future个人库 |
| EQ预设/模式工作区 | profile旁presets/eq/audio-processing-presets.json，独立于HTTP端口 |
| 验证索引/封面/音频缓存 | 仓库旁 `music-data-source-preview/music-data`，不自动扫描/迁移/删除 |
| 原音乐/FTP凭据/歌词缓存 | 用户指定位置，不入库或随代码交接 |

退役阶段运行包的测试数据保留在工作区相对路径 `packaging/retired-stage-data`，仅作留存，不是运行入口；日常开发仅使用上表的源码验证profile。

音乐目录在设置 → 音乐库，先改草稿、保存并扫描生效；移除目录不删文件、不改系统PATH。歌词换缓存目录不自动迁移旧内容。标签写回需用户主动选择。

品尝版安装后使用 `<安装目录>/data` 和 `<安装目录>/presets`，不使用源码profile、不自动迁移现有个人文件。源码预览兼容读取旧preferences内嵌主题预设，以及新EQ文件缺失时的旧profile/audio-processing-presets.json；下一次用户保存才写入新预设目录，旧文件保留。两主题预设与EQ分开持久化，坏文件或启动后的外部编辑会拒绝覆盖并报告。

## 品尝版打包与交付源码ZIP

`npm test`（或 `node scripts/test-preview.mjs`）是默认离线检查入口，仅合成状态、窗口比例模型、主题预设和音频处理数学，不开设备、不联网、不读个人库。`npm run build:preview` 构建界面；`npm run package:preview` 或 `打包品尝版.cmd` 复用已准备的Electron、原生组件、Python/Unicorn和NSIS生成安装器。`Build-Windows-EXE.cmd` 现在转到此入口。旧package-desktop/build-windows脚本留作历史，可能联网准备依赖，不作为当前默认入口。

打包不会自动执行 npm ci 或下载缺项。NSIS 3.13经用户批准，仅解压在 `.tools/installer-tools/nsis/3.13/nsis-3.13`，ZIP来自官方SourceForge，SHA-256为 `ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8`；不改系统PATH、注册表或权限。构建产物位于 `.tools/preview-release/<版本>-<时间>/`，交付副本放外层packaging目录。安装器实际运行才会在HKCU登记应用和生成卸载器，不能把编译通过当作安装/卸载通过。

`npm run export:source` 是可选交付步骤，输出当前main的源码ZIP到 `.tools/preview-release/source`；不包含Git历史、安装依赖、构建工具、个人数据或机器验证JSON，也不用于GitHub同步。本地开发与用户自行发布共用当前仓库的 `main`；这不授权自动推送。新机器需由用户先批准，再准备项目依赖和Electron/原生桌面工具；普通命令不自动下载或安装。详细品尝版边界见[品尝版说明](PREVIEW-RELEASE.md)。

## 检查索引与边界

2026-10-15上一轮实际运行的ARRAY cover rowTint before/after专项、array-composition、full unified、TSC与最终interface-only build均通过；runtime/shader/blockedRoutes为0。ARRAY此路径额外执行一次mask Scene render和一次全屏合成，未验证设备FPS。上一轮pure helper与album pointer未重跑、相关实现未改；pure helper沿用`66589e7`基线`.tools/array-composition/pure-motion-audit.json`（targetRow/列anchor逻辑未变）。旧source-surface目录`.tools/array-surface-refinement`仅保留更早历史，不作为当前motion验证。Build log在`.tools/array-cover-visibility/build.log`；before/after报告为`.tools/array-cover-visibility/{before-report.json,after-report.json,after-*-rowtint-on/off.png}`；上一轮composition报告为`.tools/array-composition/{array-composition-audit.json,array-composition-screenshots.json,unified-render-audit.json,scene-motion-unified-audit.json}`。验证使用隔离synthetic Scene，不代表个人播放器、音频设备或完整app页面人工验收，不声称像素复刻或用户通过。
本轮两主题ARRAY单凸起带起验证通过：TSC、最终interface-only build、`--array-bump` pure/Scene/MATRIX/UI guards及array-composition复跑均通过，runtime/shader/blockedRoutes=0。四档中心slot邻居总数`0/2/4/8`（每侧最多`0/1/2/4`），邻居抬高`0/.374/.561/.677`，中心峰值`2.098`；快速正反选后静止5秒无迟到返波、尾帧变化0。`returning-array` hover相对无hover spring反事实首帧约`+.01`，目录/focus不变。MATRIX full/off扫描150帧确认global pulse正常，同列远4行maxY差`.0712`、邻列`.0604`，rail guards通过。报告在`.tools/array-bump/{build.log,pure-motion-audit.json,array-bump-report.json}`及同目录9张PNG。此轮未重跑full unified或cover白板专项；fader源码未改，相关旧报告仍为历史。`.tools/array-echo`仅为已撤回packet/回波版历史，不代表当前行为；结果不外推硬件FPS或用户人工验收。

只运行当前任务必要且已授权的检查：

| 入口 | 范围 |
| --- | --- |
| `scripts/check-music-spatial.mjs` | 第三阶段有限20槽映射、TRACKS稳定身份、越界/空过滤及阵列委托；纯合成 |
| `scripts/check-quality-detection.mjs` | 完整四档/双场景、样本门槛、最高稳定推荐及低帧档回退；纯计算 |
| `scripts/check-case-system.mjs --unified-render` | 真实Scene/GLB、两主题货架、分页/命中/开盒/裁切/非对称变换支撑与详情可见；隔离图形 |
| `scripts/check-quality-benchmark.mjs` | 先构建源码预览；生产检测UI+编译iframe，固定960×540/DPR1、Future简单款合成曲库、四档结果/取消/采用/键盘/独立存储和父状态；独立Chrome profile，不是Electron或设备FPS保证 |
| `scripts/check-case-system.mjs` | 当前模型、真实编辑器、预设、纸卡/铭牌、查看器与退场材质/纹理生命周期；退役sprite专属实现断言已移除，产品保护迁到真实Scene/GLB |
| `scripts/check-unified-state.mjs` | 公共状态、旧配置迁移、冻结view/最近空间布局、真实应用函数编排与模拟UI/渲染/音频端口、桌面偏好白名单；不启动实际播放器或读取个人数据 |
| `scripts/check-music-display.mjs` | 第二阶段真实公共catalog/shelves/array模块，合成专辑/曲目身份、分组/筛选/排序、缓存、导航循环/边界和布局能力回退；纯Node，不启动浏览器或个人播放器 |
| `scripts/check-punk-array-motion.mjs` | 旧脚本名兼容入口；本轮纯helper已通过，实现位于`src/music-array-motion.ts`，本轮报告为`.tools/array-bump/pure-motion-audit.json`（当前targetRow/列anchor逻辑覆盖） |
| `node scripts/check-case-system.mjs --unified-render --array-composition` | 两主题ARRAY逐列滚动、视口显隐与点击一致性聚焦检查；兼容旧flag`--punk-array-motion`。使用85 TRACKS（四满排加末排5首）与20槽；本轮focused Scene/CDP及array-composition复跑已通过，报告在`.tools/array-composition/array-composition-audit.json`和`scene-motion-unified-audit.json`；full unified仍沿用更早历史报告，非本轮重跑。cover visibility before为`node scripts/check-case-system.mjs --unified-render --array-cover-visibility`，after为`node scripts/check-case-system.mjs --unified-render --array-cover-visibility --array-cover-after`；报告在`.tools/array-cover-visibility` |
| `node scripts/check-case-system.mjs --unified-render --array-composition --screenshots-only` | viewport缓存修复后独立刷新截图并通过；截图专项为1600×900、1920×1080、2560×1440全屏尺寸共6张。尺寸回退测试覆盖Archive 1040/1248/1664宽度的65%测量/隐藏pane宽度回退，以及Future完整scene宽度；报告为`.tools/array-composition/array-composition-screenshots.json` |
| `node scripts/check-case-system.mjs --unified-render --array-bump` | 两主题shelf ARRAY单凸起范围、边界截断、同列带起、选中连续性、hover及MATRIX/UI守卫已通过；报告`array-bump-report.json`、pure-motion audit与9张PNG均在`.tools/array-bump`。本轮未运行full unified与cover白板专项 |
| `node scripts/check-case-system.mjs --array-tray --after` | 两主题ARRAY-only托盘对比八组通过：两主题×day/night×requested/effective floor，Future requested deck映射plain；输出`.tools/array-tray/after/array-tray-report.json`及16张PNG，Archive/Future近景已由root复核。默认`--array-tray`生成after；before需显式`--baseline-only`或`--before`，现有Archive day/plain before图在`.tools/array-tray/before`。`--array-composition`十项回归及MATRIX隐藏托盘guard通过。active texture disposal为0只验证切换时没有提前释放，不表示最终销毁已测；MATRIX、主floor、地面选择和偏好未改 |
| `scripts/check-foobar-tracks.mjs` | 当前公共catalog/shelves及共享markup，TRACKS身份、分组/过滤/导航、卡片和旧配置迁移；文件名保留兼容命令 |
| `scripts/check-foobar-layout.mjs --display` | 真实浏览工具栏、grid组件及生产事件处理器，目录/Scene/播放器/保存端口明确模拟；检查两主题三布局与Punk橙色状态点、字段同步、筛选恢复、右栏/曲目保持、排列别名、STYLE无旧视图区及Future无内嵌筛选框；211条目验证六档页大小、页码边界、全组计数、内容变化重置、主题同步、非首曲详情、分页键盘焦点及DOM上限，生成Punk封面墙/Future卡片和浏览/详情截图；与实际Scene验证分开 |
| `scripts/check-foobar-layout.mjs --glass` | 真实Future顶栏SVG、歌词组件和terminal-lighting的离线光效回归；日夜×四档、受光对象/留白/内部裁切/窄屏滚动，报告和截图在foobar-layout-check/terminal-glass/current。`--baseline`仅用于修复前留证，`--compare-existing`只分析已有A/B PNG底边像素，不重拍；严格模拟歌词请求，不启动音乐服务或设备 |
| `scripts/check-foobar-layout.mjs --navigation` | 第一阶段管理页返回专用合成DOM检查；生产打开/ARCHIVE点击、STYLE/主题切换/关闭及全局键盘函数，真实面板与过渡控制器，模拟播放器/Scene；实际CDP鼠标/键盘，报告management-navigation.json。不运行114项宽布局矩阵或个人播放器 |
| `scripts/check-case-system.mjs --punk-view` | 真实Scene/本地GLB/合成曲库，两主题公共阵列/TRACKS与网格详情、Future精细父编号、空过滤恢复、Punk机位/鼠标命中、右区裁切与JSON布局偏好；不启动播放器 |
| `scripts/check-case-user-presets.mjs` | 个人预设JSON往返、独立快照、输入校验与桌面偏好白名单；不读取个人配置或设备 |
| `scripts/check-archive-label.mjs` | 仍有效的公共Canvas标签绘制helper：编号、缩放/图像就绪及真实源格式分类；Scene/GLB中完整铭牌另由真实图形检查覆盖 |
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

仅在明确LSP退役任务中审查 `--retire-lsp-plugin-runtime`，它处理清单/哈希匹配的生成副本；普通整理不执行。其余历史EXE/上游发行记录见WINDOWS、DESIGN、verification和RELEASE文档，正式发行或远程发布仍待用户决定。
