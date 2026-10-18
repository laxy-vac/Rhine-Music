# 启动与运行性能优化基线

更新：2026-10-18。已建立 MATRIX 拖动和 ARRAY 连续切选的隔离测量，并完成 MATRIX 标签图集的首项优化。后续继续围绕已测热点处理长帧，保留画质和视觉设计。功能地图见 [PROJECT-STATUS](PROJECT-STATUS.md)，环境和操作见 [LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md)。

## 已完成的 MATRIX 标签优化

标签按实际显示编号缓存，保持原 `paintArchiveLabel`、像素尺寸、材质与深度规则。物理槽位换位只更新图集 UV/页码，缓存上限为既有实例池容量；资源刷新仍会重画，选中标签及退回快照保持独立。

本机 RTX 5080，Rhine 日间、极致/Punk，窗口 2560×1440、DPR 1、渲染缓冲 3840×2160；45 张 PNG 合成专辑、三个年代组 7/28/10、7–23 字符标题。相同 Home 锚点、16ms 原生鼠标输入、230/80px 正弦轨迹、每轮 6 秒拖动；排除预热、隐藏或拖动中断样本，前后三轮有效采样。

| 指标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 合并平均帧间隔 | 213.2ms | 26.5ms |
| P95 帧间隔 | 322.1ms | 116.6ms |
| 按平均帧间隔计算的帧率 | 4.69 FPS | 37.75 FPS |
| 独立诊断段估算纹理上传/帧（含封面） | 82.88 MB | 0.34 MB |

两版诊断段均为每帧 226 个绘制调用、182,829,936 个累计提交三角形；画质、模型、布局和动效相关源码指纹一致。28 组真实浏览器检查覆盖 729 槽、4K 分页/16K 单页、编号重排/淘汰/刷新/重建，抽检标签 RGBA、选中标签及 UV/徽标身份均一致。完整窗口观感仍由用户验收。

私有曲库和材质预设未复制；这些是合成条件的前后结果，不能推为所有曲库的固定增益。新编号缓存未命中仍可能上传纹理页。平均性能已改善，长帧未完全消失，不能宣称已稳定达到 60 FPS。原始数据和像素结果在本机忽略目录 `.tools/performance-matrix-label-fix-20261018/`，汇总为 `comparison.json`。

## 范围与工作方式

- 保留当前功能、画质、镜头、几何布局和动效，不借性能任务重新设计界面或继续打磨 Punk 顶屏。
- 先测量、后改动，每次围绕已确认的热点给出可重现的前后对照；区分已验证事实、推测与未知。
- 视觉验收交用户。仅运行与实际改动直接相关的构建和有限回归，不默认多轮 Agent 复核、整套历史测试或大规模截图采样。
- 复用已有环境。安装、依赖/驱动变更、共享配置、安全设置、个人曲库和真实音频设备仍遵守任务授权，不能用准备脚本或包管理器隐式扩展。

## 首轮应得到的结果

| 项目 | 当前已知 | 需要测量 |
| --- | --- | --- |
| 启动 | 后台初始化及必要首帧后显示；显示后的窗口重载保持可见 | 服务/偏好/索引、资源读取、场景创建、着色器及首帧各阶段的关键路径；冷/暖条件分别记录 |
| 运行掉帧 | MATRIX 标签整页重传已修；ARRAY 已完成纹理/元数据滚字的分项对照 | 后续优先检查封面 `copyTextureToTexture` 的同步状态读取、ARRAY 更新合并及个人数据条件；整机资源基线仍待测 |
| 场景成本 | 盒体实例、玻璃透射、阴影、AO、景深及后处理共存 | 区分 CPU 更新、GPU 绘制、编译、上传、资源分配和合成成本，确认实际瓶颈 |
| 闲置与页面生命周期 | 共用场景与资源已有释放路径，实际闲置开销未测 | 静止、隐藏、页面切换及开返后的持续更新、监听器、纹理重画/上传和内存增长 |

音频 DSP 实时优化、Punk UI 大修及其他入场不属于本阶段，除非用户另行指定。

## 测量口径

