# 歌词、缓存与频谱规范

Future 与 Punk 共用歌词数据、三栏页面和偏移逻辑；主题只改变页面外观。布局见 [THEME-PAGE](THEME-PAGE.md)，语言规则见 [UI-LANGUAGE](UI-LANGUAGE.md)。

## 来源选择与有效内容

歌词选项只有“本地歌词”和“云歌词”两页。打开弹窗时定位到用户当前选择的 <code>activeKind</code>；这是页签偏好，不等同于当前显示文档的来源。

点击“本地歌词”只切换到 Local 页，不打开文件选择器。若本地 bank 为空，界面读取 Cloud bank；没有缓存时可按全局默认来源自动解析。API 以 <code>effectiveKind</code> 标出实际文档，并在回退时设置 <code>usingCloudFallback</code>。Local 页签仍保持选中，显示“无本地歌词，使用云歌词”，本地偏移控件禁用，不能把校准写入 Cloud。Cloud 也无内容时歌词区保持空白。

显式选择 Cloud 后保持 Cloud，即使之后出现本地文档也不自动切回。只有点击 Import 才打开本地选择器；导入成功立即选用 Local。导入或选用云候选后，弹窗保持打开以调整当前 bank 的偏移。弹窗临时选择的 provider 只用于本次查找；自动来源默认来自全局设置。

V3 使用 <code>activeKind</code> 保存选择，<code>userSelected</code> 标识明确选择，<code>selectionRevision</code> 在明确切换或导入时递增。自动结果和导入提交都核对选择版本，迟到结果不能覆盖之后的用户选择或切歌后的文档。旧的单曲来源偏好文件和 API 继续兼容；当前不提供单曲默认来源 UI，自动解析与云搜索默认也不读取它们。

## V3 缓存与迁移

每首曲目对应一个 SHA-256 命名的 JSON 容器，按 track ID 识别。容器含 <code>local</code>、<code>cloud</code> 两个独立 bank，以及当前选择和 revision；每个 bank 最多保存一份歌词文档及其偏移。

默认数据位于应用数据目录的 <code>lyrics/cache</code>，全局来源与缓存目录设置在 <code>lyrics/settings.json</code>，自定义来源在 <code>lyrics/sources.json</code>。读取依次检查当前目录、最多 16 个旧配置目录和默认目录。更换目录设置本身不移动文件；后续保存将同曲目可确认的 bank 合并写入当前目录，原子写入成功后清理被合并的旧副本。

V1/V2 文档在读取时只于内存中归一化；写入时保存为 V3。仅合并可确认属于同一 track ID 的内容。坏文件、未知格式、非普通文件或链接不会被覆盖；不扫描配置目录之外的缓存。

## 偏移与导入

偏移按 bank 独立保存，范围为 −30 至 +30 秒，正值使歌词提前。偏移写入缓存副本的 LRC <code>[offset]</code> 标签，同时以 <code>offsetMs</code> 记录相对原歌词的用户调整量；既有 LRC offset 保留且只应用一次。校准不改变 <code>activeKind</code> 或用户来源选择，Local fallback 时不得跨写 Cloud。

导入只接受最多 96 KiB 的 UTF-8 LRC/TXT 文本。界面把内容副本发送给本机服务，不发送源文件路径；原始歌词文件和音乐文件不会被改写或删除，也不写音频标签。TXT 作为纯文本显示，不伪造时间轴。

## 自动与手动查找

首次尚无本地副本时优先使用云歌词，来源由全局设置决定（默认QQ音乐）；导入成功后立即选用Local，之后以用户显式选择为准，不因重新打开设置或晚到请求改变来源。

播放器识别当前曲目后即可在后台解析，不要求用户先打开歌词页。自动匹配要求曲名可靠；有艺人资料时同时核对艺人，艺人未知时使用专辑或时长辅助。每个来源最多尝试三个可信候选；来源错误会显示状态并继续尝试。来源接口可能变化，也无法保证每首歌曲都有可用歌词。

Cloud 页可手动查找不同版本并查看来源状态。选中候选仅替换 Cloud bank；导入仅替换 Local bank。两种操作都保留另一 bank。页面离开会取消手动界面请求，当前曲目的自动解析可继续；切歌后旧请求不能更新新曲显示。

## 跟随与当前句

跟随播放默认开启。滚轮、触摸、拖动滚动条或歌词区滚动按键等用户滚动会暂停跟随；程序滚动不会暂停。用户可打开“跟随播放”或按“回到当前行”恢复。切歌与返回歌词页重新启用跟随。

底栏当前句由 <code>setupLyricsPage().currentLine(position)</code> 从当前曲目文档、解析结果和偏移计算。歌词页隐藏时仍可读取；加载、切源或校准后以 <code>lyrics-content-changed</code> 同步。换曲时不显示旧曲文档。无定时歌词或首句尚未到达时留空；底栏保留 18px 单行槽并以完整 title 提供全文。

## 真实频谱

WASAPI/ASIO 的 PCM 频谱取自 DSP、SRC 和队列混音之后、主音量之前的实际 PCM；原生回调只写固定容量样本槽，FFT 在线程状态侧最多每 100ms 计算一次。显示 32 个对数频段，范围 20Hz 至 min(20kHz, Nyquist)。它用于可视化，不是精密测量，也不改变音乐输出。

歌词页可见、文档未隐藏时才请求频谱快照；离页、隐藏或销毁时释放需求并清空显示。32 根柱按动画帧绘制，各频段独立平滑：上升时间常数 45ms、回落 180ms；静止输入会收敛，减少动态时直接跟随采样。浏览器播放使用当前歌曲的 Web Audio 分析。原生 DSD/DoP 没有 PCM 频谱，页面明确显示不可用，不把 DSD 载荷或 DoP 容器当作音频分析。

## 实现入口

- 页面与偏移：[lyrics-page.ts](../src/lyrics-page.ts)
- 全局来源和缓存目录设置：[lyrics-settings.ts](../src/lyrics-settings.ts)
- V3 bank、迁移与来源实现：[lyrics-library.mjs](../scripts/lyrics-library.mjs)
- 原生频谱：[pcm-spectrum.h](../native/pcm-spectrum.h)
