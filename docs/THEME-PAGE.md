# 当前主题与唱片系统

更新：2026-10-16。当前进度/验收见 [状态](PROJECT-STATUS.md)，运行见 [本地开发](LOCAL-DEVELOPMENT.md)，素材见 [来源](FOOBAR-STYLE-SOURCES.md)。本文记录稳定主题设计，不把迁移前renderer作为当前回退承诺。

## 两套主题

| 名称 | 代码 | 视觉 |
| --- | --- | --- |
| Future / Rhine | design=rhine | 明亮、统一打光的现代正面终端；轻透玻璃、磨砂、悬浮控件 |
| Punk / Audio Archive | design=archive；shelf/array/grid使用公共view，旧camera字段名保留兼容 | 孤星/Space Age/Apollo控制台；紧凑标签、编号、刻度和工业分区 |

同一播放器维持功能与大体布局一致；外观分别完善，不混成一种。共用控制节点可逆移位，复用事件/状态，避免重复ID。LSP与系统窗口仍官方原生。

Future参考《莱茵生命：访问》和现有唱片页，融合现代工业界面/瑞士排版与太空时代信息语汇；Punk参考孤星解析/Apollo仪表。玻璃不是现代化的全部，主体色彩不是背景色。

## 全局与独立配置

- renderQuality全局共用：流畅/均衡/高画质/极致/自定义，分调波动、模型细节、光照、终端光及已有AA/阴影/AO/景深/传输等。
- windowAspect全局：16:9默认、16:10、4:3、3:2、21:9、自由；固定模式等比缩放，最大化/全屏留边。
- styleProfiles保存各主题陈列/配色；caseProfiles保存各主题结构/材质/部件。
- 公共布局/目录设置由view保存（shelf/array/grid及show/group/sort/gridPageSize）；gridPageSize为10/36/50/75/100/200，默认36，切主题共享。foobarArchive兼容投影；新字段逐项优先，旧ARRAY→shelf、FUTURE→array、GRID→grid。主题外观档不拥有全局视图，播放顺序不再按主题切换。
- MusicApplicationState集中选中专辑/曲目身份、打开模式、右侧页签、查询、view和运行期gridPage。query/show/group/sort/gridPageSize变化优先回第1页，layout/theme切换保留当前页；结果收缩时页码夹到合法范围。单独改变选中entry时自动显露它所在页，手动翻页不跟随原selection跳页。详情不因design变化重建内容节点；两主题货架、阵列与网格详情由同一ArchiveScene/Three.js renderer显示。第四阶段已清退迁移前Canvas货架文件及重复目录链；当前源码不提供旧Canvas回退入口，清退范围见[统一架构](UNIFIED-ARCHITECTURE.md)。
- 切主题不重置质量/比例/音频。质量预设不换盒体或外观；传输渲染分辨率不等于材质透过率。
- 设计基准1920×1080及以上，保留工作区DIP容纳和既有触控，不另做低分辨率适配。

## 当前页面与专辑流程

Archive从EQ/歌词/信号/主题等同窗口页面返回原唱片上下文，保留详情；已在唱片页点击Archive才主动回专辑架。曲库管理在设置 → 音乐库。页面间使用导航按钮或再次点击当前入口返回；Esc只在当前页面内返回/关闭弹窗/取消编辑，管理页无弹窗时不切页。管理页暂停隐藏三维绘制。

两主题资料顺序统一：编号/格式 → 标题/歌手/基本资料 → PROFILE → 播放/打开专辑操作。未打开时曲目/介绍整段hidden/inert。

资料区主容器、滚动区、内容容器及Punk外宿主始终不画整圈边框、outline或阴影焦点框；鼠标/键盘焦点仍用于左右区域归属，按钮和曲目保留自身焦点提示。Punk编号同行右侧恢复紧凑音质标签：例如`FLAC 24/88.2`，细框和小方点取当前accent色，文字取前景色。Future同一位置使用轻量无框文字，例如`FLAC · 24 bit / 88.2 kHz`，不添加橙框/方点。格式、位深、采样率均来自源曲目；TRACKS只展示当前曲目，专辑内不同数值以最小–最大范围汇总，未知字段省略、有损编码不显示名义位深，保留44.1/88.2等精度。此标签与PROFILE及Hi-Res/DSD徽标共存，不改播放链路。

