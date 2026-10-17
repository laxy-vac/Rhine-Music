# 当前主题与唱片页规范

Future / Rhine 与 Punk / Audio Archive 共用同一播放器、曲库状态、浏览交互和三维场景。本文记录主题表现与页面行为；公共状态、目录与渲染接口见 [UNIFIED-ARCHITECTURE](UNIFIED-ARCHITECTURE.md)，歌词数据规则见 [LYRICS](LYRICS.md)，语言规则见 [UI-LANGUAGE](UI-LANGUAGE.md)。

## 全局偏好

- 当前主题值为 <code>rhine</code> 或 <code>archive</code>。日夜、窗口比例、画质、动效和浏览视图由全局偏好管理，不由主题配置覆盖。
- 日夜跟随使用独立偏好 <code>followSystemTheme</code>，默认关闭。开启时读取系统当前明暗，不同时对齐一次；后续只在系统真实变化时比较当前状态，相同或重复通知不保存/重绘。手动切日夜不关闭跟随，也不被主动纠正；重启保留手动选择，直到系统下次变化。Future 的主题卡使用圆角控件，Punk 使用方角控件。
- 窗口比例由全局 <code>windowAspect</code> 管理，默认 16:9；固定比例包含 16:10、4:3、3:2 和 21:9，也可选择自由比例。最大化与全屏保留内容比例。
- 主题的陈列外观与盒体外观分别保存。两主题的个人 Punk 预设使用独立的 <code>futurePunkPresets</code> 与 <code>archivePunkPresets</code>，互不覆盖。
- 画质设置不切换主题、盒型、材质或个人外观；调色、透明度和通光率仍归各自设置管理。

## 共享唱片页

### STYLE 与 Settings

两主题的 `STYLE` 页面沿用原 Style 界面与预览，管理主题、日夜配色、主题色板、文字字号、唱片盒和场景外观。渲染画质、性能检测、窗口和显卡设置不放在 STYLE。内部页面值与导航 action 仍为 <code>theme</code>；<code>#music-theme-page</code>、<code>#theme-page-content</code> 和 <code>#music-style-title</code> 等兼容 DOM ID 保留，<code>#theme-quality-slot</code> 作为唱片盒编辑内容的插入位置。

Future 的日间配色在 STYLE → LIGHT 下选择“暖白 / 原版”（英文 SOFT / ORIGINAL）；DARK 仍是独立的全局日夜模式。保留旧偏好的暖白为默认，参考原版依据 [RhineLabUI theme-ui.ts](https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/src/theme-ui.ts) 的亮色值，并与播放器既有控件材质结合：

| 基础颜色 | 暖白 | 参考原版 |
| --- | --- | --- |
| 页面底色 | `#e8e5e1` | `#e8e5e1` |
| 主文字 | `#232722` | `#080a08` |
| 弱文字 | `#74786f` | `#77756d` |
| 强调色 | `#b56834` | `#9b7247` |
| 分隔线 | `rgba(42,49,42,.18)` | `#aaa59a` |
| 面板 | `rgba(245,244,239,.97)` | `#edebe4` |

参考输入区域使用 `#e7e3d9`。Three 背景/雾 `#eae5e1` 本已与上游一致；播放器专用唱片材质、灯光、空间布局保持其现有职责。选项保存于 Future 的 `style.dayPalette` 和主题档案中，缺失/非法值回退 `soft`；夜间和 Punk 不使用此配色字段，跨主题往返保留 Future 的选择。

控件参考用户视频采用两层共用胶囊：大选中底板在 LIGHT/DARK 间移动，日间的子底板在两种配色间移动。暖白和原版均保留左侧强调色色点；整个 Appearance 卡片随可用宽度扩展，标题、跟随系统与说明一起对齐，窄窗口收成单列。切换期间保持节点、焦点和页面滚动位置，快速反向操作从当前动画位置接续。颜色沿已有 650ms 过渡，减少动态时立即到位。键盘方向键和 Home/End 可选，Night 时日间子选项 inert，不接受 Tab 或指针操作。

Settings 固定为七类，每个控件只在所属类别出现一次：

- “界面与交互”（内部 ID <code>interface</code>，默认打开）管理界面语言、减少动态、唱片波动、终端入场、欢迎文案与 ID、界面音效和氛围 BGM。终端入场及当前音效仅 Future 生效；Punk 保留明确禁用的适配入口，不修改 Future 偏好。Future 音效跟随播放器输出设备，音乐准备/播放期间静音，暂停或停止后恢复；具体路由及释放规则见[音频实现](AUDIO-CORE-IMPLEMENTATION.md)。
- “显示与性能”（内部兼容 ID <code>appearance</code>）管理窗口比例、全屏、渲染画质、优先显卡和性能检测。
- 其余类别为“歌词”“音频”“音乐库”“音乐来源”和“关于”，分别承担原有职责。

