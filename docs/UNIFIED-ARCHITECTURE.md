# Future / Punk 统一架构

本文描述当前实现的职责边界与稳定接口。主题外观见 [THEME-PAGE](THEME-PAGE.md)，歌词行为见 [LYRICS](LYRICS.md)，运行入口见 [LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md)。

## 职责边界

- [music-app.ts](../src/music-app.ts) 负责应用接线、持久化偏好与页面路由；播放器是两主题共享的一份播放状态。
- [music-application-state.ts](../src/music-application-state.ts) 保存公共选择与浏览状态：专辑/曲目焦点、详情模式、资料页签与滚动位置、目录视图、查询和运行期网格页码。主题外观和三维坐标不属于此状态。
- [music-catalog.ts](../src/music-catalog.ts) 负责公共展示条目、筛选、分组、排序和焦点解析；[music-catalog-markup.ts](../src/music-catalog-markup.ts) 与 [music-catalog-grid.ts](../src/music-catalog-grid.ts) 用同一目录生成两主题控件与网格。
- [scene.ts](../src/scene.ts) 的 <code>ArchiveScene</code> 为唱片货架、连续阵列和网格详情提供同一 Three.js/WebGL 场景、renderer 与资源生命周期。主题皮肤提供色彩、字体、模型和材质，不创建另一套目录状态、交互算法或播放状态。

## 目录身份与视图

<code>MusicDisplayEntry.key</code> 是稳定的专辑或曲目身份；<code>recordIndex</code> 只指向按专辑组织的 canonical records 数组，不能代替 entry 身份。TRACKS 每首曲目有自己的 entry key，同时保留父专辑 ID 与编号。

<code>MusicCatalogGroup.entryKeys</code> 是目录和各布局之间的公共桥接。[music-catalog-shelves.ts](../src/music-catalog-shelves.ts) 按 entry key 映射货架槽位；实体货架按 20 个槽分页，组内容超过时拆成连续段，首末边界停止导航。连续阵列按公共分组结果形成列并使用空间投影；网格通过 [music-grid-page.ts](../src/music-grid-page.ts) 分页，只绘制当前页，页码不改变选中项或详情身份。

可持久化视图位于 <code>preferences.view</code>，字段定义在 [music-view-settings.ts](../src/music-view-settings.ts)：

| 字段 | 值 |
| --- | --- |
| layout | <code>shelf</code> / <code>array</code> / <code>grid</code> |
| show | <code>albums</code> / <code>tracks</code> |
| group | <code>genre</code> / <code>artist</code> / <code>decade</code> / <code>az</code> / <code>none</code> |
| sort | <code>artist</code> / <code>title</code> / <code>year</code> / <code>added</code> |
| gridPageSize | 10 / 36 / 50 / 75 / 100 / 200；默认 36 |

可见布局名称映射为 <code>shelf</code>→ARRAY、<code>array</code>→MATRIX、<code>grid</code>→GRID。<code>foobarArchive</code> 只作为兼容投影；有效的 <code>preferences.view</code> 字段优先，旧布局值 <code>array/future/grid</code> 分别迁移为 <code>shelf/array/grid</code>。缺少有效布局时仅用旧主题选择决定首个默认值。网格页码、查询和选中上下文属于运行期状态，不自动恢复到启动会话。

查询、SHOW、GROUP、SORT 或每页数量改变目录结果时，网格回到第一页；主题/布局切换保留页码，结果缩小时将页码夹到有效范围。独立选择变化会显露目标 entry 所在页；手动翻页不会被旧选择拉回。三维货架的 20 槽分页与二维网格分页互不影响。

## 渲染资源与主题

[MusicSceneResources](../src/music-scene-resources.ts)、货架场景和 [MusicCaseTitles](../src/music-case-titles.ts) 为共同场景建立程序货架、地面细节和标签图集。Future 用陶瓷与轻玻璃边，Punk 用工业金属与对应主题色板；共同身份、命中测试、光学和材质生命周期由共享场景承载。程序货架与地面是按现有布局和盒体尺寸估算的几何，不是原作者网格或像素复刻。

布局坐标只负责场景投影与镜头，不作为曲库身份。主题或布局变化应保留当前 entry、父专辑、右侧资料、页签和阅读位置；播放队列继续由公共播放器管理。浏览键鼠规则由公共目录和场景使用，主题只改变呈现。

## 启动与质量边界

桌面启动先完成前端初始化和必要首帧，再显示主窗口；当前流程没有旧 intro。初始化门只处理窗口启动就绪，不承担播放器状态持久化。

画质偏好是全局设置，用户主动采用质量建议或手动改档才更新；日常运行不自动切换画质、盒型或材质。性能建议使用合成场景，不能代表实际设备帧率或 RTX 5080 的性能结果。本文不记录硬件性能结论。

## 相关实现

- 状态与 view：[music-application-state.ts](../src/music-application-state.ts)、[music-view-settings.ts](../src/music-view-settings.ts)
- 目录、货架、网格：[music-catalog.ts](../src/music-catalog.ts)、[music-catalog-shelves.ts](../src/music-catalog-shelves.ts)、[music-catalog-grid.ts](../src/music-catalog-grid.ts)、[music-grid-page.ts](../src/music-grid-page.ts)、[music-spatial-layout.ts](../src/music-spatial-layout.ts)、[music-display-layout.ts](../src/music-display-layout.ts)
- 场景与资源：[scene.ts](../src/scene.ts)、[music-scene-resources.ts](../src/music-scene-resources.ts)、[music-case-titles.ts](../src/music-case-titles.ts)
