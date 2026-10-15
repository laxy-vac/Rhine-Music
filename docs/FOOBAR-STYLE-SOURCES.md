# foobar / RhinE Style 资源来源

> 本文保留原始资产、许可及移植阶段溯源，不作为当前UI布局说明。现行两主题/可调盒体/字体/歌词/信号以 [THEME-PAGE](THEME-PAGE.md) 与 [PROJECT-STATUS](PROJECT-STATUS.md) 为准；旧阶段授权不自动延续。

第四阶段已清退迁移前的Canvas/sprite/foobar目录生产链。下文坐标、投影与旧renderer只说明历史来源，不是当前可切换外观。

2026-10-12完整操作界面阶段补充：header/transport/frame/stage/style/signal及lib/emblem/nowplaying/lyrics/archive交互按本机主题源码移植到foobar专属DOM和控制分支。顶栏操作与本播放器一一映射，02为EQ，无Playlists；05Style与主题同页。源码依原MIT适配，不加载foobar组件或读取其profile。源几何header73、transport64、status32，Archive右信息栏456、20槽分架、Style左右62%/预览结构；宿主系统菜单/Preferences映射到本项目对应页面，官方LSP窗口保持原生。

另从同一本地包 `assets/intro/<10skin>/` 复制至 `src/assets/style/intro/`：每皮肤intro.json+144JPG，1450文件、151,658,971bytes（144.63MiB），逐文件SHA-256全部匹配。未重绘/转码、未下载或执行原安装器。曾有本轮145个aurora副本落到新目标根，已核对后仅移动这些新副本归位，原目录未动，最终10×145结构与源完全对应。`foobar-intro.ts`按metadata fps/res/tracked points播放原片，原overlay/cue在Canvas适配，按需加载、14帧前瞻/6并发；动画不能冒充音频或硬件检测。现有Audio Archive MIT原文继续覆盖所复制资产/改编代码。

