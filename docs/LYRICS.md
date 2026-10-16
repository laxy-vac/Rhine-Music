# 歌词页与真实矩形频谱

> 来源/缓存/API规则仍按本文维护；当前Future/Punk均使用共同三栏与选项弹窗，视觉和页面组织见 [THEME-PAGE](THEME-PAGE.md)。2026-10-10的查询与界面检查是旧手动查找流程的历史记录，不代表当前自动匹配行为或全部歌曲、页面和设备验收；当前验证边界见 [PROJECT-STATUS](PROJECT-STATUS.md)。

**历史实现记录（2026-10-10）：** 当时QQ使用smartbox搜索，网易云/QQ以曲名和歌手检索、多源请求分别回报成功/无匹配/错误，并由用户选择候选。旧公开演示查询和隔离mock只代表当时接口样例与手动流程；它们不验证当前自动匹配、当前平台状态或所有曲目。接口和内容供应仍可能变化。

## 使用

全局配置位于设置 → 歌词：管理默认云端provider、共享歌词源与缓存目录。本曲没有独立的默认来源设置。中央标题区保留无文字小图标，打开“歌词选项”弹窗；页签为“本地歌词”和“云歌词”，打开时定位到当前`activeKind`。`activeKind`是用户偏好的页签，跨页面返回和弹窗重开时保留；Cloud回退不会改变它或递增`selectionRevision`。

点击Local只切换页签，不自动打开文件选择器。有本地文档时显示本地；缺失时显示Cloud缓存，若Cloud也无缓存则按全局provider执行云端解析。回退时`activeKind`仍为Local，API的`effectiveKind`标明实际使用Cloud文档，`usingCloudFallback`标记本地缺失；Local面板提示“无本地歌词，使用云歌词”，本地偏移校准禁用，绝不将偏移写进Cloud。Cloud也没有可用歌词时正文保持空白；只有点击Import才打开文件选择器，导入成功后立即使用Local。

点击Cloud会显式选择Cloud、显示该bank并开始搜索；此选择跨页面保存，之后不会自动回退到Local。默认provider来自全局设置，弹窗中的临时provider选择不保存为本曲默认。导入或选用候选后弹窗保持打开，方便调整当前bank的偏移。来源管理位于全局设置，其按钮高38px、使用统一材质和主题圆角，悬停不加下划线，Punk保持方角。Esc关闭弹窗而不切页，音乐继续播放。

顶栏“歌词”与音乐库、EQ平级。左侧播放信息可独立滚动，底部频谱固定保留完整高度；中央阅读歌词，右侧只保留封面与曲目信息。

Future歌词选项弹窗整体作为一块玻璃承接环境光；内部仅hover/focus-visible/selected/expanded控件显示inset表面亮边，不逐按钮生成外投光晕。弹窗打开时暂停背后接收器，关闭后恢复。该规则保留off/local/full光效质量档与Punk皮肤。

