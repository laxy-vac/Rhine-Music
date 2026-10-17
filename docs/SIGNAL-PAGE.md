# 当前信号页与真实数据边界

当前能力见[状态](PROJECT-STATUS.md)，外观见[主题系统](THEME-PAGE.md)，性能测量见[优化基线](OPTIMIZATION-BASELINE.md)。

## 模式与页面

两主题统一顺序：**3D → 2D → CLASSIC → SPECTRUM**。大莫比乌斯主体与盒体的小徽记分别呈现。

- 3D用参考主题预渲染日夜底图和光纤路径，叠加真实频段驱动的光迹，不宣称可旋转实时网格。
- 2D保留环线、交叉遮挡、移动缺口与端点。
- CLASSIC显示封面/进度/真实频段仪表及曲目信息。
- SPECTRUM绘制真实FFT，20Hz至min(20kHz,Nyquist)对数横轴，0至−120dBFS纵轴，悬停读最近原始bin。
- 播放轨迹只记录本次前台页面采到的原生PCM峰值，未采到处留空，不冒充完整离线波形；浏览器无对应时域峰值时保留基线。
- 离页/后台停止绘制，减少动态有效；无可用数据不继续伪动画。

Punk工具栏/读数完整显示，轨迹固定112px避免Canvas尺寸反馈挤塌视图区，角框按高度限制；Future保留自己的大环尺寸/轻透终端外观。页切换分别使用主题动效，不让Future照搬Punk扫描。

## 音频来源

native/pcm-spectrum.h从已有原子采样环取数据；FFT/JSON在控制线程，不在设备回调加锁、分配、读文件或网络。原生FFT提供fftSize/binHz/binsDb/peakDb/rmsDb，左右取较大幅度避免抵消，Hann归一化，最多32768点。

浏览器使用真实AnalyserNode（8192点、关闭其时间平滑）。WebAudio与原生窗函数/标定不同，不能直接比较绝对读数。原生取DSP/SRC/混音后、数字音量前的PCM，有预取和轮询延迟，不是DAC输出测量。DSD原生/DoP没有可用PCM谱，不把位流当PCM。

## 性能实现

- 静态网格/坐标/像素桶缓存，只有新FFT或尺寸/率变化才聚合；每物理像素列保留最大原始bin，不生成额外频率样本。
- 单一RAF/失效调度，文字不重复写DOM；悬停读取原始bin，显示插值不是提高测量精度。
- 2D预计算Path2D及交叉层，3D缓存静态底图，历史轨迹缓存/按需更新。
- 2D/3D每33ms读取当前快照、真实band约55ms插值，无数据立即归零；绘制上限60Hz、DPR≤2，减少动态约10Hz。
- 原生状态默认250ms，信号页前台临时需求100ms；离页/后台释放，单个在途轮询。33ms快照读取不等于33ms设备轮询。

布局、缓存/调度、无数据/停绘/seek等可用隔离合成检查验证；它们不等于实机GPU端到端FPS或音乐播放测量。后续性能统一按[优化基线](OPTIMIZATION-BASELINE.md)记录。

## 来源与许可

参考用户提供的Audio Archive/RhinE1.4.0主题signal/ring/emblem等模块。原字节ring-day.png、ring-night.png、ring.json和许可在src/assets/signal；未安装foobar宿主或其组件。

代码与素材各自许可见 [NOTICE](../NOTICE.md)、[来源](FOOBAR-STYLE-SOURCES.md)。参考包未完整列明的第三方材质来源仍是将来分发前核实项，不意味着当前获准公开发布。

歌词的待机/读取/缺歌词/错误空态和选项入口继续保留；其当前三栏/主题外观以THEME-PAGE为准，不恢复早期独立档案/队列排版。