音质标签外层`#selection-format`只负责细框、内边距和方点，真实字轮挂在子元素`.selection-format-reel`上；不能让`.rn-visual`绝对定位到带方点的外宿主。右对齐标签收缩时暂时保持旧的最小宽度，等字轮测量与460ms动画结束后释放，避免框/方点先移动而字符仍留在旧位置；新值重置释放时序，非动画更新和销毁清理锁宽及回调。静止、测量及`data-rn-ready`动画阶段均须保持文字与方点分离，不能用静止截图代替动态验证。

单击唱片选中/抬起；点击“打开专辑”或对当前唱片有效双击才打开。操作组先退场再展开内容，两入口共同hidden/inert；右栏常驻、整体有界滚动，收起后共同恢复。Punk两侧标签仅在详情返回浏览的`button-enter`同步乱码解码出现，初次显现、专辑滑动选择及`contentChanged`均保持完整标签。整条操作条按实际边界做360ms垂直压薄、上移12px和连续淡出；返回560ms从中心展开、从下方10px归位并淡入，两侧同步可见，不横扫整行空白。中途反向从当前opacity/clip/transform继续，剩余时长按透明度距离缩短；详情尚未展开时返回也走入场。Future保留240ms主题遮罩，容器同样紧包实际188px操作区。支持中断及减少动态，不替换音乐内容或恢复旧独立article流程。

浏览状态的播放入口从当前专辑第一首开始，使用整张专辑的曲目队列；TRACKS模式下也不跟随当前焦点曲目，不改变选择、详情或三维打开状态。空专辑和离线专辑禁用该入口。Punk两入口组成自然宽、gap0的连体操作条：只共用1px前景细框，不画常驻外强调框，左侧反色实底/三角播放，右侧透明底/斜箭头打开，中间一条前景分隔线；两颗原生type=button保留独立点击、无障碍名称、禁用与内缩焦点提示，外层为group。操作条前景细框与资料区左沿对齐，没有常驻外强调框，也不包围整个资料栏。字号12px/600、`.1em`字距，按钮高40px，粗指针保持44px。斜箭头取当前`--accent`，基础框/播放底取`--ink`；保留中英文文案，不加SPACE提示。颜色和信息层级参考本地foobar 1.4.0的`js/archive.js:979–994`；连体结构和公共进退场是按用户新要求加入，不能称为原版自绘布局。Future在ACCESS ALBUM上方放PLAY ALBUM和播放图标，沿用188px小号等宽文字、透明背景与强调色悬停，不加Punk外框或底板。

最后点击区域决定键鼠归属，hover不抢焦点，左右不穿透。双击须真实命中、同entry并排除拖拽/错误状态，不能以左半屏任意坐标冒充命中。

两主题ARRAY的选中与悬停分别响应：滚轮/导航选中项保留主要抬起；鼠标悬停当前可交互列的任意专辑或TRACKS entry时，该项轻抬并按原foobar高斯轮廓柔和带起同列邻居。两套抬起目标可叠加，悬停不更改selection/focus、资料或列滚动位置，移开后平滑回到原选中轮廓。选中带起档位只调整选中轮廓，悬停邻居反馈独立保留；MATRIX沿用自己的动作。

两主题横屏ARRAY详情将整盒中心放在左侧可用展示区的中点、画面高度48%处。可用宽度优先读取常驻资料栏左边界并留24px间隔，不跟随内部内容滚动；暂不可测时按上次宽度比例回退。ARRAY离架高度为盒体实际高度加`.5`模型单位，使打开盒底与未抬起邻盒顶之间有独立空隙；检视缩放、长焦透视和默认20°仰角/8°方向保留。抬起、镜头构图与返回共用原连续进度，返回恢复原槽位与列位置；MATRIX/GRID端点及竖屏的屏幕构图沿用原规则。

队列在播放条入口上方浮出，只列当前播放曲目所属专辑；点播不强制跳页，不变成整库/跨专辑总队列。

## Punk目录和顶栏

| 控件 | 当前选项 |
| --- | --- |
| SHOW | ALBUMS / TRACKS |
| LAYOUT | SHELF / ARRAY / GRID |
| GROUP | GENRE / ARTIST / DECADE / A-Z / NONE |
| SORT | ARTIST / TITLE / YEAR / ADDED |
| PER PAGE（仅GRID） | 10 / 36 / 50 / 75 / 100 / 200；默认36 |

