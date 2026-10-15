# 当前全局状态与交接

更新：2026-10-15。本文是当前快照，不是流水账。规则见 [AGENTS](../AGENTS.md)，操作见 [本地开发](LOCAL-DEVELOPMENT.md)。

## 接手先看

- **当前状态：统一架构四阶段基本完成，回归正常开发与细节修复。** 用户已要求移除阶段版本，日常在当前main按实际反馈逐项修复，使用`启动源码验证.cmd`验证。阶段交付物和临时入口已移除，历史提交/标签及验证报告保留。此状态不表示逐项人工、真实曲库或硬件全面验收通过。
- 唯一活动仓库同时用于本地开发和用户自行发布到GitHub。main从干净基线提交 `167d140` 建立，基线含4062个源码文件；旧主线保留为本地历史分支 `archive/pre-github-main-2026-10-15`，旧 `local/development` 停在 `052bf9a`，所有标签保留。只发布main，不自动推送历史分支/标签，不使用 `--all`、`--mirror` 或强推。
- 本机已有 `node_modules/`、`.tools/`、`dist/`、`release/` 与运行数据留在原位并由Git忽略，main不跟踪这些依赖、产物和机器记录；新克隆需由用户批准后自行准备依赖及桌面工具。此前的第二份源码副本已退役，整理记录在忽略目录 `.tools/repo-consolidation/retired-copy-metadata`。
- 已完成Future分盒体交互、Punk个人预设与Rhine盒内专辑/局部透明窗。缓存修复证据仍见 `19f82f2` / `checkpoint/punk-model-cache-refresh`。
- 当前开发验证是Electron源码桌面，入口为`启动源码验证.cmd`或`npm run desktop`，前端产物 `.tools/source-preview-interface`，沿用原源码验证profile。阶段运行包已退役；两版测试产生的data/presets移到工作区外层`../../packaging/retired-stage-data`保留，未读取内容或合并到源码配置。`0.3.1-preview.1` Setup和源码ZIP保留原快照，旧release/Rhine Music.exe仍为历史。品尝版此前通过的构建、安装包完整性、合成GUI、安装及默认卸载保留数据检查不扩展到当前源码或真实曲库/设备/60FPS，见[品尝版验证](PREVIEW-VALIDATION-2026-10-15.md)。
- 统一架构第一阶段于2026-10-14验收通过；第二阶段公共展示与交互于2026-10-15获用户明确确认通过。第三阶段基本完成：两主题货架、阵列及网格详情进入同一ArchiveScene/WebGL renderer；Future货架不再回退阵列，程序货架/地面、主题铭牌和主动质量检测已接入，实现与必要自动验证已完成。阶段设计与验证边界见[统一架构](UNIFIED-ARCHITECTURE.md)。
- 第三阶段TypeScript/Vite构建（1652模块）、公共目录/状态/转场、控件/管理页返回、实际Scene/GLB/鼠标命中/几何净空和隔离性能检测流程均通过；截图已复核。浏览器检查使用合成数据及专用profile，不读取个人曲库或调用音频设备；不等于Electron整窗、硬件60FPS或用户阶段验收。
- 第四阶段基本完成，清退与必要自动验证已完成：公共目录直接生成两主题控件/网格，旧Canvas/sprite和目录适配生产链已移除，保留兼容偏好读取和主题皮肤。TypeScript/Vite、目录/状态/转场/指针、真实两主题Scene、完整模型/编辑器/纸卡/铭牌/生命周期及检测E2E通过；源码ZIP导出已补齐benchmark HTML和Vite配置。后续直接在当前main按用户测试反馈修复细节；未将自动检查扩展为逐项人工或硬件验收结论。
- 用户通过“启动源码验证.cmd → 主题盒体预览”看不到新版。已修复固定GLB地址遇到长期immutable缓存的更新缺口，并重新构建；隔离Chrome跨进程回归通过。
- **尚未收到用户确认缓存修复后实际窗口已显示新版**，不能标成已完成人工视觉验收。
- 当前浏览工具栏在两主题分别显示完整SHOW/LAYOUT/GROUP/SORT：Punk位于右上角两行，LAYOUT选中显示橙色点；Future位于左上角对应两行并移除内嵌筛选框；Punk查询复用顶栏SEARCH ARCHIVE。公共view/query在两主题和设置 → 音乐库的旧排列别名间同步，切主题保留状态，设置文案指向浏览工具栏；STYLE不再显示“视图与浏览”整块，专注外观、盒体与画质。TypeScript、1653模块界面构建、公共目录/状态与隔离`--display`检查通过；两主题三布局按钮、字段同步、筛选空集恢复、曲目身份、设置别名和查询Esc已验证，Punk三布局橙色点、Future无内嵌输入与GRID计数无交叠检查通过，截图已复核。报告在`.tools/foobar-layout-check/display-controls.json`，构建日志在`.tools/browse-toolbar-refinement/build.log`；本轮未运行个人播放器或音频设备测试。
- 当前LAYOUT文案映射为内部`shelf`→ARRAY/阵列、`array`→MATRIX/矩阵、`grid`→GRID/网格，偏好字段与JSON值不变。两主题`shelf`实体ARRAY共用按列选择与滚动：默认每列首张对齐，选中项只移动当前列；以列为key保存运行态scroll anchor，切走时velocity归零并保留位置，切回沿用，目录返回也恢复`rememberedSlots`。滚动目标为`clamp(selSlot-4,0,20-visibleSlots)`；位置`pos=lane-focus`，移出视口的列仍隐藏，右侧旧列`pos<=-1`不因已保存位置留在画面。`rowAlpha=clamp(1+pos)*clamp((4-pos)/.8)`，`rowTint`按.1步进、最多.8，左后列色调层级为.5/.7/.8；各盒体部件与点击命中同步淡出。`MusicArrayAppearance` v3仅传递per-instance alpha/tint并保留alpha discard，不在材质内应用rowTint。`MusicArrayFadePass`在同一Scene/renderer的OutputPass（PlaybackGlassPass）后执行flat depth row mask与一次sRGB最终合成，让透光玻璃/封面完整合成后只淡化一次，避免transmission/tone重复洗白。ARRAY增加一次flat-mask Scene render与一次全屏合成，使用RGBA8+depth RT；不复制几何或新建第二canvas/renderer，但有额外渲染开销，未得出设备FPS结论。resize时pane暂不可测则将旧`arrayBrowseWidth`按窗口比例缩放，native浏览clip共用`availableWidth`；Archive 1040/1248/1664尺寸按65%边界，Future沿用完整scene宽度。ARRAY的native `navigationOrbit=0`，MATRIX保留既有orbit与连续波动；画质值仍为`off/basic/reduced/full`。
- 上一轮实际运行的ARRAY cover rowTint before/after专项、array-composition、full unified、TSC与最终interface-only build均通过，runtime/shader/blockedRoutes=0；build log在`.tools/array-cover-visibility/build.log`。before/after报告在`.tools/array-cover-visibility/{before-report.json,after-report.json,after-*-rowtint-on/off.png}`；composition报告为`.tools/array-composition/{array-composition-audit.json,array-composition-screenshots.json,unified-render-audit.json,scene-motion-unified-audit.json}`。上一轮pure helper与album pointer未重跑；pure helper沿用`66589e7`基线`.tools/array-composition/pure-motion-audit.json`（targetRow/列anchor逻辑未变）。`.tools/array-surface-refinement`仅为更早历史，不作为当前motion验证。
- 两主题shelf ARRAY单凸起带起验证通过；MATRIX及非`shelf`布局不变。TSC、最终interface-only build、`--array-bump` pure/Scene/MATRIX/UI guards与`--array-composition`复跑通过，runtime/shader/blockedRoutes=0。四档中心slot实测邻居总数`0/2/4/8`（每侧最多`0/1/2/4`），邻居高度`0/.374/.561/.677`，中心峰值保持`2.098`；快速正反选停止5秒无迟到返波且尾帧变化为0。`returning-array` hover相对无hover反事实首帧约`+.01`，目录/focus保持。MATRIX实际full/off扫描150帧确认pulse已发出，远4行maxY差`.0712`、相邻列`.0604`，三组rail guards通过。报告为`.tools/array-bump/{build.log,pure-motion-audit.json,array-bump-report.json}`及同目录9张PNG。未重跑full unified或cover白板专项；fader源码未改，旧fader报告保留历史。旧`.tools/array-echo`仅为已撤回方案产物，不证明当前行为。以上为自动检查，不外推硬件FPS、完整app人工验收或用户通过；新曲线是用户反馈驱动的项目观感模拟，不是原作者代码或物理实测。
- 两主题shelf/实体ARRAY托盘对比细化通过：TSC与最终interface-only build通过（`.tools/array-tray/build.log`），`--array-tray --after`八组通过并输出`.tools/array-tray/after/array-tray-report.json`及16张PNG；覆盖两主题day/night与requested/effective floor组合，Future的requested deck实际映射plain，root已复核Archive/Future近景。`--array-composition`十项复跑通过，新增lane parts显隐已由snapshot归类；MATRIX guard确认托盘隐藏，runtime/shader/blockedRoutes=0。active texture disposal为0，仅证明切换时没有过早释放，不代表最终destroy路径验收。此轮未重跑full unified或cover visibility专项；motion/fader/main-floor源码未改，旧报告仅为历史。纹理资源由代码统一分配/释放，不据此推断硬件性能、原版像素一致或用户认可。
- GRID分页细节已接入公共view与MusicApplicationState：`view.gridPageSize`支持10/36/50/75/100/200、默认36并跨主题持久化；`gridPage`只在运行期保存。GRID只渲染当前页，筛选/show/group/sort/page-size变化优先回第一页，主题/layout切换保留页码，结果减少时夹到合法范围；单独改变选中entry时显露其所在页，手动翻页不被选中项拉回。分页不改变选择、曲目身份和详情，也不改变3D货架20槽规则。TypeScript、1653模块界面构建、统一状态及211条目分页纯检查通过；隔离`--display`验证六档页大小、跨组全量计数、筛选/SHOW/GROUP/SORT重置、主题同步、非首曲详情、页按钮键盘焦点、Punk纯106px封面及四角选框、Future卡片保留和STYLE无分页入口通过，截图已复核。报告在`.tools/foobar-layout-check/display-controls.json`，构建日志在`.tools/grid-catalog/build.log`；未访问个人曲库或调用音频设备。
- 两主题货架、阵列、网格详情共用ArchiveScene/Three.js renderer、实例池、封面图集与后期覆盖，保留各自盒体、材质、配色和右栏裁切。旧Canvas/foobar目录渲染链已在第四阶段删除，不作为当前源码回退选项；旧实现可从Git历史追溯。
- Future第二阶段视觉反馈及历史验收仍有效：当时浏览页左上角的显示/分组/排序与STYLE共用view；资料区移除整块圆角玻璃底，以原音乐信息、细线及分段遮罩揭示呈现；ACCESS ALBUM保持小号文字/箭头和中英无障碍名称，Punk皮肤保持。第二阶段已获用户验收；本轮工具栏补齐布局并调整入口，隔离UI回归已通过。第三、四阶段基本完成，后续逐步修复细节。
- Future完整终端受光下的顶栏灰白块/平边已修正：闲置透明项不接收卡片阴影，日夜切换由玻璃容器统一受光；滚动顶栏增加透明光效留白但按钮位置不变。歌词主面板外阴影不再被桌面载体裁掉，内部裁切与窄屏滚动保留。极致/高画质预设未降低；修正后的源码界面已重建，已纳入2026-10-15第二阶段用户整体验收；不作硬件帧率结论。
- 顶栏胶囊保留左右各16px内边距，移除按钮负边距并设置默认10px独立间隔，选中与悬停胶囊不重叠；外侧柔光留白48px继续保留。构建及现有--glass检查通过，截图已复核，1920默认视图测得相邻导航边框盒间距均为10px。
- Future盒体仅「简单粗糙 / 精细 / Punk拓展」；精细用RhineLabUI外壳，盒内纸卡与局部透明窗在左，完整原标签移到右侧信息区；移除展示内构并避开压边/刻度。Punk主题只允许自己的盒体，旧结构选择归回punk，已保存外观/变换及Future配置保留。以下遗留项不是自动继续开发的指令。
- Future简单粗糙款无编辑选项；精细款只调分部件透光率/透明度，保持源材质，重置只清光学覆盖；Punk拓展移除独立通用区，保留自身深度定制及命名个人预设。Punk主题编辑器现共用Future的Punk拓展布局和操作分组，保留Punk风格与唯一自有结构；两主题个人库分别为futurePunkPresets/archivePunkPresets，各自保存、使用、确认删除。
- Punk主题已移除旧CASE SKIN列表、原图盒体预览及原PNG/可调开关，保留主题配色、配色预览与显示设置，使用自制可调Punk模型，货架/阵列/详情均实时三维。旧enabled=false读取为true，不重置材质/部件变换/个人预设。两个主题Punk的颜色及纹理辅色均可输入HEX，与色盘同步，支持三位/六位、Enter/失焦提交、无效拒绝和Escape恢复。
- Future精细款按真实源信息独立判断Hi-Res/DSD，双项并排、单项同尺寸居中，普通/未知留空，保留自身无灯光效果并尊重减少动态；主场景、编辑器及查看器复用同一组件。用户已取消给两个主题Punk盒体加格式徽标，环上方和刻度旁的方案均已撤回；Punk继续只显示完整动态铭牌。
- 精细动态标签的右侧缺字/标记及边线缺失已定位为深度写入关闭后的壳体覆盖，现已让选中、阵列及退场标签写入深度；原版式和源几何保留，近景完整性已单独验证。
- 两个主题的Punk右侧铭牌现复用完整RHINE LAB/INFO/动态NO/标记纸面，无灯光材质不参与反射；预览、Future三维阵列/退场副本、查看器源模型和Punk模型缓存路径均接入。Punk铭牌等比居中并跟随标签板变换/显隐，TRACKS按父专辑编号；源GLB/PNG和个人预设保留。

