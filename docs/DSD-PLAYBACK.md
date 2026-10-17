# DSD与DoP

本文记录当前软件路由与传输契约。处理链见[AUDIO-CORE-IMPLEMENTATION](AUDIO-CORE-IMPLEMENTATION.md)，操作见[LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md)。

## 输出路线

| 输出 | DSD配置 | 限制 |
| --- | --- | --- |
| WASAPI共享 | 转PCM | 不提供DoP |
| WASAPI独占 | 转PCM / DoP | DoP使用精确载波率的PCM24或PCM32 valid-24整数容器 |
| ASIO | 转PCM / 原生DSD / DoP | 使用独立保存的ASIO路线，设备须支持精确格式 |

DoP的PCM容器承载DSD字节，不是将音乐转成PCM。链路分别显示DSD源率、DoP帧率与容器位宽；有实际会话回报才显示确认结果，仅保存配置不能冒充设备已接收。

原生DSD和DoP直接读取DSD源，不经过Sony PCM缓存、普通DSP、歌曲数字音量、混音或淡入淡出。设备不支持、无效标记或路线不合法时明确报错，不静默转PCM或切输出。PCM曲目继续按PCM路线播放。

## 文件与封装

支持DSF及未压缩DFF，不冒充支持DST压缩DFF。DSF尾部ID3标签与音频数据分开读取；不改写源文件或把标签送入音频链路。

DoP保留原始载荷，使用0x05/0xFA交替标记、同帧声道一致性、跨分段连续性及0x6969 idle填充。24位packed与32位valid-24容器均验证有效位；经过数值修改或不合法的PCM样本不能作为原始DoP接收。ASIO Float32 DoP明确拒绝。

DSF块边界由只读DSDIFF容器视图处理，最多缓存两个4096字节声道块；仅重排位序和容器，不修改原始音乐文件。

## 设置与检查

设置→音频→输出与设备中配置WASAPI/ASIO及DSD路线；界面音效归界面与交互，不混入原生音乐输出。

`核验DoP离线链路.cmd`及`scripts/check-dop-transport.mjs`提供合成封装和mock路由检查，不创建真实设备会话。按对应源码完成原生构建与指纹核对后运行，不复用失配的旧主机。

软件字节/路由检查不等于DAC接收、锁定指示、设备初始化、暂停切歌或长期稳定性。实际设备验证按独立任务授权开展，不能用旧PCM结果替代DSD/DoP验收。