Punk浏览页右上角按SHOW+LAYOUT、GROUP+SORT分两行；LAYOUT选中显示固定橙色点、未选为空心框。Future浏览页左上角提供相同两行。GRID时Punk改为SHOW+PER PAGE+LAYOUT第一行、GROUP+SORT第二行，RANDOM位于第二行，左上角显示当前目录结果总数；Future GRID保留自己的左上布局，同时提供PER PAGE及当前结果总数。离开GRID时两主题都隐藏PER PAGE。Punk查询复用顶栏SEARCH ARCHIVE。两主题调用同一公共view/query，切换主题保留当前状态；设置 → 音乐库的旧排列入口继续作为公共view别名，文案指向浏览工具栏。STYLE不再显示“视图与浏览”区，只集中外观、盒体和画质设置。

Punk GRID呈现纯106px方形封面墙，间距约26px；选中项为黑色细框与accent四角。标题和资料仅在右栏、卡片无障碍名称及hover信息中提供，不落在封面墙卡片上。

TRACKS是独立曲目entry、每曲一盒，封面/ARC归父专辑；货架20槽跨组分页，网格分页与货架20槽相互独立，网格每曲小卡，分组阵列每组一列。GRID只渲染当前页，顶部总数反映当前目录结果总量，分组标题显示类别（GENRE/ARTIST/DECADE/A-Z等）、序号、名称、横线和全组总条数；组计数不随当前页缩小。两主题共用目录、空间布局与三维相机，以各自盒体、材质和配色呈现；TRACKS各曲有独立entry key，不改全局专辑records为track数组。网格分页不改变selection、曲目身份或右侧详情；选中entry key变化时controller显露其页，手动翻页不被既有selection拉回。货架列沿负X、槽沿负Z；间距按用户变换后的盒体bounds扩展，保留稳定父专辑身份。ADDED无时间戳时沿稳定库顺序，不编日期。

视图选择由公共view保存，稳定key仍为`shelf/array/grid`，foobarArchive.layout仅保留兼容投影；缺失字段按旧配置/默认迁移。两主题可见LAYOUT均为`shelf`→ARRAY/阵列（Punk实体20槽托盘）、`array`→MATRIX/矩阵（连续稠密排列）、`grid`→GRID/网格；文案不改变preferences JSON或事件/data属性中的key。切布局保留当前专辑/曲目身份、右侧信息区DOM、位置、内容、活动tab与展开状态。Punk三维画布用现有右栏边界裁切，不借布局切主题。G在网格与最近空间布局之间切换。Future和Punk托盘现位于共同Three.js场景；`MusicShelf`与`MusicSceneResources`以程序几何构成托盘、货架和地面细节，`MusicCaseTitles`使用纸面图集呈现Punk顶边标题。Future使用陶瓷/轻玻璃边，Punk使用主题金属材质。第四阶段已清退迁移前的ArchiveCaseRenderer/sprite/foobar目录链；本主题页描述公共场景，不承诺在当前源码中切回旧Canvas外观。Punk旧目录DOM保留的类/data钩子迁入公共markup，旧的隐藏LAYOUT节点已清退；当前可见LAYOUT控件属于公共浏览工具栏。Punk实体ARRAY的水波按行独立，仅当前选中行沿槽位方向滑动，不跨排传播；Future与MATRIX保留连续波动。`off/basic/reduced/full`偏好值兼容保留，不新增波动模式。

第三阶段没有可直接复用的原始货架/地面3D模型。新几何是按现有坐标、盒体bounds与主题图形估算的程序实现，不是原作者网格或像素复刻；未修改现有GLB/PNG，也不直接把含预烘焙光照的地面投影作为实时材质。Punk货架前牌`ROW 001`按列递增，ALBUM NO.继续显示独立全库编号。

左下编号是架内位置，右侧ALBUM NO.是全库四位档案编号，不强行统一成同一序号。SHELF/RANDOM PICK保持源式布局，不再加大底板。播放栏方槽是当前封面槽，空闲不放音符/金色占位；无封面使用既有小标记。

目标曲目点播使用父专辑队列；打开专辑与开始播放分开。ORDER的repeat-track/random不能冒充原生gapless预排。两主题浏览工具栏均提供完整SHOW/LAYOUT/GROUP/SORT并使用公共view；查询使用公共query。STYLE不承载目录浏览区。