## 全局进度

“已实现”表示源码已有行为；“基本完成”表示当前阶段收束并转入细节修复，均不等于完整人工/硬件验收。

| 区域 | 当前实现 | 未完成/边界 |
| --- | --- | --- |
| 桌面/服务 | Electron独立窗口、loopback服务、原生音频、构建/组件指纹校验；阶段独立App复用已有运行时，窗口标题读取载荷版本 | 不是正式发行或新安装器；个人播放器/设备验收仍待用户 |
| 两主题 | Future/Rhine与Punk/Audio Archive，各自完整外观，共享播放器 | 整体美术与实际手感仍需反馈 |
| 导航/曲库 | Archive回唱片主页；设置内管理目录/扫描；同窗口EQ/歌词/信号/主题 | 不恢复独立library入口或Playlist |
| 专辑操作 | 统一右侧基本信息/PROFILE、唯一打开按钮、曲目/介绍展开和点击区域焦点 | 已纳入2026-10-15第二阶段用户整体验收，隔离检查记录保留 |
| 专辑队列 | 两主题播放条上方浮窗，只列当前播放专辑，点播不强制跳页 | 不是跨专辑总队列 |
| 公共目录/交互 | 两主题共用专辑/曲目、筛选、流派/歌手/年代/字母/不分组、艺术家/标题/年份/添加顺序；公共entry身份、实体托盘槽位/连续排列导航与网格详情；完整浏览工具栏调用公共view/query，LAYOUT映射`shelf`→ARRAY/阵列、`array`→MATRIX/矩阵、`grid`→GRID/网格 | TRACKS每曲一盒、父专辑编号；ADDED无时间戳，用稳定库顺序；网格每页数量为共享view设置、页码为运行期状态；本轮命名、单排位移与水波隔离检查通过 |
| 布局/主题适配 | 浏览页两主题均显示SHOW/LAYOUT/GROUP/SORT；GRID按主题呈现并支持共享每页数量、总数、查询及二维分页；Punk在右上，Future在左上；STYLE集中外观/盒体/画质。同一ArchiveScene/WebGL renderer和实例池服务实体托盘、连续排列与网格详情 | 第三、四阶段仍为基本完成；旧Canvas/foobar生产链已删除，网格分页及两主题旧控件隔离回归通过；Punk实体ARRAY已按20槽逐排独立，真实矩阵与浏览/详情可见性检查通过 |
| 公共渲染/主题资源 | 共享封面图集、铭牌、后期覆盖；MusicShelf/MusicSceneResources按主题着色，MusicCaseTitles绘制Punk纸面标题；plain/deck/程序木质桌面细节 | 无原货架/地面3D网格；新几何是估算重建，不是原网格或像素复刻；无GLB/PNG修改 |
| 质量检测 | 固定80张合成专辑（6组、每专辑2曲）使用生产ArchiveScene，预热四档测货架及开合；最高稳定60FPS档建议、用户采用才保存。四档流程/取消重启/键盘隔离/存储/父目录保持与采用守卫的浏览器检查通过 | 本次Chrome流程为960×540/DPR1、Future简单款；不代表完整Electron或用户硬件性能。没有真实曲库、音频API或外站/API/音频请求，个人配置未读写 |
| 主题/质量 | 画质/比例共用，外观/盒体按主题保存；Archive显示“水波强度”，Future显示“波动效果”；波动/光照/终端光分调及组合预设 | 画质波动值`off/basic/reduced/full`保持不变；本轮文案和单排行为的隔离检查通过，实际整窗手感继续收集反馈 |
| 唱片盒 | Future简单款无编辑、精细款独立透光/透明度；Punk拓展与Punk主题共用十套内置/部件下拉/折叠进阶/个人预设布局，视觉与两套个人库独立 | Punk重建原PBR未知，不能称100%复刻；实际窗口交互仍需用户验收 |
| EQ | 入门图形/参数、Poweramp导入、预设/工作区/备份；固定官方LSP CLAP弹窗 | LSP实际窗口/状态/播放整体验收不足 |
| 歌词 | 共同三栏、同步/翻译/定位、真实频谱、选项弹窗和来源/缓存 | 单次线上成功不等于所有歌曲可用 |
| 信号 | 3D/2D/CLASSIC/SPECTRUM统一顺序，真实FFT/本次轨迹，缓存/按需绘制 | 调度/主线程成本不等于GPU端到端帧率 |
| 音频核心 | libFLAC/FFmpeg、double队列、DSP/SRC、WASAPI/ASIO、纯输出、DSD独立路线 | 旧硬件报告不覆盖当前LSP/全部设备 |
| 数据/语言 | 标签优先、多碟、只读FTP/FTPS、简体中文/English | 不自动写标签；未知第三方诊断保留原文 |
| 在线库/搜索 | 保留既有Internet Archive/Subsonic等在线入口 | 不承诺所有在线源可用原生输出，见[在线库边界](ONLINE-LIBRARY.md) |