盒型、货架和地面资源来自本机只读参考目录 `D:\CodexLocalWorkContent\PersonalMusicPlayer\references\RhinE-1.4.0-portable\audio-archive-1.4.0`（RhinE 1.4.0 主题包），逐字节复制到 `src/assets/style/`，目录对应关系为：`assets/render/case/` → `case/`，`assets/render/rail/` → `rail/`，`assets/render/floor/` → `floor/`。配色 token 使用固定官方提交 `cead785dc40b02ee1cb0ae2c2d9a4a3034a186d0` 的 [`tokens.json`](https://raw.githubusercontent.com/ericzhang12111-cell/RhinE/cead785dc40b02ee1cb0ae2c2d9a4a3034a186d0/theme/tokens/tokens.json)，源于 RhinE 官方主题目录。资源集包含 10 个盒型皮肤、盒体/封面投影元数据、货架、三种地面外观和全部配色；没有读取 foobar 的 profile、曲库、缓存或数据库，也没有复制安装包、可执行文件和组件二进制。

## 参考入口与可复用资源

2026-10-12字形/SHELF/随机补充：archive.js:820-833的SHELF是无框两行导航，cx=arrayW×.774、y=H−82，标签9/500/.14em灰色、组名13/700/.14em正文色，箭头36×36命中区且边界变暗。grid.js:195-230的RANDOM PICK位于阵列x32/y22、网格y54，高22，左侧10×10骰子轮廓/三枚2×2accent点、右侧R提示，不是纯文字末尾按钮。lib/tokens.js:55,69-78与lib/text.js:42-65使用整串fontFor：任何CJK字符命中即整串Microsoft YaHei UI；不是浏览器逐字缺字回退。本轮按这些源码规则适配，未安装字体、改源包或访问profile。

2026-10-12补充原播放栏和数字调查：transport.js:109-143、:329-377与archive.js:1024-1034确认44dp首槽是播放封面及inspect入口，空闲空框、播放缺图小方块及橙色状态条，暂停保留；右键Playlists因用户不需要而不引入。archive.js:790-797/:908-915及lib/motion.js:62-78分别定义架内序号、四位档案编号和460ms字轮。新增源GeistMono-Light.ttf（147756bytes，SHA-256 `6b46aec3f2b91bf224ba7922029bde4d5d453c0217b53b2e65019582549c3023`）嵌入src/assets/style/fonts并以300字重加载；沿用已保存OFL许可，无系统安装。

固定上游 tokens 原字节 SHA-256：`e4644e74a387d4b006cb32666e18e0ebbdc3c6f9dcb5db33fde92a75082fe420`。联网读取仅用于补齐 HEARTH；本地临时来源副本位于工作区 `.task-tmp/theme-upstream/tokens.json`。没有下载或执行上游安装器。

- `js/style.js:2-8,112-140,294-304` 实现 Style 页面：盒型皮肤、配色卡片、浅/深模式和显示选项均可即时应用。盒型预览使用阵列图和正面图。
- `tokens/tokens.json:2-34` 定义 ARCHIVE、HAZARD、FLARE、FIELD、COLD FRONT、HEARTH 六套配色，每套含 light/dark 两组颜色。前五套与 1.4.0 资源包中的原值一致，HEARTH 来自固定官方提交。新界面可直接读取这些 token。
- `js/lib/bus.js:16-22` 定义 PLAIN、LAB DECK、REAL STYLE 三个地面选项；`js/archive.js:416-483` 加载地面、底板、阴影和光照图。
- `assets/render/case/<皮肤>/` 每个皮肤含 `case.json`、`array-clear.png`、`array-frost.png`、`hero-clear.png`、`hero-frost.png` 及 `inspect-00.png` 至 `inspect-59.png`。10 个皮肤为 aurora、blue、coral、frost、glass、hazard、marble、red、tide、white；每个目录 65 个文件。
- 盒体不是运行时 GLB 网格。`js/archive.js:14-15` 明确采用预渲染 clear/frost sprite，`case.json` 提供封面四边形和投影轴；`js/lib/album.js:7-13,66-72` 载入皮肤元数据与盒体图。例：`case/white/case.json:51-69,116-120,3242-3246` 中轴向 `[79.31,36.9]`、`[57.56,-50.85]`、`[0,-75.21]`，阵列/正面图分别为 600×600、1000×1000，检查序列为 60 帧、900×900。
- 顶边专辑名的源公式见 `js/archive.js:588-605`：`x0=-1.80, x1=1.10, y=.15, z=3.5`，用 `case.json` 的阵列原点和 x/y/z 投影轴构成仿射映射；标签长 2.90、表面宽 0.30 模型单位。纸条为 `#E9E6DD`，左侧 4 px accent 条，文字为 `#1B1C18`；拉丁文字用 Geist Mono SemiBold 17 px，CJK 用 Microsoft YaHei UI 18 px，单行并在末尾省略。源代码直接建立字号，不经过 `TEXT_SCALE`。脊标见 `js/archive.js:576-585`：100×60 的标签四边形中分两行绘制 `ARC` 与四位编号，字号分别为 15、22 px，不另盖纸色矩形。
- `assets/render/rail/` 含 `rail-back.png`、`rail-front.png`、`rail-mid.png` 和 `rail.json`。元数据为 900×900、98 px/单位、槽距 1、原点 `[450,581.62]`，另含正面编号牌的四边形。
- `floor/deck-dark/` 与 `floor/deck-light/` 各有 `floor.json`、`plate.jpg`、六张 shade 和六张 glow 图。参数为 98 px/单位、`floor_z=-0.51`；底板 4800×3600、原点 `[1800,3300]`；阴影图 1400×1400、原点 `[420,588]`。原 `plate.jpg` 已静态烘入板缝和橙色引导线；`js/archive.js:416-483`加载底板及shade/glow并绘制，地线不是按palette绘制的动态层。`floor/real-dark/` 是单套暖色木桌场景，含底板、阴影及专用 frost 盒体和 rail 图；`floor.json` 的 `fade=#2b1300`、`tint=0.4`、`glow=false`。源代码将 REAL STYLE 固定关联 frost 皮肤（`js/lib/bus.js:18-22`）。
- 源阵列合成次序见 `js/archive.js:613-646,665-703`：先画地面；由后向前绘制每层货架，并按深度交错货架段与唱片盒；单盒先绘封面四边形，再叠 frost/clear 盒体，之后绘脊标签、顶标题和选中角标。选中时 clear/frost sprite 按 clear 值交叉淡入，封面清晰图只按 clear 值覆盖；远层盒体以背景色淡化。高视角 foobar 档继续使用这套 600×600 阵列 sprite 与原投影轴，方向翻转和显示/隐藏货架属于移植器设置。
- player 档的低视角盒图取自原始 `inspect-23.png`，不是重绘的 PNG，也不声称它是 RhinE 的另一台官方相机。`case/white/case.json` 的 `inspect[23]` 给出 cover/label 四边形、`origin=[424.23,681.20]`、crop `[137,134,626,632]`，检查 PPU 为 147。由阵列 cover 和原始 axes 可得封面边长 2.78 单位；frame 23 竖边投影得到相对正面的 25.27° 姿态。按正交投影行归一与点积约束恢复第三轴后，整体屏幕刚性旋转 −6.3604° 使 z 轴竖直；旋转后 axes 为 x `[139.4086,19.9052]`、y `[46.6289,-59.5112]`、z `[0,-132.9333]` px/单位。player 档检查动画从 frame 23 连续播放到 frame 59，foobar 档仍从 0 到 59。
- 低视角货架使用单独的 `src/assets/style/camera-player/rail/` 渲染图和 `rail.json`；生成源为本仓库 `art/build_style_player_rail.py` 与 `art/style-player-rail.blend`。不能把高视角 foobar rail PNG 直接放在低视角盒图下。低地面将旧 plate/shade/glow 作为平面图按原 case axes 到 frame 23 axes 的 2×2 仿射映射，底图与阴影以各自origin对齐，并按 `floor_z×(targetZ−A×sourceZ)` 修正地面平面的高度（A为该平面的2×2重投影/拉伸矩阵）。原相机且不拉伸时该项正好为零，原相机拉伸时与源中段阴影公式等价；低档保留地面与托架的离地关系。盒体低视角素材仍是 frame 23 的原始高分辨率图。
- 本仓库 `art/rhine-archive.blend` 与 `art/archive-assembly.blend` 来自 `art/build_archive.py` / `art/build_assembly.py`，生成的是 Rhine Lab cassette shell/optics GLB；它们不是 RhinE Audio Archive 的十款盒型模型，也不是低视角贴图的来源。
- 该主题用 Hi-Res 标记的入口见 `js/lib/nowplaying.js:106-107`，为当前配色 accent 芯片；参考代码中没有 DSD 徽标或独立金色盒边 shader。移植器沿用播放器自身的 Hi-Res/DSD 识别，并以主播放器的金边绘制要求呈现 Hi-Res。

## 迁移前：独立foobar货架投影（历史）

以下坐标与绘制顺序描述迁移前Canvas2D货架路径，不代表当前公共场景。低视角Blender模型/素材属于被否定方案的历史留存。第四阶段已删除`archive-case-renderer.ts`及关联sprite/foobar目录生产链；当前源码不提供回切开关。

foobar独立构建20槽货架，按原buildShelves把当前曲库分组依序填满，末架仍保留20槽。它不读取普通Three Scene的循环cell、相机或选中屏幕位置；点击以原record索引映射回播放器。源轴向、槽距1、层距4.7、sprite比例0.54、`clamp(min(arrayWidth/936,height/731),1,1.6)`及 `[round(arrayWidth*.37),height-87]` 原点保留。arrayWidth适配本播放器的信息栏边界，未声称整个宿主窗口与foobar2000像素一致。每架按实际Spring位置淡入/淡化、后架到前架绘制，架内按源y/z深度交错盒体与托架；原地面与托架分别绘制。

原inspect PNG已裁切并下采样：例如glass/inspect-00实际254×319，而meta.crop为虚拟900px画布的[190,123,520,654]。必须把整张PNG绘到crop目的矩形，不能再次用crop裁切PNG。转向沿用0…59帧，最终位置为arrayWidth*.49、height*.5，大小依原inspectK的2倍与fit限制。原封面先以模糊图垫底，再合成clear/frost，未选中的盒子保留自己的封面。盒顶标题仍按源轴/纸条/字体映射；Hi-Res/DSD沿用本播放器实际格式识别。

## 第三阶段：公共场景资源与估算边界

第三阶段建立、当前保留的两主题货架、阵列与网格详情由同一`ArchiveScene`/Three.js renderer、实例池、封面图集和后期覆盖绘制，不再调用上述Canvas2D适配器。`music-spatial-layout`使用稳定entry身份及有限20槽分页；列沿负X、槽沿负Z，camera yaw -38°、elevation 35°，货架间距依据变换后的盒体bounds拓展。Punk场景仍裁切到右侧信息栏边界。第四阶段已清退旧目录链并把可见SHOW/GROUP/SORT/Grid markup统一到公共entryKeys处理。Punk专辑资料头部不显示FLAC格式文字和橙色框，且无空白占位；共享PROFILE格式元数据及Hi-Res徽标保留，Future头部格式显示保持原样。

当前货架底部是大面积平金属支撑板：连续lane base与逐槽重叠slot base使用同一`supportPlate` finish，主板顶面约`-.08`，在上层托盘四周露出宽平肩面。右外折面和端部件使用supportPlate金属材质；右折面现阶段最高约`-.086`，是当前几何估值，不规定所有金属面都必须低于主板。上层是独立连续灰/黑托盘，厚度`MUSIC_SHELF_TRAY_THICKNESS=.018`，底`-.08`、顶`-.062`、总宽`caseWidth-.09`，中央灰面宽`caseWidth-.28`、两侧黑带各`.095`；灰黑top同高，端台同高。只有托盘外缘向主板/右折面下折。左高挡板顶`.18`，自身finish沿用既有中灰材质；两侧guide仅灰body与金属折面，材料数组里的channel槽位是兼容值，不代表黑色导轨槽。中央贴面银线底`-.0615`、顶`-.060`、厚`.0015`，只在托盘外缘与端部下行；台面没有横梁。Punk金属件按日夜主题区分配色，本段不固定具体色值；Future保留自身finish。未拍到的内部尺寸仍是估算，旧槽条、竖支片和叠加凸筋不是当前结构。

裸露方柱脚与每lane两根由`CylinderGeometry`生成的圆形纵向杆继续使用frame材质；圆杆直径`.14`、中心Y`-.275`，与主板重叠`.01`，不形成台面横梁或方柱支片。`supportPlateMaterial`及slot base均为metalness`.8`、roughness`.34`并使用`finish.supportPlate`。仅Archive给supportPlate显式借用Scene.environment，反射倍率来自`plateEnvironment`；Future沿用自己的finish和Scene隐式环境。右折面和端部复用支撑板金属材质，左挡板finish不变。银轨和贴面银线各自按既有rail环境倍率反射；不新建环境、不释放借来的环境贴图或更改全局光照。床面与端平台使用两张256×64颜色贴图、roughness和normal各256²，hazard为128×32重复5次形成20周期，contact AO为64²；纹理随Scene共享并统一销毁。端平台实例借用`MusicShelf.bedGeometry`，其宽度更新和释放由`MusicShelf`独自负责。接触AO是每脚贴图近似，不等同shadowmap或raytrace。选择、布局和波动行为不随本轮材质调整改变。

### 地面贴图与固定引导线（2026-10-16）

原 LAB DECK 板缝和橙线都在`deck-light/dark/plate.jpg`内，绘制入口为本机参考包`js/archive.js:416-483`。该路径把底板作为固定图层绘制一次，再按货架段叠加shade/glow；plate上的橙线不经palette accent着色。`floor.json`记录PPU 98、`floor_z=-0.51`、plate原点`[1800,3300]`，原case投影轴为x`[79.31,36.9]`、y`[57.56,-50.85]`、z`[0,-75.21]`。从plate重复缝距和这两条投影轴估出的world格距约为4.7×3；不能把屏幕上的约500px缝距直接除以98当world尺寸。

原`floor.json`的origin究竟按case plane还是floor plane解释，现有绘制注释没有完全消除歧义。把`floor_z=-0.51`及z轴屏幕位移纳入逆投影时，静态橙线在一端的world X估计约2.95；若忽略这项则约3.30。该差异说明原图可用于确定格距和引导线方向/大致位置，不应把单点X当上游硬参数。当前适配按本项目case center、盒宽、inspection位置及槽距布置，不声称与原图同origin。

当前主场景仍复用200×200平面：shelf时在`floorY-.51`，MATRIX时`y=-4.63`。程序deck纹理为256² DataTexture，按200/4.7与200/3重复并以`-repeat/2`居中；微细颗粒的主项改由固定seed哈希生成，另保留幅度`.35`的宽域正弦项。它是程序纹理，不是原plate整图，也不把原plate的烘焙阴影复制到地面上。deck日/夜底色固定为`#e3e7ec`/`#44423f`，fog固定为`#c0c3c6`/`#050607`以保留深度淡化；切换scheme或floor会触发`setTheme`，但这两条LAB DECK路径仍重设固定颜色。Plain/Real保留既有palette/fog规则。

Archive + LAB DECK + shelf只建立一个普通mesh“Music lab floor orange guide”，固定材质色`#ff7a01`，日/夜opacity`.72`/`.58`。它使用32×128白色RGBA alpha纹理形成横向软边和两端渐隐，贴地`+.001`、宽`.10`、长`51*rowSpacing`；x为`case center + caseWidth/2 + .8`，z为`case centerZ + inspectionZ - 22*rowSpacing`。这些位置是当前Scene的适配值而非原图解出的精确世界坐标。地线不按lane复制、不跟随选中row/RowAlpha；货架边线仍单独使用palette accent。地面shader hook注入固定fog uniform，非deck时uniform关闭替换、继续使用原Scene fog；`MusicSceneResources.dispose()`恢复仍由本资源持有的hook并清理uniform引用，平面geometry由资源类释放一次，surface DataTexture由Set去重后释放。此处只记资源类方法的所有权逻辑；`scene.ts`当前没有调用该dispose方法，因此不把它描述为已验证的Scene/app销毁流程。

上述平床依据原生产叠绘核实，而非孤立PNG推断。`js/archive.js:33,616,628-645`使用pitch1及原axes，把`front=-1`、`mid=0..19`、`back=20`按后至前交错rail/case；`:557-560`整幅900² PNG叠绘。分段mid灰立面像素`(450,625)=[95,99,114]`会被前一slot的局部`(508,574)`不透明床面覆盖；合成后中央没有重复高筋。原床面宽软暗带约有17% RGB亮度差，可作为表面明暗线索，不能据此挖槽或抬梁；当前以顶面同高的灰/黑材质区域表达色差。`rail.json`无lip字段，`:712`跳过可选lip；`:569`为深色`ROW ${pad(gi+1,2)}`，100×20牌面中左起6、顶起1、字号12，不能误写成居中三位橙字。整排/页面渐隐见`:649-651,701-703`，不代表台面起伏。

原始rail PNG与`.tools/array-tray-structure/reference/`的叠绘资料继续说明上游参考素材和旧Canvas投影，不能证明当前3D材质观感。`.tools/shelf-color-calibration/regression/structure/after/`中的八组结构报告和24图对应`8751cd9`结构快照，保留作该结构历史；薄托盘结构入口为`node scripts/check-case-system.mjs --rail-regression --array-tray-structure --unified-render --shelf-detail-regression --capture-label=metal-base-thin-v1`，输出`.tools/shelf-color-calibration/regression/structure/metal-base-thin-v1/`。旧`.tools/shelf-color-calibration/after/probe-v3/`是用户未接受的颜色迭代；`metal-base-v1`色图对应托盘变薄前的材质状态，保留作颜色历史。厚托盘时期的配色入口为`node scripts/check-case-system.mjs --shelf-colors --capture-label=metal-base-v1 --design=archive --theme=day [--before]`，after产物位于`.tools/shelf-color-calibration/after/metal-base-v1/{archive-day,archive-night,rhine-day,rhine-night}/`；当前profile入口为`node scripts/check-case-system.mjs --array-rail-profile --shelf-detail-regression --capture-label=metal-base-thin-v1`，命名产物位于`.tools/shelf-color-calibration/profile/metal-base-thin-v1/`。

2026-10-15 ARRAY交互与逐列呈现：本机只读参考目录中的`js/archive.js` `caseTargets`与`js/lib/motion.js`仍作为原bell轮廓和弹簧行为来源；原bell曲线`1.1*(exp(-d²/4.5)-.32*exp(-d²/18))`保留为来源记录，不代表当前邻居范围profile。当前运动实现为`src/music-array-motion.ts`，外观一致性辅助为`src/music-array-appearance.ts`。实体ARRAY两主题共享：选中bell peak`.748`加额外抬升`1.35`为`2.098`，仅选中entry hover再加`.5`且不改selection，TRACKS按entryKey定位。`off/basic/reduced/full`保持现有值与偏好不变，含义改为同列每侧0/1/2/4张实际专辑参与；边界截断、不补虚拟槽。当前单凸起按`0.748*(1+cos(pi*abs(d)/(R+1)))/2`采样，`abs(d)>R`为0；邻居用速率13/7 spring平滑跟随，无事件队列、packet累加、反射或脉冲。Reduced motion和详情仍保留静态target；选中时继承现有高度保持连续。`qualityMarkup`第三个可选layout参数由主app传`musicApplication.view.layout`；ARRAY“水波强度”四档为仅抬起/轻柔/适中/强烈，shelf hint为“单凸起；档位越高，同列带起的前后专辑越多。”；MATRIX labels/hints和原全局波不变。该宽度范围和曲线是用户反馈驱动的项目观感设计，不是原作者代码复制或实物物理测量。TSC已通过，本轮`--array-bump` pure/Scene验证也已通过，产物目录`.tools/array-bump`。

本轮按用户新要求将ARRAY改为可调单凸起：选中项的静态目标固定为bell`.748`加selected extra`1.35`，同列带起范围按`off/basic/reduced/full`分别为0/1/2/4张实际专辑每侧，边界截断且不补虚拟唱片。当前bell profile为`0.748*(1+cos(pi*abs(d)/(R+1)))/2`，整数距离超过R即严格为0；critical damping spring速率13/7让目标平滑追随，不传播、不累积事件、不反射。`off`仅抬选中项，hover `.5`保持并不改变selection/focus；选中项继续当前高度，邻居被选中时承接已有高度以保持连续。该范围/曲线来自本轮用户反馈，不是原作者代码复制或物理实测。ARRAY“水波强度”UI四档为仅抬起/轻柔/适中/强烈，shelf hint为“单凸起；档位越高，同列带起的前后专辑越多。”；MATRIX labels、hint、原有全局wave及layout参数兼容不变。TSC、最终build、`--array-bump` pure/Scene/MATRIX/UI guards与composition回归均通过；报告为`.tools/array-bump/{pure-motion-audit.json,array-bump-report.json}`及同目录9张PNG，build log也在该目录。旧`.tools/array-echo`及其报告仅为已撤回方案的历史，不能作为当前行为证明。

两主题shelf的列滚动共享同一实现：默认各列首张对齐，选中项只移动当前列，目标为`scrollTarget=clamp(selSlot-4,0,20-visibleSlots)`。Map按列key保存scroll anchor；切走时velocity归零但保留位置，切回沿用；目录返回使用运行态`rememberedSlots`恢复选中槽，不持久到磁盘。列的位置`pos=lane-focus`决定渐隐：`rowAlpha=clamp(1+pos)*clamp((4-pos)/.8)`，`rowTint`按`.1`步进且最多`.8`；右侧旧列`pos<=-1`隐藏，左后排按`.5/.7/.8`衰减。保存的旧列位置不会将其固定在视口内。所有壳体、封面、纸卡、标题、托盘、框与点击命中同步淡出。`MusicArrayAppearance` v3只传per-instance alpha/tint并保留alpha discard，不在材质内做rowTint；`MusicArrayFadePass`在同一Scene/renderer的OutputPass（PlaybackGlassPass）后绘制flat depth row mask，再做一次sRGB final mix，待玻璃和封面完整合成后才淡化一次，避免transmission/tone重复洗白。ARRAY因此增加一次flat-mask scene render与一次full-screen composite，使用RGBA8+depth RT；不复制几何、不创建第二canvas/renderer，但有额外渲染开销。resize时pane暂不可测则按窗口比例缩放旧`arrayBrowseWidth`缓存，native浏览clip共用`availableWidth`；Archive尺寸回退在1040/1248/1664宽度下测试65%测量与隐藏pane宽度回退，Future沿用完整scene宽度。native ARRAY固定`navigationOrbit=0`；MATRIX保留既有orbit。

`MUSIC_SHELF_VIEW`使用936×731参考画布、`ppu=.54*98`、底锚`H-87`、横向锚`x=.37*availableWidth`，窗口zoom限制在1至1.6；Scene的`arraySlotsInView`按浏览投影求可见槽位且至少保留6槽。详情态选中盒仍位于`Z=-2.17`，选中完整bounds已通过既有验证。本轮TSC、最终interface-only build、`--array-bump` pure/Scene/MATRIX/UI guards及composition复跑通过，runtime/shader/blockedRoutes=0。中心slot四档实测邻居总数`0/2/4/8`、抬高`0/.374/.561/.677`，中心峰值固定`2.098`；快速正反选停止5秒无迟到返波，尾帧变化0。`returning-array` hover反事实首帧约`+.01`且目录/focus不变；MATRIX full/off扫描150帧确认global pulse，远4行maxY差`.0712`、邻列`.0604`，三组rail guards通过。报告为`.tools/array-bump/{build.log,pure-motion-audit.json,array-bump-report.json}`及同目录9张PNG。此轮未跑full unified或cover白板专项；fader源码未改，早先cover/fade结果保留为历史，不外推硬件FPS或用户人工验收。早先cover报告中atlas加载3/3；tint-on blue/green 18个采样点全白，tint-off blue/green分别9点；after覆盖两主题clear/frost、slots 1/3的16种组合。读取的`opacity=1`及`transmission=.98/.38`均为材质属性/设置，不等于逐像素最终透光率；历史rowTint单次着色`F(c)=page+(raw-page)*(1-tint)`的RGB平均误差`.20–.45`、最大`1`，报告和图保留于`.tools/array-cover-visibility/`。相关源fadedSprite是完成的2D盒体图再做一次着色；当前Three场景仍是程序几何估算，不作像素复刻声明。验证来自隔离synthetic Scene，不等于个人播放器、音频硬件或完整app页面人工验收；额外mask render与full-screen composite成本未做设备FPS验证。

已核实上游1.4.0资源没有原始货架/地面3D网格或建模脚本。当前程序几何按现有资料估算，不是原作者网格或像素复刻；本阶段未改GLB/PNG。复制来的Audio Archive主题代码/资源许可见下文原MIT及`public/licenses/audio-archive-style-mit.txt`。

## 2026-10-13：可调Punk三维重建的来源与限度

用户明确接受按本节已列的原始多视角图重建，并要求标明差异。已核对本机1.4.0资源与官方仓库v1.4提交 `86dedfb3a8d8215c899debab6bf292fafc654cf8` 的资源结构，未发现原始三维模型或建模脚本；`case.json`是投影数据，不包含物理材质值。新增的 `art/build_punk_reference_case.py`、`art/punk-reference-case.blend`、`public/assets/punk-reference-case.glb` 为本项目根据这些图重建，沿用来源许可和署名；并非原作者发布的网格。

模型保留一个共用盒体，分14部件；十套外观用可组合的材质参数和程序纹理复现。封面窗与铭牌平面由白色hero投影反求，螺钉/槽/徽记/倒角依原图可见轮廓建立。未拍到的内侧、深度、精确截面及原贴图/烘焙光照无法从PNG唯一还原。透光与不透光的材质类别明确区分，IOR、粗糙度、厚度、膜层数值均为估计；不宣称物理参数或像素完全一致。保留的原始/预渲染资产仅作为许可、来源或其他已说明用途的素材，不构成当前旧外观切换入口。

## 许可（原资源）

`audio-archive-1.4.0/LICENSE` 采用 MIT，版权标记为 “the Audio Archive authors”。其原文随资源复制到 `public/licenses/audio-archive-style-mit.txt`，适用于本次复制的主题代码和资产。该许可文件第 23-24 行单独说明 Geist Mono 字体按 SIL Open Font License 1.1 授权；本轮已将本地参考包内的Regular/Medium/SemiBold/Bold四个字体文件嵌入src/assets/style/fonts，并保留OFL.txt及public/licenses/geistmono-ofl.txt；没有安装系统字体。foobar2000 自身许可见参考包 `foobar2000/doc/license.html:24-40`，与本次复用的 RhinE 主题资产许可分开。