画质预设和性能检测应用结果时保留唱片波动设置。仅唱片波动开关不同，不会使画质预设显示为“自定义”。全屏由拥有窗口的主 frame IPC 控制原生 BrowserWindow；按钮同步实际全屏状态，重复请求受忙碌保护，退出按钮与 Esc 均恢复当前 Settings 类别和窗口状态。Windows 原生全屏事件须在下一轮事件循环读取更新后的状态。

Windows 的“优先显卡”默认自动。DXGI 的逻辑适配器会按稳定的物理 PnP 身份归并；SetupAPI 从对应物理设备节点只读读取 PCI bus 与 address。Microsoft SDK 将 <code>SPDRP_BUSNUMBER</code> 定义为 21、<code>SPDRP_ADDRESS</code> 定义为 28；对于 PCI，address 高 16 位是 device number，低 16 位是 function number（[SetupAPI.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/SetupAPI.h#L6077-L6084)、[SetupDiGetDeviceRegistryPropertyW](https://learn.microsoft.com/en-us/windows/win32/api/setupapi/nf-setupapi-setupdigetdeviceregistrypropertyw)、[PCI 地址字段说明](https://learn.microsoft.com/en-us/windows-hardware/drivers/kernel/obtaining-device-configuration-information-at-irql---dispatch-level)）。PCI bus number 可能动态变化；PCI BDF 是设备位置标识，不表示主板上的用户可见插槽。

本机 RTX 5080 的隔离调查中，四个 DXGI/KMT 逻辑 LUID 均对应同一个 PnP 物理设备；SetupAPI 读取到 PCI 1:0.0，DXGI 报告显存 16,753,098,752 字节（15.6 GiB）。此前逻辑地址中的 <code>0:0.1</code> 和越界值不是物理 PCI 位置。偏好保存稳定物理 PnP 身份集合及当前会话 LUID；旧偏好只按精确别名迁移，不能按同型号猜测另一张卡。缺少物理身份或身份未确认的适配器不作为可选物理卡；LDA 多设备按 linked group 明示。相同型号但物理 PnP 身份不同的卡仍分别显示，标签包含型号、显存和物理位置，完整设备标识可展开。

LUID 只在当前会话有效；重新启动时按稳定物理身份匹配。选择仅为播放器后续启动设置 ANGLE D3D11 与适配器，不修改系统显卡配置、驱动或系统权限。物理身份映射解决的是设备识别问题，不代表 RTX 5080 掉帧原因已定位或性能已修复。

### 浏览与选择

两主题共用 SHOW、LAYOUT、GROUP、SORT 和目录 query。可见布局名称为 ARRAY、MATRIX、GRID，内部稳定键分别是 <code>shelf</code>、<code>array</code>、<code>grid</code>。SHOW 为 ALBUMS/TRACKS；GROUP 为 GENRE/ARTIST/DECADE/A-Z/NONE；SORT 为 ARTIST/TITLE/YEAR/ADDED。

Punk 工具栏位于右上，Future 位于左上。Punk 的 LAYOUT 选中使用固定橙色点；Future 工具栏不放额外筛选输入框，Punk 搜索使用顶栏 SEARCH ARCHIVE。GRID 时提供 PER PAGE 与当前结果总数；可选 10、36、50、75、100、200 条，默认 36。分组计数显示该组总量，不随当前页缩小。GRID 离开后隐藏 PER PAGE。Punk GRID 保留 RANDOM 操作及方形封面墙；Future 保留 136px 圆角文字卡片。

Punk 封面卡片为 106px 方形，约 26px 间距，选中使用黑色细框和主题色四角；标题与资料留在右栏、无障碍名称和悬停信息，不叠在封面图上。Future 的搜索、分组和排序使用相同目录结果，不在工具栏重复输入框。

TRACKS 的每首歌是独立 entry 和盒体，父专辑继续拥有封面、队列与编号。货架 20 槽分页与二维 GRID 分页互不影响；GRID 只绘制当前页。主题/布局切换保留当前曲目身份和详情，结果变化时网格页码按公共 view 规则调整。ADDED 没有时间戳时沿稳定库顺序排列，不编造日期。

方向键与滚轮浏览当前列和条目，Home/End 到当前列边界；G 在网格与最近空间布局间切换，R 从当前过滤结果随机选择，斜线键打开搜索，网格卡片可用 Enter 打开详情。货架首末边界停止；主题只影响外观与空间参数。

### 资料、打开与播放

右栏资料顺序为编号/格式、标题/歌手/基本资料、PROFILE、播放与打开操作。资料区和滚动容器不绘制整圈外框；按钮与曲目仍保留可见的键盘焦点。格式、位深和采样率来自源曲目，TRACKS 显示当前曲目，专辑显示实际范围；未知字段省略，有损编码不显示推测位深。

“播放专辑”与“打开详情”是独立操作。播放从当前专辑第一首开始并使用整张专辑队列；TRACKS 的当前焦点不会改变起播曲目，也不打开详情。空专辑与离线专辑禁用播放操作。Punk 用自然宽的双按钮组与细分隔线，不画常驻强调外框；Future 将 PLAY ALBUM 放在 ACCESS ALBUM 上方。Punk 操作组退场约360ms、返回约560ms，两侧标签仅在详情返回时同步解码；Future保留240ms主题遮罩。支持中断衔接及减少动态效果。

顶部不重复播放、暂停、停止操作；底部由两主题共用上一曲、播放/暂停、下一曲、停止、SHUFFLE ALL 和主题化 ORDER 菜单。SHUFFLE ALL、目录 RANDOM 与 GRID 中的 RANDOM 是不同操作。底部当前歌词句使用与歌词页相同的文档和偏移；具体空歌词与同步规则见 [LYRICS](LYRICS.md)。

Archive 从 EQ、歌词、信号、主题等同窗口页面返回原唱片上下文；在唱片页主动点击 Archive 才回唱片架。管理页面没有弹窗时，Esc 不跨页面导航；Esc 优先处理当前页内的返回、关闭弹窗或取消编辑。

## Future / Rhine

Future 的 ALBUMS / MATRIX 入场复用 RhineLabUI 的文字、Logo、权限圆环和欢迎轨迹，随后在现有 ArchiveScene 中展开阵列并平滑落到总览；全程约 25.36 秒，不自动打开专辑详情。跳过按钮固定显示 `SKIP INTRO ↗`。默认欢迎文案为 `Internal DataBase`，欢迎 ID 为 `Kristen Wright`，均保留原文、不随语言翻译。前端资源与首帧准备好后释放桌面显示门，再开始计时；窗口隐藏期间暂停。按钮、Enter 或 Esc 可直接跳过到总览。

默认每次新打开窗口都播放，不记录“已看过”状态；跳过不会关闭后续自动播放。Settings → 界面与交互 → 终端入场提供自动播放开关（`entryOnOpen`，默认 true）、欢迎文案（`entryWelcome`）、欢迎 ID（`entryIdentity`）、恢复默认和重播。两个文本字段仅接受 ASCII 英文字母与单词间普通空格，各最多 24 字符（含空格）；键入、粘贴、输入事件和保存均有边界，首尾空格去除、连续空格合并，空值恢复默认。非法偏好值在载入/写入时回退到默认，欢迎文字转义后插入；较宽文案按实测宽度缩小字号，保持单行且不改打字时间轴。

关闭自动播放后仍可手动重播；重播退出设置并返回现有专辑总览，保留当前选择与播放，不改变开关。昼夜跟随当前全局模式，减少动态、空曲库、设置语言返回，以及其他主题/排列仍直接显示现有界面；不支持当前入场时，重播按钮禁用并解释原因，不切换 view 或主题。实现见 [future-entry.ts](../src/future-entry.ts)、[entry-text-controls.ts](../src/entry-text-controls.ts) 与 [entry-preferences.mjs](../src/entry-preferences.mjs)。

Future 延续现代终端与轻透玻璃，使用唱片页的page/surface/accent token；夜间保留深蓝玻璃色系。光照使用现有场景和局部屏幕效果，不宣称全局光线追踪；背景不添加墙板、隔断或无功能立体物件。

右栏资料以悬浮文字和细线呈现，不加整块圆角玻璃底；ACCESS ALBUM 保留小号文字、箭头与原有无障碍名称，不绘外框或悬停底板。GRID 保留圆角文字卡片。EQ 保留浮起模块和竖向 gain fader；图形与参数模式的数值、选中频段和曲线节点同步，图例和焦点边界保持完整。

设置与在线弹窗由玻璃容器承接环境光。闲置控件不逐个产生外投光晕；hover、focus-visible、selected 等交互状态以内侧反馈表达。歌词选项弹窗打开时暂停背后接收器，关闭时恢复。光效质量 off/local/full 与减少动态设置继续生效。

Future 设置/Style/弹窗内的通用横向滑杆使用 28px 操作高度、5px 单轨和 16px 滑块，主题色填充显示已调部分；拖动、键盘及数字编辑同步进度，禁用态明确降对比。EQ 垂直推子与 Punk 方角皮肤保持各自规则。

本地搜索和在线曲库共用固定标题、独立正文滚动与无系统箭头的细滑块。搜索使用轻量输入框、圆角筛选和对齐结果，长名称单行省略并保留完整title；在线来源/合集用自绘菜单，关键词与搜索按钮等高并排，分区以细线组织。Future自有服务配置默认收起，Punk默认展开，接口与联网条件保持一致。组件样式见[future-panels.css](../src/future-panels.css)。

歌词页与 Punk 共用三栏结构；Future 的夜间当前歌词只用字重、颜色和小标记强调，不使用整行胶囊或 receiver 外晕。右侧播放卡绑定当前播放曲目及其盒体和同专辑后续队列，不随唱片浏览选择漂移。阅读、来源、偏移及频谱行为见 [LYRICS](LYRICS.md)。

## Punk / Audio Archive

Punk 采用紧凑标签、编号、刻度和工业分区。archive、hazard、flare、field、front、hearth 六组配色各有日夜主题，控件从主题 token 取色。英文使用 Geist Mono / Archive Mono；中文沿用微软雅黑 UI 与逐字形回退，不强制整句中英使用单一字体。

顶栏保留可访问的横向溢出，不显示原生横滑条；SETTINGS 紧跟时钟。EQ 保留真实范围刻度、270°对数频率/Q旋钮、增益推子和读数窗；装饰不能抢事件或改变 DSP。歌词页沿用三栏结构和真实播放盒体，Punk 保留方角与自己的控件皮肤。

Punk 右栏使用 accent 细框与方点显示格式摘要；专辑铭牌保留 RHINE LAB / INTERNAL DATABASE / INFO 与动态编号。Punk 盒体不显示 Hi-Res/DSD 徽标，格式徽标仅属于 Future 精细盒体。

## 盒体与资源规则

Future 的结构选择为简单粗糙（minimal）、精细（rhine）和 Punk 拓展（punk）；Punk 主题固定使用自己的可调模型。精细盒体使用上游 <code>public/assets/archive-cassette.glb</code> 外壳，保留源材质与外观。Future 精细款只允许分部件透光率和透明度覆盖；重置仅清除覆盖值，不改颜色、PBR、部件变换或已有外观。清晰窗默认透光率为 98%。

Future Punk 拓展与 Punk 主题共用编辑器分组和操作，视觉皮肤及个人库仍分开。HEX 输入接受 #RGB 和 #RRGGBB，可省略 #；提交时归一为大写六位，非法值不保存。个人预设保存完整材质与部件快照，不自动覆盖重名项目；两库各自最多 50 项。Punk 内置材质预设为 marble、hazard、white、glass、frost、red、blue、coral、tide、aurora。

盒体封面纸卡与印刷面由共享 helper 定位：正常厚度下相隔 0.002 模型单位，背层先绘制，选中项、阵列、预览和查看器使用相同顺序。此几何约束用于避免两面深度竞争；玻璃、阴影、封面和质量设置仍按各自材质工作。

原始货架/地面没有可直接复用的 3D 网格，当前由程序几何构成；盒体材质与部分装饰也含估算。它们不是原作者网格、原 PBR 或像素复刻。源 GLB/PNG 不烘焙专辑号；旧保存外观与部件变换按既有迁移规则保留，不自动重置。

## 实现入口

- 主题与偏好：[music-app.ts](../src/music-app.ts)、[music-theme-follow.ts](../src/music-theme-follow.ts)
- 浏览与场景：[music-catalog-markup.ts](../src/music-catalog-markup.ts)、[music-catalog-grid.ts](../src/music-catalog-grid.ts)、[scene.ts](../src/scene.ts)、[music-scene-resources.ts](../src/music-scene-resources.ts)、[music-case-titles.ts](../src/music-case-titles.ts)
- 资料与盒体：[album-panel.ts](../src/album-panel.ts)、[album-interaction.ts](../src/album-interaction.ts)、[album-queue.ts](../src/album-queue.ts)、[case-settings.ts](../src/case-settings.ts)、[case-model.ts](../src/case-model.ts)、[case-editor.ts](../src/case-editor.ts)、[case-materials.ts](../src/case-materials.ts)、[rhine-case-model.ts](../src/rhine-case-model.ts)