## 当前视觉方向

### Future / Rhine

来源是《莱茵生命：访问》和现有唱片选择页；现代工业终端/瑞士排版结合Space Age几何。与Punk共通的档案编号、标签、刻度可以保留，操作面板本身应现代、轻透、有悬浮层次。

色盘继承 `music.css` 日夜变量：日间page `#e8e5e1`、surface `#efede7`、accent `#b56834`，夜间原深蓝玻璃。光向跟唱片场景一致；细腻色变、透明、磨砂、反射及局部自发光共同形成层次。不是把主体颜色混成背景光斑，也不是添加墙板/隔断。

右侧资料顺序与歌词三栏保持；唱片信息用悬浮文字与细规则线，不再有整块圆角玻璃底。浏览页左上角提供SHOW/LAYOUT/GROUP/SORT两行控制，GRID时另有PER PAGE、当前结果总数和查询；Future的136px圆角文字卡片及主题皮肤保留。ACCESS ALBUM无框文字入口先退场，再分段揭示现有歌单/介绍。STYLE专注外观、盒体与画质。时钟/EQ/信号已有Future专属样式；切页使用可中断分层View Transition，右栏reading veil独立管理。具体交互见 [主题系统](THEME-PAGE.md)。

### Punk / Audio Archive

参考孤星/太空时代与Apollo控制台：紧凑标签、编号、刻度、黑色铭牌和机械仪表。全部色系通过token适配；英文Geist Mono/Archive Mono，中文微软雅黑UI/微软雅黑逐字形回退，原字号/字重保留。