记录同一主题/日夜、布局、盒型/材质、画质档位、实际渲染尺寸/DPR、窗口比例、显示状态、数据规模、缓存和运行环境。优先用可重复的合成目录及 mock 音频隔离问题；个人曲库和真实设备只在获准范围内使用。

覆盖静止、选片、MATRIX 拖动、ARRAY/MATRIX 切换、详情开返、页面切换、歌词/信号页等实际操作。按发现的问题选取代表场景，不要求每次穷举全部组合。

帧时间来自实际 RAF/性能时间戳或可靠的 CPU/GPU 观测。`src/scene.ts` 当前 `stats().frameTime` 返回 `this.clock`，是场景累计时间；`drawCalls/triangles` 直接来自 `renderer.info.render`，尚未建立整帧多 pass 汇总口径。不要直接把这些字段当成完整帧成本。GPU 时间不可用时明确说明，不能由 CPU 时间倒推。

`quality-detection.ts` / `quality-benchmark-frame.ts` 已有合成 ARRAY 和开返场景、FPS、P95、慢帧比例及样本数，可按需要复用。它用于画质建议，不覆盖所有布局或真实曲库，也不是当前 RTX 5080 的瓶颈结论。

## 需要保护的实现

- Future/Punk 共用状态、目录、播放、ArchiveScene/WebGL 和生命周期，不复制第二套权威状态或 renderer。
- 公共布局值仍是 `shelf`→ARRAY、`array`→MATRIX、`grid`→GRID，entry key 与父专辑身份不能被槽位编号替代。
- ARRAY 每架 20 槽；普通 MATRIX 池为 9×48，桥接预留 729 槽。已有可见专辑保持身份，循环副本、末列与地下裁剪规则保留。
- 只优化桥接实现时仍保留原静态镜头：MATRIX 距离 140、基准 span 7.33、59°/25°；不能根据 ARRAY 缩放或实例数改变 MATRIX 构图。ARRAY 保留自己的响应式镜头规则。
- 渲染链包含主场景、SSAO、Bokeh、SMAA、播放栏玻璃/输出与阵列淡化等 pass，启用情况受画质影响。Punk 源盒体为 98,080 三角形、15 部件类型；这些是候选成本，尚未证明是掉帧原因。
- 不通过降低用户画质、切换盒型/设备、清个人缓存、缩减条目或改变偏好掩盖问题。诊断时临时对照参数须明确记录并恢复。
- 源模型、材质与视觉资源的版权、哈希版本、用户预设和数据格式保持；原生音频输出与设备释放不可因图形优化退化。

## 按需使用的入口

| 目的 | 入口 |
| --- | --- |
| 必要类型与前端构建 | `node scripts/build-source-preview.mjs --interface-only` |
| 质量建议及合成测量 | Settings → 显示与性能；`src/quality-detection.ts`、`src/quality-benchmark-frame.ts` |
| 启动门/重载 | `node desktop/check-startup-entry.cjs` |
| 镜头、布局与升沉纯检查 | `node --experimental-strip-types --test scripts/check-layout-flight.mjs scripts/check-layout-addresses.mjs scripts/check-music-layout-motion.mjs` |
| 地下裁剪或几何改动 | `scripts/check-appearance.mjs`、`scripts/check-archive-geometry.mjs`，仅在改动相关实现时使用 |
| 必要整窗交互 | `desktop/check-startup-entry.cjs` 的 `--graphics`、`--archive-motion` 等既有模式；不作为每次默认步骤 |
| 显卡身份 | `node scripts/check-gpu-selection.cjs` |

当前只有上述限定条件的运行性能对照，尚无完整整机/启动基准；不得把功能检查通过数当成性能改善。标签缓存的有限纯检查为 `node --experimental-strip-types scripts/check-label-atlas-cache.mjs`、`node --experimental-strip-types scripts/check-paper-atlas.mjs` 和 `node scripts/check-archive-label.mjs`。Punk 顶屏的一次性验收脚本和旧合成报告已清退，不恢复独立设计验收框架。

性能结果及临时捕获放在新的专用 `.tools/performance-*` 目录，与工具、源码和个人数据分开。交付时说明测量条件、前后数据、实际修改和局限，不追加逐轮战报。