Punk SETTINGS紧跟时钟，不auto margin推到最右；顶栏保留溢出访问但隐藏横滑条，不恢复旧MENU。专辑动作区按用户新要求移除操作条常驻accent外框，保留随配色变化的斜箭头，具体规则见上方专辑流程。

## Future当前视觉

沿用music.css唱片页日夜色盘：day page `#e8e5e1`、surface `#efede7`、accent `#b56834`，night原深蓝玻璃，不再灰暗覆写整页。

正面操作终端用层级高度/阴影、高光、透明、磨砂和细腻色变形成悬浮感；光向跟唱片场景，自发光可用有限局部光影响邻近部件。当前是屏幕空间/局部光近似，不是全局光线追踪。背景不新增墙板、隔断或无含义立体物件。

- 胶囊播放条、轻透导航/时钟、清晰PROFILE层级。
- 唱片资料直接以悬浮文字和细规则线呈现，移除右侧整块圆角玻璃底；ACCESS ALBUM保留小号文字/箭头及原打开操作与无障碍名称，不画外框或悬停底板。左上浏览工具栏分两行提供SHOW+LAYOUT、GROUP+SORT，不设置额外筛选输入框。借上游版式/揭示语言，保留专辑名、歌手、音质徽标、PROFILE、歌单和介绍等现有音乐内容。
- GRID保留Future原136px圆角文字卡片与原主题皮肤；左上工具栏在GRID提供PER PAGE和总数，非GRID隐藏PER PAGE。
- 歌词共同三栏，中央独立阅读面、两侧开放。
- EQ浮起模块、旋钮/推子/读数，不复制Punk硬黑块。
- 信号保留大环/既有尺寸，不加厚重外围框。
- 分层可中断View Transition，固定导航/播放条与内容分离；减少动态/无API回退。
- 专辑右栏reading veil独立，避免旧browse veil退场透架和PROFILE横带。

终端受光按真实表面分配：闲置透明导航和顶栏播放图标不产生卡片阴影，已选/hover/focus-visible导航仍可受光；日夜切换只照玻璃容器，内部标签不再各叠一个光晕。顶栏胶囊左右各16px内边距，默认10px独立间隔，选中与悬停时也不得重叠；横向滚动容器保留48px透明光效留白。歌词桌面页/工作区开放外部阴影，中央面板和内部滚动区保留内容裁切；≤980px堆叠视图仍使用外层auto滚动。画质预设与光效预算未改变。

## Punk字体与仪表

英文Geist Mono/Archive Mono不改；中文现有微软雅黑UI/微软雅黑逐字形回退，原字号/字重保留，不用整串中英强制换字体或引入思源黑体。

字轮rn-slot与music-title-slot必须保留content-box，不能被全局border-box挤掉字宽/字形边缘；测量副本画外绝对定位，布局/字体变化刷新测量。不要为修裁切换字体或覆盖控制器的textContent。

六色系archive/hazard/flare/field/front/hearth均有day/night；控件从token推导。EQ使用真实范围刻度、270°对数频率/Q旋钮、增益推子/零位与读数窗；装饰不抢事件或改变DSP，频响在控件下正常滚动。

歌词复用共同三栏后Punk化，旧档案/队列/额外读数分支不作为当前可见布局。信号工具栏完整、轨迹固定112px、角框限高，大3D/2D环主体保留。

SVG固定尺寸并Grid/Flex居中，播放/暂停共用视觉中心，稳定误差目标≤0.5 CSS px。保留已有44px触控范围与明确小控件尺寸，如歌词32px按钮；不用基线/空格定位。

## 可调盒体

Future的盒体选项只有三种：简单粗糙（minimal）、精细（rhine）、Punk拓展（punk）。精细直接使用RhineLabUI的 `public/assets/archive-cassette.glb` 外壳，不从拆解版assembly拼接；移除内部展示组件，保留原标签小字/边框/螺钉/底标。封面作为盖板后的实体纸卡放在左侧，原标签板/墨层/小字一起移到右侧，留独立信息区；正方形清晰窗避开压边刻纹，窗外仍为原磨砂质感。比例、来源与实际筛选见 [模型](../art/README.md)。