EQ保留真实范围刻度、对数频率/Q旋钮与读数；歌词共同三栏再Punk化。SETTINGS紧跟时钟；顶栏可见横滑条、打开专辑橙箭头已移除。信号大环主体维持。

GRID是纯106px方形封面墙，间距约26px；选中项使用黑色细框与accent四角，标题/资料只在右栏和卡片无障碍名称/hover信息中出现。分组标题呈现类别（GENRE/ARTIST/DECADE/A-Z等）、序号、名称、横线与全组总数；左上总数为当前目录结果总量。

## 唱片盒的当前状态

| 结构 | 正式来源 | 精度/定位 |
| --- | --- | --- |
| minimal | `public/assets/music-cd.glb` | 极简、极致省资源，不以画质预设强制换结构 |
| rhine | RhineLabUI `archive-cassette.glb`外壳运行时筛选；原文件未改 | 33,256三角形、13材质网格/10部件；左侧盒内纸卡/清晰窗，右侧原标签与独立信息区，周围原磨砂 |
| punk | `art/build_punk_reference_case.py`、对应Blend/GLB | 98,080三角形、15部件，原PNG多视角重建 |

Punk已完成的结构/光学：

- 上下全宽横梁包短侧柱，顶槽短斜阶；宽面和倒角法线分开。Blue黑面修复限定本项目shader各向异性分母保护，没有改Three依赖。
- 整面封装玻璃、内部实体专辑、凹入右薄内板、前置铭牌与外玻璃定位线有独立层次。sprite生成纸面受光乘封面，再叠前玻璃，不用空盒固定alpha代替遮挡。
- 小徽记按可见橙芯描8段Bezier，“/”支在前；optics透明软管、accent内部圆芯、emblem局部白包覆分别处理。27描点最大误差约0.683源像素，只代表中心轴拟合。
- 仅小管用受光/Fresnel薄壁alpha近似，避免细芯被屏幕空间体积透射冲淡；大玻璃仍体积透射，包覆/内芯不透明。不是完整物理折射/原材质复刻。
- 真实矩形纸卡削减被挡间接环境光，直接光仍shadow map。Editor、Scene、缓存、Viewer拆解同步卡片显隐/相对深度，空卡不留假遮挡。
- `presetRevision=4`只迁移完整指纹一致的旧V1/V2/V3；custom/手改与变换保留。Rhine借用配色不套Punk小管规则。
- 内容版本URL `assets/punk-reference-case.glb?v=f48266d5fa51` 已接入；导出自动生成 `src/punk-case-asset.ts`，源码清单纳入GLB并核对版本。

