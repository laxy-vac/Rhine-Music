export const knownIssuesText = `音频精度与输出

1. 解码器内部精度
FFmpeg、libFLAC 等解码器没有统一提供内部每一步运算的精度信息。界面只显示能够确认的解码样本格式和处理格式，不根据输出格式推断解码器内部精度。

2. Sony 音效
Sony 音效的输入、输出为 32 位浮点，部分内部运算可能使用定点或其他格式。64 位浮点优先不能将这些模块改为全程双精度。界面保留可确认的输入、输出格式，隐藏无法确认的内部精度。

3. 缓冲与处理精度
将样本存入 64 位浮点缓冲，不代表前面的解码或音效已经使用 64 位运算，也不能恢复此前丢失的信息。

4. 驱动与设备
界面显示播放器提交格式，以及 Windows 或驱动提供的格式信息；无法读取 DAC 内部处理。共享输出还会经过 Windows 混音。比特一致性校验比较解码样本与提交接口前的打包结果，不包含驱动和 DAC 内部。

5. LSP 原生均衡器
当前版本使用 32 位浮点处理，插件输入最高为 384 kHz。播放器不会将超出范围的输入静默截低；可改用入门均衡器或关闭 EQ。后级输出重采样仍可设置到 768 kHz。切换需要改变延迟的滤波算法时，播放器重新初始化当前播放位置。本地源码构建使用通用 DSP 核，未启用 SSE/AVX 优化；复杂设置的实时性能尚未验证。`;

const knownIssuesEnglish = `Audio precision and output

1. Decoder processing precision
FFmpeg, libFLAC and other decoders do not expose the precision of every internal operation through a common interface. The player displays confirmed decoded sample and processing formats. It does not infer internal decoder precision from the output format.

2. Sony effects
Sony effects accept and return 32-bit floating-point samples. Some internal operations may use fixed-point or other formats. Prefer 64-bit floating point cannot make these modules process entirely in double precision. Confirmed input and output formats are displayed; unconfirmed internal precision is omitted.

3. Buffers and processing precision
Storing samples in a 64-bit floating-point buffer does not mean earlier decoding or effects used 64-bit arithmetic, and cannot restore information already lost.

4. Drivers and devices
The player shows its submitted format and information supplied by Windows or the driver. DAC-internal processing is not exposed. Shared output also passes through the Windows mixer. Bit consistency compares decoded samples with the packed samples immediately before submission to the interface; it does not verify the driver or DAC internally.

5. LSP native equalizer
This version processes 32-bit floating-point audio and accepts input rates up to 384 kHz. Higher input rates are rejected rather than silently clamped; use the basic EQ or disable EQ for those sources. Output resampling can still reach 768 kHz. Algorithm changes that alter latency reinitialize playback at the current position. This local source build uses generic DSP kernels without SSE/AVX optimizations; realtime performance with complex settings is unverified.`;

export function getKnownIssuesText(language = 'zh-CN') {
  return language === 'en' ? knownIssuesEnglish : knownIssuesText;
}