Future简单粗糙款只查看预览，不显示编辑区、封面显隐或重置；隐藏编辑事件也不接受。精细款只显示分部件的透光率/透明度，不提供颜色、质感、部件变换或预设选择。两参数分别为物理透射和alpha淡出；保存为可选transmissionOverride/opacityOverride，叠加在原材质上，不关闭preserveSource或改颜色/PBR，重置只清覆盖值。完全透明时不写深度或留不透明投影，恢复覆盖后还原原alpha状态。旧保存外观不自动重置。

精细盖板的清晰窗口默认透光率98%，窗外仍使用源材质；显式调节盖板透光率后两区域均服从该值，粗糙度仍按窗区分。旧不透明涂层保留在窗外，窗内仍为中性玻璃，不因旧材质遮住新纸卡。编辑器、唱片阵列/选中副本、ViewerAlbumCover均使用同一内置卡片布局；查看器清晰/磨砂只改变正方形窗口。

两主题实体纸卡的背层与封面印刷面由同一helper定位，正常厚度时前后间距为`.002`模型单位；背层先绘制，阵列实例与选中/预览/查看器保持相同顺序。该间距避免远距离斜视时两面落入相同深度精度范围而闪烁；封面位置、纸卡颜色/阴影、玻璃材质及既有画质选项保留。复现与验证范围见[封面闪烁修复](COVER-FLICKER-FIX-2026-10-16.md)。

精细盒体右侧原标签使用上游Canvas标签绘制方式，编号按当前曲库顺序显示NO.001起，随专辑切换更新；循环货架每个实例和退场副本保留自己的编号。未知序号显示NO.---。标签下方独立判断整张专辑是否全Hi-Res、全DSD：同时满足时左Hi-Res/右DSD并排，仅满足一项时居中，普通、混入普通曲目或信息不足时留空。每个徽标采用源坐标0.60方形区域，双标间隔0.08，单标不放大。复用既有格式识别和本地SVG，不根据输出设备或DSP采样率推断。徽标使用独立无灯光shader，保留自身金色微光/扫光，尊重减少动态效果；标签、徽标接入主场景、编辑器预览及查看器，不新增盒体设置项。

动态标签为不透明纸面，选中项、阵列和退场副本均写入深度，避免后绘透射壳体覆盖标签右侧或边线；自身无灯光材质保留。原Canvas版式不因遮挡问题重排，源标签板与墨层及GLB均保留。

两个主题的Punk盒体右侧铭牌也显示相同RHINE LAB/INTERNAL DATABASE/INFO、动态NO与完整标记。Punk实体铭牌比例约1.69，完整版式约2.33，采用等比居中填入，字体不拉伸；三维平面覆盖铭牌正面96%，保留实体边缘。CaseAlbumInfo为共用组件。字体、标记及纸面采用MeshBasicMaterial，不参与灯光和环境反射；可调模型缓存模式在壳体图片之后直接叠加同一标签Canvas。编号统一用canonical专辑序号，从NO.001起，TRACKS按父专辑序号；未知显示NO.---。三维铭牌按标签板的原始pivot同步平移/旋转/缩放/显隐，拆解归入Punk的cover组。原GLB和PNG不改、不烘焙专辑号，现有外观与个人预设保留。

两个主题的Punk盒体不添加Hi-Res/DSD徽标，继续仅显示完整动态铭牌；环上方与刻度旁的方案均已取消。格式徽标仅保留在Future精细盒体。

Future的Punk拓展与Punk主题共用盒体编辑器布局：内置预设、颜色与材质、我的预设按相同顺序排列，不显示独立「通用部件设置」区；部件位置/角度/比例收在定制区。通过「调整哪个部件」下拉选择目标，常用颜色/材质直接显示，进阶光学、单部件取材及变换折叠。Punk主题保留自己的配色、继承字体、方角和预览面板视觉效果，不改成Future风格。

颜色与纹理辅色同时提供色盘和HEX输入；接受#RGB、#RRGGBB及省略#的写法，去首尾空格并展开为大写六位。失焦或Enter提交，输入过程中不提前展开三位；非法值提示且不保存，Escape恢复当前颜色。两个主题的Punk定制使用同一输入规则，使用原始材质时与色盘一起禁用。