剩余美术差异：两道白包覆接缝偏弱，底冠内缘及短露橙芯位置/长度仍有差异；隐藏轴与原PBR不可恢复。十套边框颜色/材质已修正，但整体相似度仍需用户验收。

## 最近验证证据

以下按阶段保留已执行证据；较早阶段的界面与开关描述不覆盖上方当前状态。

| 阶段/证据 | 已验证 | 未覆盖 |
| --- | --- | --- |
| 统一架构第四阶段 | TypeScript/Vite 1652模块；公共catalog/markup、旧配置迁移、有限货架、状态、21项转场和统一pointer纯检查；display/navigation；真实Scene两主题/曲目分页/父编号/禁Punk徽标/旧关闭配置归正/空过滤/跨布局/非对称支撑与开盒可见通过。默认完整case链保留7组模型细节、真实编辑器、预设、铭牌、纸卡/查看器/退场材质纹理与异步最后请求优先；实时纸卡红绿背壳封面采样差0且遮挡API产生实际像素响应。检测E2E在专用Chrome profile跑四档/双场景、两轮结果、取消/重启/离开/键盘/存储/过期采用与父状态保护通过，运行/shader/白名单/音频API/外站请求错误均0 | 检测fixture为960×540/DPR1、Future简单款；图形/组件流程验证不代表用户个人曲库、音频设备、整窗手感或硬件60FPS。历史验证产物见`.tools/unified-architecture-stage4` |
| 统一架构第三阶段 | TypeScript/1652模块界面构建；目录/状态/21项转场及STYLE控件/返回回归；实际Scene/本地GLB验证两主题货架、29曲目20/9页、唯一WebGL画布、空过滤恢复、父编号、真实鼠标命中/双击、右栏裁切、非对称变换支撑/净空/完整开盒可见；四张日夜主题截图已复核。生产检测UI和编译iframe在专用Chrome profile跑完整四档/双场景，取消/重启/离开、T/Tab/Esc、消息校验、过期采用拒绝、用户采用一次、空只读存储/父目录与测试哨兵保持通过；音频/API/外站/运行与console错误均0 | Scene图形与检测流程分别验证；未启动个人播放器或读取个人曲库/配置，不等于Electron整窗、硬件60FPS或用户阶段验收。检测流程夹具为960×540/DPR1、Future简单款；朋友品尝版未更新，阶段运行包已退役 |
| 历史第三阶段交付核验 | 提交`c7987ee51989ebb89f72bf9fc721b5da487f4bc4`对应的App与staging payload各3402文件当时均通过manifest全量SHA-256；源码ZIP含Vite/benchmark/旧case renderer，EOCD commit注释与标签一致；staged App隐藏mock GUI 12项通过 | 阶段交付物已按用户要求移除；历史隐藏mock GUI结果不代表个人播放器或设备验收，报告保留在`.tools/unified-architecture-stage4/stage3-independent-*` |
| Future终端玻璃光效 | TypeScript/2341模块构建；--glass真实顶栏SVG、歌词组件与终端光控制器，离线待机曲目/请求，日夜×off/local/high-full/ultra-full共8组，文字/几何不随画质改变；闲置导航无receiver/实体阴影、主题玻璃只受光一次、已选导航保留动态受光、24px光效留白、900px歌词外层auto滚动通过。修复前后1920按钮rect完全相同；歌词底边外1–20px像素对照，日间近边阴影差9.667降至远处1，确认阴影向外衰减。--panel的114项布局、真实歌词与终端光生命周期/主题清理检查通过；旧信号A/B曾采到空白图，夹具改为等待native图像/布局帧，原像素阈值保留后通过 | 合成DOM/歌词服务与CSS截图，未启动个人播放器、访问个人曲库/设备或做GPU性能验收。高与极致均启用full终端光效，本检查区分的是UI受光，未把3D画质差别冒充DOM光效差别 |
| 第二阶段Future视觉补验 | TypeScript/2341模块构建、公共目录/状态与21项presentation检查；--display使用真实控件/生产点击，确认左上目录选项与STYLE同步、控件与状态提示/网格/右栏无重叠、ACCESS实际11px/188×42px、无整块玻璃伪元素、原资料/详情节点及Punk标签保持；日夜浏览/详情截图已复核。--panel的114项布局及开合、中断、焦点、阅读遮罩/滚动、主题保持、Future字段mask检查通过 | 合成目录和DOM/动画端口，截图没有启动真实个人播放器/3D场景；未使用个人曲库、音频设备或做硬件性能验收，用户于2026-10-15确认第二阶段整体通过；此处合成检查不作为硬件性能证明 |
| 统一架构第二阶段 | TypeScript/2341模块界面构建；catalog/shelves/array身份与缓存、曲库刷新版本、导航循环/边界、artist及genre ID分组、能力回退的纯合成检查通过。真实MusicPresentation及生产选择/视图函数验证转场中切布局仍保留目标非首曲目、SHOW改变后失效key回退；21项转场检查通过。--display运行生产STYLE事件、真实页面/控件/网格卡片与显式模拟目录端口，详情/曲目/右栏节点及排列别名通过，两主题控件/网格截图已复核、旧LAYOUT隐藏。--navigation四组返回/Esc路径与--panel的114个离线布局场景通过。--punk-view实际Scene/GLB验证Future精细TRACKS双曲独立单元/父编号、两主题网格详情公共阵列镜头、空过滤恢复及Punk机位/指针命中 | 目录UI夹具和三维场景分开验证；未启动个人播放器、读取个人配置/曲库或调用音频设备。此处自动检查未验证整窗人工手感/硬件帧率；后续用户于2026-10-15确认第二阶段整体通过；完整统一渲染与Future货架/地面尚未实现 |
| 第一阶段管理页返回 | 最终界面构建/公共状态检查通过；--navigation运行实际生产打开/ARCHIVE点击处理器、STYLE进入、主题切换、管理页关闭及全局keydown，使用真实MusicPresentation/SurfaceTransition/PageScanTransition/右栏/壳组件，模拟Scene与播放器端口。双主题方向、日/夜、减少动态、原生ViewTransition和缺失API回退的4组路径通过，详情/页签/选择/非零阅读位置保留；CDP鼠标点STYLE空白后实际Escape停留原页，真实信息弹窗优先关闭，音乐详情Esc回架 | 合成DOM与数据，不能替代完整窗口人工验收；第一阶段已获用户复验通过 |
| 统一架构第一阶段 | TypeScript/2334模块界面构建；公共状态/迁移/桌面白名单、真实catalog和应用主题/保存/播放编排的合成检查通过；TRACKS回归、quality（含48设备限制组合）、21项presentation检查通过；--panel的114个离线布局场景及新增右栏跨主题实际renderDetail/面板/壳组件检查通过，同body/tab/row、曲目焦点、滚动80及展开状态保持；--punk-view实际Scene/GLB/鼠标命中和目录身份回归通过。无CSS或模型修改，修复旧壳移动公共面板时的焦点/滚动丢失 | 应用编排使用模拟UI/渲染/音频/保存端口，浏览器主题分派也为fixture；实际Scene在独立图形fixture验证。未启动个人播放器、读取个人配置/曲库或使用音频设备，不代表整窗人工/性能验收；第一阶段已获用户验收 |
| Punk FUTURE展示视图 | TypeScript/2332模块界面构建；--punk-view使用真实ArchiveScene/Punk与Future GLB及合成数据，Punk新视图与Future相机位置/朝向/FOV一致，保留Punk结构/配色；真实鼠标命中canonical专辑及entry key、TRACKS双条目/父编号、筛选空集恢复、打开状态和视图返回、JSON规范化与桌面偏好白名单保留future值通过；右区裁切的实际浏览器截图及背景像素检查通过。原盒体完整回归与music-camera通过，无shader/runtime/blocked-route错误；--panel的114个离线布局场景通过，日夜array→future→array→grid右栏节点/rect/内容/tab/焦点保持 | --panel的目录分派为mock，三维与指针在独立真实Scene fixture验证；未启动个人播放器或访问个人曲库/设备，不等于整窗实机人工验收 |
| 盒体入口与HEX输入 | TypeScript/2331模块界面构建；完整隔离盒体回归、个人预设与标签helper检查通过，19:55生成report.json，shader/runtime/blocked-route错误均0；旧CASE SKIN列表/原图预览/启用开关移除，配色、显示、主题与画质入口保留；旧关闭配置启用自制Punk并保留材质/变换，Future配置独立；主/辅色HEX支持三位/六位、无#、Enter/失焦提交、非法值拒绝与Escape恢复，个人预设保存/重载通过；Punk三维/缓存仅完整铭牌、不显示格式徽标，1920编辑器与阵列截图已复核 | 隔离合成数据与浏览器验证；未启动个人播放器或访问个人配置/曲库/设备，实际窗口仍需完整重启后由用户确认 |
| 两主题Punk完整铭牌 | TypeScript/2331模块界面构建、标签helper缩放/contain/字体回退检查、完整隔离盒体回归；实际Punk GLB近景完整，强灯光/环境变化下铭牌区域比较226,920像素差异0；001/010阵列与退场编号独立，标签板变换/显隐及snapshot隐藏恢复通过，材质保持Basic；原PNG/可调缓存的阵列/近景和TRACKS均使用完整铭牌，合成两曲共用父专辑NO.001，放大图已复核 | 不访问个人曲库/设备；查看器source接入已代码审查，完整ModelViewer窗口仍未实例化实机验收；fixture字体回退不代表全部实际字体已验收 |
| Punk编辑器布局对齐Future | TypeScript/2331模块界面构建、desktop脚本语法、独立预设检查及完整隔离盒体回归；内置/材质/个人区顺序与Future一致，部件下拉、进阶/取材/变换折叠生效；Punk唯一结构及启用开关保留；两库独立保存/应用/重名拒绝/删除/JSON重载，切主题后外观与启用状态保留，桌面白名单分别保存；fixture中Punk方角3px、Future13px，配色token有别、字体继承；1920顶部及材质/个人区截图已复核 | 合成fixture计算样式，不代表实际播放器的全部配色或字体已实机验收；未访问个人配置/曲库/设备，完整退出并重启源码窗口后由用户确认 |
| Rhine标签完整性 | TypeScript/2331模块界面构建与完整隔离盒体回归；Canvas完整，深度写入开/关A/B有可测差异；选中、阵列及退场标签depthWrite=true；生产带壳近景与无壳标签在纸面内部比较54,058像素，差异0，INFO、完整标记及上下规则线已放大复核 | 隔离合成近景；未启动个人播放器，实际窗口仍需重启确认；不以font.check结果证明字体已注册 |
| Rhine动态编号/格式徽标 | TypeScript/2331模块界面构建、Canvas编号/缩放与独立格式分类检查、完整隔离盒体回归；全DSD同时显示Hi-Res+DSD/type3，单项居中、双项并排缩小；真实WebGL同一标识单/双显示的图形宽高差0像素，双标中央留空，单标中心偏移小于2像素；本地SVG、001/010实例编号、元数据原地刷新、退场贴图/材质与图集销毁边界通过；动效变化有效，减少动态跨帧与大幅改变灯光后的徽标均0像素变化；合成整盒效果图已复核 | 无个人曲库/设备访问；DSD-only仅低层合成shader分支验证，不伪造源分类；完整ModelViewer窗口仍未实机验收，实际播放器效果待用户确认 |
| Rhine盒内封面/透明窗 | TypeScript/2329模块构建；几何检查保留标签/边框/底标完整岛，整组右移标签/16字形岛、底标不动；左窗与前置细节零相交，label元数据同步；真实GLB清晰/磨砂/空卡/斜视A/B，窗外差异0像素，棋盘对比217/1，旧不透明涂层下208；卡片深度/阵列/遮挡/预设回归 | 统计限定隔离合成图与当前源资产；未启动个人播放器，完整ModelViewer窗口仍未实机验收 |
| Future盒体交互与个人预设 | TypeScript/2328模块界面构建；独立预设/光学覆盖JSON往返检查；隔离UI简单款无编辑、精细光学保存/重置、Punk专属定制与个人库；实际Rhine GLB覆盖alpha0/.4/1、原PBR保留、完整光学/深度/投影状态恢复；Archive回归 | 未读写个人偏好文件或启动实际播放器；Future新交互需用户验收 |
| 当前主题盒体修正 | TypeScript/2327模块界面构建；默认隔离盒体检查、Future三选/Punk唯一结构、旧配置迁移、隐藏入口拒绝、主题刷新保留Future配置；cassette与指定上游提交Git blob一致 | 未启动个人播放器/曲库/设备；实际美术仍需用户确认 |
| `4102feb`盒体阶段 | TypeScript、默认盒体检查、reference实际渲染；15部件/98,080三角形；无shader/runtime错误 | 不是源模型100%一致 |
| `.tools/case-system-check/report.json` | arrayClear同卡A/B暗化24,566像素；inspect近卡ROI 2.109/13.887；迁移/Editor/Scene生命周期 | 两固定array ROI仍0/0，未射线确认暗化像素是背板 |
| 迁移前ArchiveCaseRenderer截图（历史） | 当时的实际合成路径能输出 | 不代表第四阶段当前渲染路径，也不是所有合成层逐像素A/B认证 |
| Viewer | ViewerAlbumCover生命周期与完整ModelViewer接入/拆解代码审查 | 未实例化完整ModelViewer运行验收 |
| `19f82f2`缓存阶段 | 界面构建2327模块；Chrome155隔离持久profile跨两进程，旧URL仍821,720字节，新URL取得2,069,864字节及正确SHA | 未读取用户旧缓存，未启动个人播放器确认 |
| 早期音频专项 | 各报告限定的离线数值/回调/组件、默认设备PCM静音检查 | 不覆盖当前LSP、全部ASIO/DSD/DoP或全部硬件 |

