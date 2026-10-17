# Future 界面音效

核对来源为 LBEILC/RhineLabUI 的 `12cc5e4013acb9408f753ff71de6b8492299b7c8`。以下区分上游实际触发与播放器适配，17 个 Sound 均有上游调用路径。合成参数来自 [audio.ts](https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/src/audio.ts)，交互来自 [main.ts](https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/src/main.ts)。

## 音色与操作

| Sound | 听感 | 上游触发 | 当前 Future 对应 |
| --- | --- | --- | --- |
| `tick` | 单次清脆玻璃轻击 | 上下选档、直接选档、小游戏有效命中 | 专辑选择 |
| `column` | 间隔 45 ms 的高低双玻璃音 | 横向切列，按方向偏左/右 | 切列及 ±0.45 声像 |
| `open` | 双玻璃音加短气流 | 打开档案、入场后段抽取 | 打开专辑详情 |
| `back` | 玻璃音加下落低音 | 详情返回、Esc 返回 | 专辑详情返回 |
| `page-open` | 上扫气流与两层音调 | 弹窗、查看器打开 | Settings/Style/EQ/歌词/信号及搜索/在线弹窗打开 |
| `page-close` | 下扫气流与下落音调 | 弹窗、查看器关闭 | 管理页返回及弹窗关闭 |
| `ui-tick` | 短噪声点与电子轻响 | 详情页签、重播、查看器清晰/磨砂/复位 | 详情页签、Settings 分类、重播 |
| `confirm` | 间隔 95 ms 的双电子音 | 收藏、声音/动效设置确认、试听、跳过 | 声音/动效设置提交、试听、跳过 |
| `key` | 轮换 PCM 键击采样 | 入场文字实际增加字符的帧 | 同一节奏，并跟随自定义欢迎 ID |
| `brand` | 分层三音与气流 | 入场 Logo | 入场 Logo |
| `scan` | 长上扫与四个电子脉冲 | 入场验证扫描 | 入场验证扫描 |
| `welcome` | 逐层进入的和弦与气流 | 入场欢迎 | 入场欢迎 |
| `text-reveal` | 短扫频与电子点 | 入场两次文字揭示 | 同一时间轴 |
| `array` | 长扫频与五个递进玻璃音 | 入场阵列展开 | 入场阵列展开 |
| `inspect` | 间隔 110 ms 的同音双击 | 上游入场进入独立查看阶段 | 当前入场止于总览，没有对应阶段 |
| `explode` | 三个递升玻璃音 | 查看器拆解 | 结构查看器当前未开放 |
| `assemble` | 三个递降玻璃音 | 查看器重组 | 结构查看器当前未开放 |

音量/画质滑杆和鼠标悬停没有上游连续音效；画质预设也不播放确认。滑杆保持安静，使用试听确认音量。声音及动效开关按上游提交设置的逻辑播放一次确认；当前入场自动播放和唱片波动属于动效设置。小游戏和结构查看器的音效只对应其实际操作，不扩散到其它按钮。

## 入场时钟

上游音频时钟为入场 app time +5 秒。Future 接入 9.16 `brand`、11.84 `confirm`、19.48 `scan`、21.84 `confirm`、22.76 `welcome`、23.52/25.04 `text-reveal`、26.92 `array`。当前演出停在专辑总览，不触发上游随后 30.68 `open`、34.3 `inspect` 所对应的抽取和独立查看。

键击按 [typing-rhythm.ts](https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/src/typing-rhythm.ts) 的 25 fps 文字增长帧判断，忽略空格和故障文字恢复；每帧最多一个键击。自定义 ID 使用同一 bootMotion 字符进度重新计算。时间回拨、隐藏/冻结及超过 300 ms 的跳帧不追补错过的声音。桌面原生输出允许已开启声音的入场自动开始；浏览器兼容输出仍遵循浏览器的手势限制。

## 输出与约束

Future 专用；Punk 入口保持禁用。音乐准备/播放期间静音，音乐优先取消和排空提示音；切主题、隐藏、切场景和关闭声音也会取消未完成的合成/播放。每类音效沿用独立冷却：键击 24 ms、选档/切列 55 ms，其余 120 ms；最多十个声部。

浏览器兼容输出使用原 WebAudio；原生输出把离线合成的提示音混入同一渐进 Float32 PCM 流，保留各声部尾音，不逐次重开设备。流空闲后释放设备，单流声明上限 120 秒，达到边界后排空并轮换；取消等待 stop 确认后再交给音乐。生成的精确临时文件在会话关闭后移除，不清理未知文件。WASAPI 使用所选 endpoint 的共享模式；ASIO 使用所选驱动和通道。详细协议和音乐会话释放见[音频实现](AUDIO-CORE-IMPLEMENTATION.md)。

## 验证

`desktop/check-interface-audio.cjs` 在现有 Electron 中离线合成全部 17 类提示音，检查非静音、不同波形、左右声像、入场音序、ID 键击节奏和取消；不创建真实输出 AudioContext。`scripts/check-interface-audio.mjs` 使用模拟主机检查混音叠加、尾音、十声部上限、轮换、路由及取消。`desktop/check-startup-entry.cjs --graphics` 检查 Future 昼夜滑杆、拖动/键盘/数值编辑及 Punk 皮肤。以上不是实际设备听音验收。