Punk内置预设只替换整盒材质，保留当前部件变换。两主题「我的预设」均可命名保存当前整盒材质和部件快照、重新使用或确认删除，重名时要求换名，不自动覆盖；应用个人预设同时恢复其材质和部件设置，删除不改变当前盒体。各库最多50个，分别通过顶层偏好 `futurePunkPresets` / `archivePunkPresets` 保存，桌面偏好白名单均已接入，缺失时为空库，不互相迁入；快照用custom/revision4保留，不混入内置预设升级。切换主题/盒体、离开页面或重启后保留，原有自定义外观不擅自转换成命名预设。

Future简单/精细结构的限制仍仅适用于Future。Punk主题固定使用自己的可调Punk模型，移除旧CASE SKIN列表、原图盒体预览及原PNG/可调开关；配色卡、配色预览和显示设置保留。同布局不意味着开放Future其它结构或共用主题配置。旧配置的结构归回punk、enabled归为true，保留保存外观、部件变换、个人预设及Future独立配置。可调模式以真实模型生成缓存帧，不把缓存图称为实时PBR；旧caseStyle和背景资产保留兼容，不再作为可选盒体。

Punk十预设：marble/hazard/white/glass/frost/red/blue/coral/tide/aurora。同一母模按部件自由组合，不为每颜色复制模型。当前Rhine外壳10部件、Punk15部件，精度与差异以状态/正式资产为准。

编辑器预览始终高精度，精细/Punk可隐藏封面；主场景按质量细分。Future精细盒体使用其保存外观与上游材质，仅开放上述光学覆盖；旧Hi-Res金边不能强制改新精细材质，源格式标志独立。

### Punk层次

Blender原生Y负向为前方，不是Three世界Z：

| 部分 | 原生Y/关系 |
| --- | --- |
| 铭牌 | [-.205,-.195]，在玻璃前 |
| 整面玻璃 | [-.178,-.160] |
| 专辑图面 | 约-.105，在玻璃内 |
| 右凹入薄内板 | [.015,.040] |
| 背板 | 更后方，被专辑遮挡 |

上下长横梁包短侧柱；定位线/角标随cover，框槽trim随carrier。保持独立CaseLayout与统一等比尺度，不二次拉伸/重复缩放。

纸卡真实遮挡/投影；sprite纸面受光乘封面后叠前玻璃，mask写RGBA0并保留深度。清晰/磨砂限专辑窗，右信息玻璃保持清晰。矩形卡间接遮挡随显隐/拆解相对深度更新，空盒关闭。

### 小徽记、材质与迁移

透明软管、内部中心细橙芯、间断开口白包覆，“/”支在前；optics/accent/emblem随盖板拆解。主轴据源PNG可见细线描出，底冠内部轴/开口为估算；描点误差不等于整体还原率。

仅管体使用薄壁Fresnel alpha近似，白包覆/芯不透明，大玻璃体积透射保留；管体不投不透明整环阴影。两道接缝、底冠/短芯仍有局部差异。

外框/内板/卡扣/铭牌独立调色，清漆粗糙度独立；Aurora渐变参与底色/薄膜/吸收。棚光条只在离屏环境，不新增应用背景物体。程序拉丝切线随变换同步，保留各向异性零分母保护。

presetRevision4只升级严格匹配的V1/V2/V3，手改/custom和变换保留；材质为估值，不是原PBR。

## 源码入口

- 路由/偏好：src/music-app.ts、foobar-shell.ts/css、window-aspect-model.mjs。
- 陈列/目录/共同资源：src/scene.ts、music-spatial-layout.ts、music-shelf.ts、music-scene-resources.ts、music-case-titles.ts、music-catalog-markup.ts与公共music-catalog模块。foobar-catalog/punk-future-catalog/archive-case-renderer/case-sprites属于第四阶段已清退的迁移前链路，不是当前外观开关。
- 共同流程：src/album-panel.ts、album-interaction.ts、album-queue.ts。
- 盒体：src/case-settings.ts、case-model.ts、rhine-case-model.ts、rhine-album-info.ts、archive-label.ts、case-editor.ts、case-materials.ts、case-album-occlusion.ts；旧case-sprites随第四阶段清退。
- 外观：src/future-*.css、punk-eq.css、punk-eq-instruments.ts、punk-lyrics.css、punk-signal.css与foobar相关样式。
- 模型/版本与复现：[art说明](../art/README.md)。

阶段进度与验收边界以 [全局状态](PROJECT-STATUS.md) 为准；本页记录稳定主题设计与当前公共接口。