本机忽略产物：

- `.tools/unified-architecture-stage3/`：最终构建、公共目录/状态/转场、控件和返回日志；`unified-render-audit.json`及两主题日夜/非对称变换截图为实际Scene验收。`quality-benchmark/acceptance.json`及结果截图为独立profile、合成数据的生产检测流程验收；换机器不自动安装浏览器或工具来复现。
- `.tools/case-system-check/`；reference摘要 `punk-reference/comparison-summary.json`。
- `.tools/unified-architecture-stage2/{build,display,navigation,panel,scene}.log`；第二阶段构建、公共控件/网格、返回与右栏、实际Scene检查。纯合成入口为check-music-display、check-unified-state、check-foobar-tracks；详细人工步骤见统一架构第二阶段验收点。
- `.tools/unified-architecture-stage2/{display-core,presentation}.log`；曲库更新缓存与真实生产选择转场回归。`.tools/foobar-layout-check/display-controls.json`及`display-{rhine,archive}-{controls,grid}.png`为真实卡片/控件、合成目录的两主题截图，不是个人播放器画面。
- `.tools/unified-architecture-stage2/future-surface-{build,display,panel,navigation}.log`；Future验收反馈修正。`.tools/foobar-layout-check/display-future-{day,night}-{browse,detail}.png`为合成页面截图，截图及字段mask记录在display-controls.json/album-open-flow.json。
- `.tools/unified-architecture-stage2/future-compact-{build,display}.log`；控件两行收拢/ACCESS去框后的构建与现有截图检查通过，已复核日间合成截图；不扩大到播放器/设备检查。
- `.tools/unified-architecture-stage2/terminal-glass-{baseline,current,pixels,build,panel}.log`；`.tools/foobar-layout-check/terminal-glass/{baseline,current}/terminal-glass.json`及对应topnav/lyrics-main/page截图保留修复前后UI光效证据，current报告含像素剖面及窄屏滚动。
- `.tools/unified-architecture-stage2/capsule-padding-{build,display}.log`；本次胶囊留白的构建与现有光效检查，current顶栏截图已更新；相对旧基线边框盒左移16px、宽增32px，纵向位置相同，padding/负margin保持图文排布。
- `.tools/unified-architecture-stage2/capsule-spacing-{build,display}.log`；当前独立胶囊间距构建与截图检查通过，current顶栏截图已更新。padding阶段的重叠处理不再适用于当前界面。
- `.tools/unified-architecture-stage1/{build,state,tracks,panel,punk-view}.log`；状态/目录合成与构建日志。右栏跨主题保持见`.tools/foobar-layout-check/album-open-flow.json`的themeContext，真实Scene报告沿用case-system-check路径。
- `.tools/unified-architecture-stage1/{navigation,return-fix-build,return-fix-state,return-fix-panel,return-fix-presentation}.log`；完整返回链路的报告为`.tools/foobar-layout-check/management-navigation.json`，含实际键盘事件、原生/回退ViewTransition和返回状态。
- `.tools/case-system-check/punk-future-view-audit.json`、`punk-view-punk-future-{albums,tracks,final}.png`、`punk-view-layout-mask.png`；新视图的合成三维、实际鼠标命中与右区背景检查，原右栏DOM/CSS检查见 `.tools/foobar-layout-check/album-open-flow.json`。
- `.tools/case-system-check/rhine-inset-album-{clear,frost,empty,oblique,mask,legacy}.png` 与 `rhine-inset-window-audit.json`；均为合成封面，不是用户个人曲库截图。
- `.tools/case-system-check/rhine-album-info-{hi-res,dsd}.png` 与 `rhine-album-info-audit.json`；分别为Hi-Res单标和DSD专辑双标的合成效果。
- `.tools/case-system-check/rhine-album-label-{canvas-raw,case-zoom-depth-write-off,case-zoom-depth-write-on,case-zoom-production,only-zoom}.png`；标签原图、遮挡A/B与修复后的放大验证。
- `.tools/case-system-check/archive-punk-editor-1920-{top,personal}.png`；Punk编辑器的隔离布局截图，主题实际配色/字体由外围页面提供。
- `.tools/case-system-check/punk-{box-full-label,label-closeup,label-array,label-snapshot}.png` 与 `punk-album-info-audit.json`；Punk真实GLB铭牌、无灯光/编号/变换及快照检查。
- `.tools/case-system-check/archive-punk-label-{legacy,editable,editable-tracks}-{array,inspect}.png`；Punk两条渲染路径及TRACKS的最终画布，*-source.png为相应原始铭牌Canvas。
- `.tools/punk-reference-case/sol-emblem-audit/final-source-vs-current-actual-roi.png`。
- `.tools/punk-reference-case/cache-refresh-check/cache-refresh-report.json`。
- 仓库旁 `.task-tmp/punk-model-cache-refresh-build.log`。