1. 每曲缓存为一个按曲目ID的SHA-256命名V3 JSON容器，包含独立的`local`/`cloud` bank，以及`userSelected`和`selectionRevision`。每个bank最多一份歌词内容和一份偏移。选择偏好与有效内容类型分开：Local缺失时可以使用Cloud缓存或自动解析的Cloud结果，但实际`effectiveKind`为Cloud并设`usingCloudFallback=true`；回退不改变`activeKind`、`userSelected`或revision。显式选择Cloud后保持Cloud，即使Local文档随后出现也不会自动切回。
2. 播放器识别当前曲目后立即后台解析，即使歌词页未打开也会开始。Local偏好下，本地bank有文档则直接显示；缺失时读取Cloud bank，未命中才按全局provider执行云端解析，最多20秒逐源回退。Cloud也没有可靠结果时正文为空。自动匹配要求曲名可靠匹配，艺人可用时同时核对艺人；艺人未知时再用专辑或时长辅助。每个来源最多尝试三个候选，来源错误或候选不可靠时继续回退。服务区分“未找到可靠匹配”和“来源暂时不可用”，无法保证每首歌曲都有可用歌词。
3. 云歌词页中的手动查找显示分来源状态和候选。用户选用候选只替换云bank并显式选择Cloud；用户导入只替换本地bank并立即显示Local，两者都不清除另一bank，并在保存后保持弹窗打开。Local fallback期间偏移控件禁用，保存偏移不会跨写Cloud。自动结果或导入若迟到，不能覆盖不匹配的选择revision或用户更新。离开歌词页会取消手动界面请求，但当前曲目的自动解析继续；切换曲目后，旧曲结果不会替换新曲显示。
4. 偏移只修改当前选中bank，不切换`activeKind`或改变`userSelected`。偏移范围为±30秒，正值表示提前，并写入该bank缓存LRC的`[offset]`标签；`offsetMs`记录相对原歌词的用户调整量，重复调整不叠加。旧缓存中的已有`[offset]`会兼容解析，播放同步与点击定位只应用一次。Local回退到Cloud时本地校准禁用，不跨写Cloud；导入或选用后弹窗保持打开，偏移控件按当前bank及回退状态启用。
5. 导入UTF-8 LRC/TXT（最多96KiB）时，界面将文件内容作为文本副本发送给本机服务；API不接收原文件路径，原始文件绝不改写或删除。纯文本只阅读，不模拟时间轴；暂不处理平台加密逐字歌词。点击有时间的行定位歌曲。
6. 跟随播放默认开启，并在切歌和返回歌词页时重新启用。用户滚轮、触摸、拖动滚动条或歌词区滚动按键会暂时关闭跟随；程序自动滚动不会关闭。手动滚动后可勾选“跟随播放”或按“回到当前行”恢复。

## 来源适配与本机数据

`scripts/lyrics-library.mjs`独立负责来源搜索、自动可靠匹配、候选、歌词获取与保存。网易云和QQ分别适配，没有下载或加载foobar插件二进制。自动解析逐源尝试，单个来源错误不会阻止后续来源；自动请求总时限20秒。手动`sourceId=auto`仍并行查询已启用来源并分别回报来源状态，候选按真实来源缓存，选用时不会把auto误作服务器ID。全局默认provider和自定义源配置保存在全局设置；弹窗中选择的provider只用于当前云端查找，不成为单曲默认。旧单曲来源偏好文件与API保留兼容，但自动解析与云端搜索默认不再读取它们，也不再提供每曲默认来源UI。来源错误、验证页、HTTP错误与空候选分别回报，不使用代理、登录Cookie或伪造地域标头。

歌词缓存默认位于`MUSIC_DATA_DIR/lyrics/cache/<trackId的SHA-256>.json`；可通过Windows文件夹选择器指定缓存目录。更换目录本身不搬运缓存。读取按当前目录、最多16个配置历史目录、默认目录回退。V1/V2缓存只在读取时于内存归一化；写入时升级为V3，并只合并能确认属于同一hash的历史bank。未知、损坏、非普通文件、符号链接和路径别名遵循原有保护规则，不扫描其他曲目或配置目录之外的路径。全局provider/目录在`MUSIC_DATA_DIR/lyrics/settings.json`，共享自定义来源在`MUSIC_DATA_DIR/lyrics/sources.json`；旧单曲来源偏好文件/API保留兼容，但不用于当前弹窗、自动解析或搜索默认。

这些本机数据不进入Git，不写音频标签。原始导入文件与音乐文件都不会被修改或删除；坏缓存/配置及不能确认用途的文件会报告并保留。正常写入使用串行原子替换。偏移只写所选bank，不影响来源选择；V3 revision保护阻止迟到自动结果覆盖后续明确选择。离页只停止手动界面请求；自动当前曲目解析继续。

自定义源支持HTTPS JSON GET接口，本机localhost/127.0.0.1/::1服务可用HTTP。默认搜索响应形如：

```json
{"results":[{"id":"song-id","title":"歌名","artist":"歌手","album":"专辑","duration":240}]}
```

歌词响应形如：

```json
{"lrc":"[00:01.00]歌词内容","translation":"[00:01.00]翻译内容"}
```

URL模板支持`{query}`、`{title}`、`{artist}`、`{album}`、`{id}`，各值独立URL编码。高级映射可指定点分字段路径，例如`{"results":"data.songs","id":"mid","title":"name","artist":"singer","album":"album.name","lrc":"data.lrc","translation":"data.translation"}`。艺人可为文本或带name的数组，时长按秒。最大12个自定义源；不执行用户脚本，不从候选中的任意地址下载文件。

