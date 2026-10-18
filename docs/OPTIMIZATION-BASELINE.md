# 下一步优化基线

更新：2026-10-18。本文件统一记录已交付结果、仍需完善的工作和下一步的验收口径；当前功能地图见[PROJECT-STATUS](PROJECT-STATUS.md)。

## 已完成并关闭

| 项目 | 交付结果 |
| --- | --- |
| 专辑资料与操作 | 两主题资料、格式标签、打开/播放和返回动作整理；Punk 连体操作条及标签解码同步，去除多余常驻橙框 |
| 歌词来源与缓存 | 首次自动云搜索保存；默认来源由全局设置决定，默认 QQ 音乐；Local/Cloud 按用户选择生效，页签与设置源一致 |
| 本地导入与回退 | 点击 Local 不弹选择器；手动 Import 后使用缓存副本；无本地时提示并回退云，原始导入文件不改不删 |
| 偏移与跟随 | Local/Cloud 各保留一份内容及各自偏移，校准写入对应缓存；默认跟随歌词，异步结果不能覆盖用户后选来源 |
| 歌词显示与频谱 | Future 昼夜排版、当前行、设置和右侧真实盒体/播放资料；32 段真实数据平滑显示，停止/隐藏正确释放需求 |
| 播放栏 | 当前句位于进度上方，SHUFFLE ALL 与完整自绘 ORDER，停止键位于底部；移除顶部重复运输键和底栏 DSP OFF |
| 两主题与双语 | 主题选择预览统一；日夜独立；中文保留英文共用 Punk 风格词表 |
| 设置、EQ 与滚动 | Future 昼夜控件/受光、推子、频段强调、曲线图例胶囊、焦点与滚动修复，参数/图形图例不再被裁切 |
| 系统日夜跟随 | 开启时按系统当前状态对齐，之后仅跟随真实变化；手动选择不被持续纠正，重启保留手动状态 |
| 搜索与在线曲库 | Future 两弹窗重做：固定标题、内部无箭头细滑块、圆角筛选、长名称省略、自绘来源和紧凑表单 |
| 启动与旧入场 | 旧加载画面及 Punk intro 移除；后台加载及首帧就绪后首次显示窗口；隐藏节流无窗口回归已修复 |
| Future MATRIX/ARRAY 入场 | 共用终端前导；ARRAY 在 22–25 秒连续展开共同槽位上的结构与专辑，镜头跟随生成中心后归回总览，保留跳过/重播；Punk 入场暂缓 |
| 空间排列与浏览 | 两主题沿同一 q 路径完成镜头拉远、降低与转向，核心组收紧行距，外围组离镜重排，完整货架移出画面；反向倒走同一路径并保留速度，恢复物理端点与实例所有权；MATRIX 拖动/悬停及 Punk 紧凑工具区保持 |
| STYLE、Settings 与入场个性化 | 两主题 STYLE 只管理主题、日夜配色、文字字号、盒体与场景外观预览；Settings 七类各自拥有唯一控件，界面与交互默认打开；Future 欢迎文案与 ID 可改并受字母/空格/24 字符边界保护，Punk 入场入口预留且禁用 |
| 显示与性能、全屏与物理显卡 | Settings 中管理比例、全屏、渲染画质、优先显卡与性能检测；原生全屏往返与状态同步；显卡按稳定物理 PnP 身份归并 DXGI 逻辑别名，缺失身份不猜卡，保存后重启生效 |

缓存更新、纸卡闪烁、旧顶栏横滑条、控件漏光和本轮已反馈的界面问题不再作为未完成任务保留。已结束的统一架构迁移也不再按阶段重新排期。

## 需要继续完善

| 优先项 | 已知事实 | 下一步需要得到的结果 |
| --- | --- | --- |
| 启动耗时 | 已实现加载好再显示；尚无真实曲库的分阶段耗时基线 | 分开测服务/偏好/索引、资源读取、场景创建、着色器与首帧，定位关键路径和窗口等待时间 |
| RTX 5080 掉帧 | 已确认本机 4 个 DXGI/KMT 逻辑 LUID 映射到同一物理 RTX 5080；掉帧瓶颈仍未测定，不是已定位的 GPU 或 CPU 故障 | 固定场景采集帧时间、主线程/GPU负载、资源与内存；分别比较静止、切专辑、滚动、开合和页面切换 |
| 其他入场构图与 Punk UI | Future ALBUMS/MATRIX 与 ARRAY 已有各自入场；Punk UI 后续大修，其入场明确暂缓，GRID 等其他排列直接显示 | 按用户后续方向确定 Punk UI 和其余入场，沿用公共状态、首帧门与 renderer，不自动移植 Future 入场或恢复旧加载页 |
| 资源与交互开销 | 两主题已共用 renderer/资源；ARRAY 的盒体几何、玻璃与阴影仍有实际成本 | 依据测量处理首载、重复工作、资源生命周期和长任务，验证视觉质量及选择/点击命中不退化 |
| 复杂音频实时性 | LSP 当前使用通用 DSP 核，复杂设置的实时性能未全面测量 | 如另行开展音频优化，独立测处理耗时、缓冲和输出，不用图形 FPS 推断音频稳定性 |