产物不随Git交接，换机器可能不存在。不得为补历史证据自动安装或执行设备检查。

## 接续优先事项

1. **正常开发与细节修复**：统一架构四阶段基本完成，当前只在main按用户提出的视觉、交互或功能问题定位和小范围修复，通过`启动源码验证.cmd`验证并记录本地Git；只做与改动相关的必要验证，不主动重开阶段实施或扩大重构。保留公共music-catalog-markup entryKeys、公共view处理器、LegacyCatalogOptions及偏好迁移/兼容投影、非音乐ArchiveScene、编辑器/查看器、GLB/PNG与字体许可。
2. **徽记/边框**：保留已经贴合的主曲线，按新反馈继续局部修正；颜色与光学是估值，不用单点RGB宣称全图一致。
3. **Future/编辑页**：保留现代终端和主题区别，尽量不改已完成页面；分类工具栏已纳入公共view。固定比例鼠标缩放/全屏恢复仍需实际窗口手感确认。
4. **LSP/音频设备**：完整窗口、状态恢复、复杂播放路径和硬件边界未全面实测，没有新许可不自动补测。
5. **品尝版交付**：已准备 `0.3.1-preview.1` 安装包及源码ZIP，作为朋友体验版；这不是项目完成或正式发行。两者是交付产物，不是第二份源码仓库；当前本地开发和GitHub发布共用main。安装版数据集中在安装目录，主题/EQ预设分目录，卸载默认保留。打包与安装/卸载验收分开记录，见[品尝版说明](PREVIEW-RELEASE.md)。RTX 5080掉帧是用户反馈，目前未测定瓶颈；检测推荐流程自动检查已通过，实际整体性能仍待用户验收，不因打包跳过。