## 频谱来自哪里

- WASAPI/ASIO PCM：`native/pcm-spectrum.h`收集真实PCM，在DSP、SRC和队列混音之后、主音量/淡变/量化之前取样。实时回调仅复制固定容量原子环形缓冲，FFT在status线程最多每100ms计算一次；不修改音乐样本。切曲/定位/暂停/停止重置历史，切轨或环形窗口覆盖时丢弃分析结果。
- 显示使用32个对数频段，范围20Hz至min(20kHz,Nyquist)，左右声道取较大能量，映射约-72至0dBFS。FFT窗口随采样率在4096至32768帧之间选择。这是视觉近似，不是精密频谱测量；取样精度不属于音乐输出处理精度链路。
- 浏览器兼容播放：歌词页可见时才接入当前歌曲的Web Audio Analyser，8192点FFT、32个对数频段；使用真实当前歌曲数据。分析不包含独立BGM或界面音效。
- 歌词页与文档可见时通过`setSpectrumDemand("lyrics", true)`启用已有原生100ms状态轮询；离页、文档隐藏和销毁时释放需求，兼容信号页的独立需求。不改PCM分析窗口或音频输出处理。浏览器/原生快照最多约30Hz读取，32柱按`requestAnimationFrame`与实际帧间时间连续绘制：上升时间常数45ms、回落180ms，移除旧160ms CSS过渡。仅对同一频段的显示值做时间平滑，不混合相邻频段或生成虚构波动；静止输入会收敛。暂停/不可用回落至0，切歌/隐藏清旧峰值；系统减少动态时直接跟随100ms采样，不做补间。这是绘制调度规则，不是硬件FPS结论。
- 原生DSD/DoP直出暂无PCM频谱，不把DSD载荷或DoP容器当成音乐PCM分析；页面明确显示不可用。歌词进度仍可同步。

## foobar2000参考与接口资料