后续工作从测量开始。保留现有画质和产品行为，优先消除实际重复工作和热点；不以降低画质、伪造数据、静默换设备或改用户偏好掩盖问题。

## 可复用的事实与保护点

- 唯一活动源码为本仓库 `main`；当前版本号仍为 `0.3.1-preview.1`，旧安装器与当前源码分开看待。
- 隐藏初始化期间仅对本窗口关闭 `backgroundThrottling`；首次显示后恢复。已显示窗口重载保持可见，不能再次隐藏等待帧回调。
- `frontendReady` 在完整前端初始化及首帧后发出，主进程验证发送窗口、主 frame 与来源；不能用简单测试页替代生产 WebGL 启动。
- 现有完整隔离探针在36张合成专辑场景中一次 ready 约9.95秒。它只证明功能链路可达，不是可跨版本比较的启动基准或个人曲库耗时。
- `view`、entry identity、来源选择 revision、主题与盒体偏好继续由现有公共状态管理；优化不能复制第二套状态或第二个 renderer。
- 原始歌词、音乐、用户预设和缓存受现有保护；不通过清个人数据、强制重置或权限放宽解决性能问题。

## 测量与验收

先记录同一窗口尺寸、比例、布局、主题、盒体、画质、数据规模、冷/暖启动条件及运行环境，再比较改动。区分启动等待、稳定帧时间、交互卡顿和音频处理；不要只报平均 FPS。

每个性能改动必须有可重现的前后对照，并保留当前视觉和交互契约。回归重点：启动首次显示/重载、ARRAY/MATRIX/GRID、专辑开返和身份、主题/日夜、歌词切源/偏移、EQ、原生窗口与资源释放。

默认使用合成目录及 mock 音频端口。个人曲库、实际设备或系统变更按任务授权单独处理；现有隔离结果不冒充硬件验收。需要新增工具或依赖时先说明并取得批准。

## 当前验证入口

| 目的 | 入口 |
| --- | --- |
| 基本离线检查 | `npm test` |
| 界面类型与构建 | `node scripts/build-source-preview.mjs --interface-only` |
| 真实前端隐藏启动/重载 | `node desktop/check-startup-entry.cjs` |
| Future 入场与文本边界 | `node scripts/check-entry-preferences.mjs`；`node desktop/check-startup-entry.cjs --future-entry`，合成专辑与模拟音频；截图及报告保存在 `.tools/future-entry-2026-10-17/` |
| 系统跟随语义与整窗交互 | `node --experimental-strip-types --test scripts/check-music-theme-follow.mjs`；`node desktop/check-startup-entry.cjs --theme-follow` |
| Settings 显示与性能、STYLE、全屏和显卡 | `node scripts/check-gpu-selection.cjs`；`node desktop/check-startup-entry.cjs --graphics`（兼容保留的 probe 名称，检查 Settings → 显示与性能及 STYLE）；可加 `--gpu-manual` 验证隔离配置中的物理卡启动路径 |
| Future 两弹窗 | `node desktop/check-startup-entry.cjs --future-panels` |
| EQ 图例裁切 | `node scripts/check-foobar-layout.mjs --eq-legend` |
| Future 简单款玻璃与预览 | `node desktop/check-startup-entry.cjs --case-glass`，合成专辑与 mock 音频，检查透光/磨砂保存、结构往返及局部重置 |
| 两主题布局切换、拖动与 ARRAY 入场 | `node --experimental-strip-types --test scripts/check-layout-flight.mjs scripts/check-music-layout-motion.mjs`；`node scripts/check-archive-geometry.mjs`；`node desktop/check-startup-entry.cjs --archive-motion` |
| 三维资源/盒体专项 | `scripts/check-case-system.mjs`，按相关模式运行 |

只运行与当前改动相关的必要检查，命令索引不要求逐次补跑全部旧矩阵。环境与边界见[本地开发](LOCAL-DEVELOPMENT.md)。

## 追溯与本次整理

用户确认前的源码节点为 `fc0790e`。整理前本地标签为 `checkpoint/pre-optimization-cleanup-2026-10-17`；更早的修改前快照标签 `checkpoint/pre-unified-ui-2026-10-17` 继续保留。

仓库入口改为当前状态、优化基线、开发操作及专项契约；清退过时阶段报告、重复修复战报和专属历史配图，历史通过 Git 恢复。本机工具、依赖、构建产物、个人数据、来源与许可不因文档整理迁移或删除。