## 不再继续的旧方案

LSP内嵌/自动整页/原生主题覆盖/DSP-only自绘进阶；Future整页Punk黑框、灰暗背景或墙板物件；小徽记实心白扭带/边缘橙带；独立library页面/Playlist；TRACKS普通列表/巨幅封面；整串中英强制微软雅黑/思源黑体；用旧EXE或旧硬件报告代验当前源码。

## 代码与文档地图

| 区域 | 首选入口 |
| --- | --- |
| 路由/偏好/设置 | `src/music-app.ts`；[本地开发](LOCAL-DEVELOPMENT.md) |
| 两主题/陈列/目录/公共资源 | `src/scene.ts`、`music-spatial-layout.ts`、`music-shelf.ts`、`music-scene-resources.ts`、`music-case-titles.ts`、`music-catalog-markup.ts`、`future-*.css`、`punk-*.css`；第四阶段清退旧`archive-case-renderer`/`case-sprites`/foobar目录链；[主题](THEME-PAGE.md) |
| 质量检测 | `src/quality-detection.ts`、`quality-benchmark.html`、源码验证Vite entry/manifest；synthetic iframe benchmark，隔离实际浏览器流程已通过 |
| 专辑/队列/焦点 | `src/album-panel.ts`、`album-interaction.ts`、`album-queue.ts`、`scene.ts` |
| 盒体/编辑/遮挡 | `src/case-settings.ts`、`case-model.ts`、`case-materials.ts`、`case-editor.ts`、`case-album-occlusion.ts`；第四阶段迁移并回归产品身份、指针命中、光学、纸面深度与材质生命周期；[模型](../art/README.md) |
| EQ/LSP | `src/eq-controls.ts`、`lsp-eq-controls.ts`、`native/lsp-clap-host.h`；[LSP](LSP-ADVANCED-EQ.md) |
| 歌词/信号/语言 | `src/lyrics-page.ts`、`signal-page.ts`、`i18n.ts`；[歌词](LYRICS.md)、[信号](SIGNAL-PAGE.md)、[语言](UI-LANGUAGE.md) |
| 服务/音频 | `scripts/music-server.mjs`、`native-output.mjs`、`native/audio-host.cpp`及PCM头文件；[音频](AUDIO-CORE-IMPLEMENTATION.md) |
| 资源/许可 | [来源](FOOBAR-STYLE-SOURCES.md)、[NOTICE](../NOTICE.md) |

历史从Git及带日期报告按需读。关键定位标签：`checkpoint/lsp-popup-restored`、`checkpoint/punk-emblem-card-occlusion`、`checkpoint/punk-model-cache-refresh`；它们不是继续旧试验或追加权限的指令。