参考[foobar官方OpenLyrics页面](https://www.foobar2000.org/components/view/foo_openlyrics)及维护者的[来源适配器目录](https://github.com/jacquesh/foo_openlyrics/tree/main/src/sources)：采用独立来源、本地优先与可取消请求。自动解析按来源顺序尝试并只采用可靠匹配；手动多源搜索用于云bank的查找与覆盖。Local偏好时，缺少本地文档先读取Cloud bank，未命中才按全局provider解析Cloud；点击Local页签不会打开选择器，也不会阻止Cloud回退。显式Cloud选择后保持Cloud；只有显式点击Import才打开文件选择器。页面离开不取消当前曲目的自动解析。没有复制C++实现或加载其插件ABI。

协议参考OpenLyrics的[网易](https://github.com/jacquesh/foo_openlyrics/blob/main/src/sources/netease.cpp)和[QQ](https://github.com/jacquesh/foo_openlyrics/blob/main/src/sources/qqmusic.cpp)适配器。2026-10-10公开演示“晴天 / 周杰伦”检查中，旧QQ Desktop POST返回服务码2001；smartbox HTTPS GET返回歌曲mid，既有歌词HTTPS GET返回retcode=0及非空定时歌词。网易云GET也返回code=200和可解析候选。这些是当时样例健康结果，不保证所有歌曲/地区或平台接口长期可用，不将无法访问当作“没有歌词”。Local偏好下，本地bank缺失时先使用Cloud缓存或按全局provider解析Cloud；显式切到Cloud后保持Cloud。点击Local本身不打开选择器，只有点击Import才进入导入流程。

来源接口与歌词内容保留各自权利，不改授本项目MIT；歌词缓存只留本机，不分发歌词内容。

## 当前实现验证状态

频谱连续运动修正：TypeScript与1662模块interface-only构建通过，日志在`.tools/lyrics-spectrum-motion/build.log`。`node scripts/check-lyrics-page.mjs --spectrum-motion`最终报告11项全通过，报告/四张稳定绘制截图在`.tools/lyrics-spectrum-motion/run-1792159827778-859aa4c4/`。同一快照约162ms内有10个不同生产DOM中间值；近等长上升/回落窗口的目标剩余差比例为0.0357/0.3963，确认快起慢落。静止32频段收敛后恒定，NaN/越界、暂停/不可用归零、切歌清峰、减少动态、页/文档显隐和销毁均通过。真实NativeAudio类配合全mock请求及惰性计时器探针确认250→100→250ms需求切换与signal共存；没有访问设备或真实原生服务，不证明实际网络延迟/FFT吞吐。两主题使用有效`rhine/archive` key与生产日夜颜色，等待离屏paint后核验三栏/32柱；主Agent复核Future日间与Punk夜间截图。无外网请求，未启动个人播放器或验证硬件FPS/实际歌曲观感。下列歌词来源/光效检查属于此前完成的功能验证。

2026-10-16当前Local fallback与Future歌词弹窗光效修正验证完成，产物位于`.tools/lyrics-local-fallback`。TypeScript和1662模块interface-only Vite build通过，日志为`build.log`。`node --test scripts/check-lyrics-library.mjs`最终29/29通过，0失败/取消/跳过，日志为`library-check.log`；首次28/29失败是Windows测试夹具清理临时目录时遇到`ENOTEMPTY`，脚本增加library队列等待和有限重试后复跑通过。

`node scripts/check-lyrics-page.mjs --lyrics-local-fallback`最终`ok=true`，报告11项检查均为true，18张截图位于`.tools/lyrics-local-fallback/run-1792158440496-eaab20df/`。覆盖手动Import、Local的Cloud缓存/自动解析成功与失败回退、bank独立偏移、显式Cloud保持、慢速切源跨页、弹窗开关时背后receiver暂停/恢复，以及Future日夜Manage/Search/Use空闲/悬停/焦点、local/off几何和Punk方角。主Agent复核day空闲、Manage悬停、Search焦点、night Manage焦点、Use悬停、Punk悬停及Local fallback截图。

UI检查使用既有Electron隐藏窗口、全部mock且无外部请求。Windows文件选择器仅拦截调用意图，focus-visible使用CDP伪状态；没有验证真实Windows选择器/键盘、线上歌词服务、个人播放器整窗或音频设备。以下`8581466`、`a684885`记录仍仅作历史，不计入本轮验收。

历史记录：提交`8581466`及`.tools/lyrics-source-refinement/run-1792154817478-3a6a833b`中的28项歌词库mock、26项离屏UI与40个标题用例属于前轮验证。该轮歌词语义是Local无文时直接打开选择器且不回退Cloud，因此不能证明当前Local页签回退、`effectiveKind`/`usingCloudFallback`、禁用Local校准或当前竞态守卫。标题用例记录仍可追溯为独立组件历史结果，但不是本轮构建或歌词规则的验证。

更早的提交`a684885`与`.tools/future-lyrics/`下24/24库检查、18/18离屏UI检查，针对V2单文档及“查找歌词/本曲设置”旧弹窗；它们不覆盖当前V3双bank、`activeKind`与fallback规则，也不代表本轮检查通过。历史检查使用合成曲目与mock来源，不能替代真实Windows选择器/键盘、线上服务、个人整窗或硬件验收。

## 历史本地验证（2026-10-10旧手动流程）

当时的`node --test scripts/check-lyrics-library.mjs`使用mock fetch与合成曲目，检查QQ解析、手动选择保存、网易云搜索词/艺人别名、多源错误/空候选、旧缓存与取消。产物位于仓库旁`.task-tmp`的唯一目录，不进入Git；不会联网或打开音频设备。页面布局检查也使用隔离Electron窗口和mock接口，不加载个人曲库。上述覆盖不验证当前自动匹配、V2迁移或V3双bank行为。

`node scripts/check-lyrics-page.mjs`当时使用现有Electron/Vite和真实页面样式，以隐藏窗口核对1280×840与1100×720。最终报告在仓库旁`.task-tmp/lyrics-page-review/run-1791647912562-32755c9c/report.json`，同目录有两张旧流程合成布局截图。该次验证过频谱高度、标题区32×32按钮、弹窗、手动搜索/候选选择、偏移及Esc关闭；所有API均为mock，没有外网/设备请求，profile和缓存不进Git。它是旧页面样式与手动查找流程记录，不是当前自动解析、Future新样式或缓存version 2的验证。
