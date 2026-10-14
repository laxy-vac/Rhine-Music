import { trUi, ui } from "./i18n";
import type { MusicPlayerState } from "./music-player";
import { directDsd, isDsd, type NativeStatus, type NativeOutputSnapshot, type ProcessingStage } from "./native-audio";

export type AudioInfoCategory = "audio";
type AudioInfoViewMode = "all" | "actual";

export function isPlaybackBufferUnavailable(backend: string, mode: string, control?: string): boolean {
  return backend === "wasapi" && mode === "shared" || control === "system";
}

type NativeOutputView = NativeOutputSnapshot;

type AudioInfoCard = {
  category: AudioInfoCategory;
  target: string;
  value: string;
  detail: string;
};

export type AudioSignalSummary = {
  source: Pick<AudioInfoCard, "value" | "detail">;
  decoder: Pick<AudioInfoCard, "value" | "detail">;
  dsp: Pick<AudioInfoCard, "value" | "detail">;
  volume: Pick<AudioInfoCard, "value" | "detail">;
  output: Pick<AudioInfoCard, "value" | "detail">;
  device: Pick<AudioInfoCard, "value" | "detail">;
};

const audioInfoViewStorageKey = "rhine-audio-info-view";

function readAudioInfoView(): AudioInfoViewMode {
  try {
    return localStorage.getItem(audioInfoViewStorageKey) === "all" ? "all" : "actual";
  } catch {
    return "actual";
  }
}

function writeAudioInfoView(mode: AudioInfoViewMode) {
  try {
    localStorage.setItem(audioInfoViewStorageKey, mode);
  } catch {
    // The view still works for this session when storage is unavailable.
  }
}

const hasValue = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

function tidyNumber(value: number, digits = 2): string {
  return value.toFixed(digits).replace(/\.?0+$/u, "");
}

function rateLabel(value: unknown, dsd = false): string | undefined {
  if (!hasValue(value)) return undefined;
  if (dsd && value >= 1_000_000) return `${tidyNumber(value / 1_000_000, 4)} MHz DSD`;
  if (value >= 1_000_000) return `${tidyNumber(value / 1_000_000, 3)} MHz`;
  if (value >= 1_000) return `${tidyNumber(value / 1_000, 3)} kHz`;
  return `${Math.round(value)} Hz`;
}

function rateConversionLabel(input: unknown, output: unknown): string {
  return `${rateLabel(input) ?? trUi("输入未读取")} → ${rateLabel(output) ?? trUi("输出未读取")}`;
}

function bitDepthLabel(storage: unknown, valid: unknown): string | undefined {
  const storageBits = typeof storage === "number" && Number.isInteger(storage) && storage > 0 ? storage : undefined;
  const validBits = typeof valid === "number" && Number.isInteger(valid) && valid > 0 ? valid : undefined;
  if (storageBits !== undefined && validBits !== undefined) {
    return ui`${validBits} 有效位 / ${storageBits} 位容器`;
  }
  if (storageBits !== undefined) return ui`${storageBits} 位容器`;
  if (validBits !== undefined) return ui`${validBits} 有效位`;
  return undefined;
}

function alignmentLabel(value: unknown): string | undefined {
  switch (value) {
    case "left": return trUi("左对齐");
    case "right": return trUi("右对齐");
    case "packed": return trUi("紧密打包");
    case "float": return trUi("浮点格式");
    case "dsd": return trUi("DSD 位流");
    default: return undefined;
  }
}

function formatValue(format: unknown, containerBits: unknown, validBits: unknown, fallback: string): string {
  const raw = typeof format === "string" ? format.trim() : '';
  const known:Record<string,string>={f32:trUi('32 位浮点'),float32:trUi('32 位浮点'),s16:trUi('16 位整数'),s24:trUi('24 位整数'),s32:trUi('32 位整数'),s32v16:trUi('16 位整数'),s32v18:trUi('18 位整数'),s32v20:trUi('20 位整数'),s32v24:trUi('24 位整数'),dop:trUi('DoP 位流'),'dsd-msb':trUi('DSD 位流')};
  const formatName = raw ? known[raw.toLowerCase()]??raw : undefined;
  const depth = bitDepthLabel(containerBits, validBits);
  return [formatName, depth].filter(Boolean).join(" · ") || fallback;
}

function hasCallbackTelemetry(output: NativeOutputView): boolean {
  return !!output.callbackFormat || output.callbackContainerBits !== undefined || output.callbackValidBits !== undefined ||
    output.callbackAlignment !== undefined || output.backendConversion !== undefined || output.bufferFrames !== undefined ||
    output.requestedBufferMs !== undefined || output.bufferControl !== undefined || output.bufferMs !== undefined ||
    output.realtime?.producerQueueFrames !== undefined || output.realtime?.underflows !== undefined || output.realtime?.callbackFailures !== undefined;
}

function callbackCard(output: NativeOutputView): AudioInfoCard {
  const details: string[] = [];
  const alignment = alignmentLabel(output.callbackAlignment);
  if (alignment) details.push(ui`对齐：${alignment}。`);
  if (output.sampleRate !== undefined) details.push(ui`回调采样率：${rateLabel(output.sampleRate, output.mode === "native") ?? trUi("暂无法读取")}。`);
  if (output.backendConversion !== undefined) details.push(ui`后端格式转换：${output.backendConversion ? trUi("已执行") : trUi("未发生")}。`);
  const control = output.bufferControl === "system" ? trUi("Windows 管理") : output.bufferControl === "driver" ? trUi("驱动管理") : output.bufferControl === "application" ? trUi("播放器管理") : undefined;
  if (control) details.push(ui`缓冲由${control}。`);
  if (output.bufferFrames !== undefined) details.push(ui`当前缓冲帧数：${output.bufferFrames.toLocaleString()}。`);
  if (output.requestedBufferMs !== undefined) details.push(ui`请求缓冲：${tidyNumber(output.requestedBufferMs)} ms。`);
  else if (output.bufferMs !== undefined) details.push(ui`原生回报缓冲时长：${tidyNumber(output.bufferMs)} ms。`);
  const realtime = output.realtime;
  if (realtime?.producerQueueFrames !== undefined) details.push(ui`生产队列：${realtime.producerQueueFrames.toLocaleString()} 帧。`);
  if (realtime?.underflows !== undefined) details.push(ui`欠载：${realtime.underflows.toLocaleString()} 次。`);
  if (realtime?.callbackFailures !== undefined) details.push(ui`回调失败：${realtime.callbackFailures.toLocaleString()} 次。`);
  return {
    category: "audio",
    target: "#output-backend",
    value: formatValue(output.callbackFormat, output.callbackContainerBits, output.callbackValidBits, trUi("回调格式暂无法读取")),
    detail: details.length ? details.join(" ") : trUi("播放器交给输出后端的回调格式。"),
  };
}

function hasDriverNativeTelemetry(output: NativeOutputView): boolean {
  return !!output.driverNativeFormat || output.driverNativeContainerBits !== undefined || output.driverNativeValidBits !== undefined || output.driverNativeAlignment !== undefined;
}

function driverNativeCard(output: NativeOutputView): AudioInfoCard {
  const details = [trUi("驱动回报的原生格式。")];
  const alignment = alignmentLabel(output.driverNativeAlignment);
  if (alignment) details.push(ui`对齐：${alignment}。`);
  return {
    category: "audio",
    target: "#output-backend",
    value: formatValue(output.driverNativeFormat, output.driverNativeContainerBits, output.driverNativeValidBits, trUi("驱动原生格式暂无法读取")),
    detail: details.join(" "),
  };
}

function wasapiDefaultChanged(state: MusicPlayerState, output: NativeOutputView | undefined, status: NativeStatus | undefined): boolean {
  if (state.outputSettings.wasapiDevice !== "default" || !output?.deviceId) return false;
  const currentDefault = status?.wasapiDevices?.find(item => item.isDefault)?.id;
  return !!currentDefault && currentDefault !== output.deviceId;
}

function sourceChannels(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return undefined;
  if (value === 1) return trUi("单声道");
  if (value === 2) return trUi("双声道");
  return ui`${value} 声道`;
}

/** A compact summary of file metadata only; it never uses a DSP or output rate. */
export function audioSourceSummary(state: MusicPlayerState): string {
  const track = state.currentTrack;
  if (!track) return trUi("暂无法读取音源参数");

  const values: string[] = [];
  const format = track.format?.trim();
  const codec = track.codec?.trim();
  const dsd = isDsd(track);
  if (format) values.push(format);
  if (codec && codec.toLocaleLowerCase() !== format?.toLocaleLowerCase()) values.push(codec);

  const rate = rateLabel(track.sampleRate, dsd);
  if (rate) values.push(rate);
  if (hasValue(track.bitsPerSample)) values.push(`${Math.round(track.bitsPerSample)} bit`);
  const channels = sourceChannels(track.numberOfChannels);
  if (channels) values.push(channels);
  if (typeof track.lossless === "boolean") values.push(track.lossless ? trUi("无损") : trUi("有损"));
  if (hasValue(track.bitrate)) values.push(`${Math.round(track.bitrate / 1_000)} kb/s`);

  return values.length ? values.join(" · ") : trUi("暂无法读取音源参数");
}

function nativeOutput(state: MusicPlayerState): NativeOutputView | undefined {
  return ["playing", "paused"].includes(state.transport) ? state.nativeOutputStatus : undefined;
}

function routeLabel(value: unknown): string {
  if (value === "asio") return "ASIO";
  if (value === "wasapi") return "WASAPI";
  return trUi("浏览器");
}

function requestedSony(state: MusicPlayerState): boolean {
  return (
    state.sonySettings.dsee ||
    state.sonySettings.dc > 0 ||
    state.sonySettings.vinyl > 0
  );
}

function effectNames(value: { dsee?: boolean; dc?: number; vinyl?: number }): string[] {
  const names: string[] = [];
  if (value.dsee) names.push("DSEE AI");
  if (value.dc && value.dc > 0) names.push(`DC ${value.dc}`);
  if (value.vinyl && value.vinyl > 0) names.push(ui`黑胶 ${value.vinyl}`);
  return names;
}

/** Keep diagnostics, while routine skipped-effect reports are expressed by the chain. */
export function audioProcessingText(message?: string, failed = false): string {
  if (!message) return "";
  if (!/(?:旁路|\bbypass(?:ed)?\b)/iu.test(message)) return message;
  if (!failed) return "";
  return message.replace(/(?:已|自动)?旁路/gu, trUi("跳过处理")).replace(/\bbypass(?:ed)?\b/giu, trUi("跳过处理"));
}

function transportLabel(state: MusicPlayerState): string {
  if (state.loading || state.transport === "loading") return trUi("准备中");
  if (state.transport === "playing" || state.playing) return trUi("播放中");
  if (state.transport === "paused") return trUi("已暂停");
  if (state.transport === "error") return trUi("播放失败");
  return trUi("待播放");
}

function sourceCard(state: MusicPlayerState): AudioInfoCard {
  const track = state.currentTrack;
  const fields = track
    ? [track.sampleRate, track.bitsPerSample, track.numberOfChannels].some(hasValue)
    : false;
  return {
    category: "audio",
    target: "#current-audio-settings",
    value: audioSourceSummary(state),
    detail: fields
      ? trUi("歌曲文件的格式与音质信息。")
      : trUi("曲目信息不完整；暂无法读取的参数不会估算。"),
  };
}

function conversionCard(
  state: MusicPlayerState,
  output: NativeOutputView | undefined,
): AudioInfoCard {
  const track = state.currentTrack;
  const dsd = !!track && isDsd(track);
  const processing = state.sonyProcessing;
  let value: string;
  let detail: string;

  if (!dsd) {
    if (output?.mode === "pcm") {
      value = output.decoderName ? ui`${output.decoderName} · PCM 解码` : trUi("PCM 输出路径");
      detail = output.decoderName ? ui`解码样本 ${precisionLabel(output.decodedSampleFormat)} · 适配输出 ${precisionLabel(output.decoderOutputPrecision)}` : trUi("当前以 PCM 格式输出；音源参数见“音源”。");
    } else if (state.backend === "browser") {
      value = trUi("浏览器解码");
      detail = trUi("由浏览器解码；输出格式和采样率暂无法读取。");
    } else {
      value = trUi("PCM 播放路线");
      detail = trUi("已选择 PCM 播放路线；播放后显示实际输出格式和采样率。");
    }
  } else if (output?.mode === "native") {
    value = trUi("DSD 直出");
    detail = trUi("当前以 DSD 格式输出，未转换成 PCM。");
  } else if (output?.mode === "dop") {
    value = "DSD → DoP";
    detail = trUi("DSD 数据通过 DoP 传输，音乐内容仍为 DSD。");
  } else if (output?.mode === "pcm") {
    value = "DSD → PCM";
    detail = trUi("DSD 已转换为 PCM；处理后的采样率见“信号处理”。");
  } else if (directDsd(track!, state.outputSettings)) {
    value = trUi("已选择 DSD 直出");
    detail = trUi("播放后显示实际输出模式。");
  } else if (processing.state === "preparing") {
    value = trUi("正在准备 DSD 转 PCM");
    detail = audioProcessingText(processing.message) || trUi("正在准备 DSD 解码；处理后格式暂无法读取。");
  } else if (processing.state === "error") {
    value = trUi("DSD 转换失败");
    detail = audioProcessingText(processing.message, true) || trUi("暂无法读取转换结果。");
  } else {
    value = "DSD → PCM";
    detail = trUi("此播放路线会将 DSD 解码为 PCM；处理后的采样率单独显示。");
  }

  return {
    category: "audio",
    target: dsd ? state.backend === "asio" ? "#output-dsd" : state.backend === "wasapi" ? "#output-wasapi-dsd" : "#decoder-settings" : "#decoder-settings",
    value,
    detail,
  };
}

function processingCard(
  state: MusicPlayerState,
  output: NativeOutputView | undefined,
): AudioInfoCard {
  const processing = state.sonyProcessing;
  let value = trUi("暂无法读取处理状态");
  let detail = trUi("播放后显示实际处理状态。");
  const nativeStages=output?.processingStages?.filter(stage=>stage.active&&!/decode|volume|quant|output/i.test(stage.id));
  if(nativeStages?.length)return {category:"audio",target:"#music-eq-page",value:nativeStages.map(audioStageName).join(" · "),detail:nativeStages.map(stage=>[audioStageName(stage),precisionDetails(stage)].filter(Boolean).join(' · ')).join("；")};

  if (output?.mode === "native" || output?.mode === "dop") {
    value = trUi("DSP 未运行");
    detail = trUi("当前为 DSD 直出，暂不经过信号处理。");
  } else if (
    !output?.mode &&
    state.currentTrack &&
    directDsd(state.currentTrack, state.outputSettings)
  ) {
    value = trUi("已选择 DSD 直出");
    detail = trUi("播放后显示实际处理状态。");
  } else if (processing.state === "preparing") {
    value = trUi("信号处理准备中");
    detail = audioProcessingText(processing.message) || trUi("正在准备处理结果。");
  } else if (processing.state === "error") {
    value = trUi("信号处理失败");
    detail = audioProcessingText(processing.message, true) || trUi("暂无法读取处理结果。");
  } else if (processing.effectiveSettings) {
    const active = effectNames(processing.effectiveSettings);
    value = active.length ? active.join(" · ") : trUi("本曲未启用 DSP");
    const details = [trUi("在解码后、播放器音量和输出前进行处理。")];
    const message = audioProcessingText(processing.message);
    if (message) details.push(message);
    if (active.length && hasValue(processing.sampleRate)) {
      details.push(ui`处理后 PCM ${rateLabel(processing.sampleRate)}`);
    }
    detail = details.join(" ");
  } else if (processing.state === "active") {
    value = trUi("信号处理中");
    detail = trUi("暂无法读取本曲实际生效的处理项。");
  } else if (processing.state === "off") {
    value = requestedSony(state) ? trUi("已配置，当前未运行") : trUi("当前未运行");
    detail = trUi("音效仅用于支持的音源格式。");
  }

  return {
    category: "audio",
    target: "#sony-settings",
    value,
    detail,
  };
}

function volumeCard(
  state: MusicPlayerState,
  output: NativeOutputView | undefined,
): AudioInfoCard {
  const percent = Math.round(Math.max(0, Math.min(1, state.volume)) * 100);
  let value: string;
  let detail: string;

  if (output?.volumeLocked === true) {
    value = trUi("播放器数字音量已锁定");
    detail = trUi("播放器音量不可调，请使用 DAC 或设备音量。");
  } else if (output?.volumeLocked === false) {
    value = ui`播放器音量 ${percent}%`;
    detail = trUi("播放器数字音量可调。");
  } else if (state.backend === "browser") {
    value = ui`播放器音量 ${percent}%`;
    detail = trUi("这是播放器音量；设备主音量暂无法读取。");
  } else if (
    state.currentTrack &&
    directDsd(state.currentTrack, state.outputSettings)
  ) {
    value = trUi("DSD 直出音量锁定待确认");
    detail = trUi("已选择 DSD 直出；播放后显示音量是否锁定。");
  } else {
    value = ui`播放器音量 ${percent}%`;
    detail = trUi("已设置播放器音量；锁定状态暂无法读取。");
  }

  return {
    category: "audio",
    target: "#volume",
    value,
    detail,
  };
}

export function audioSonySummary(state: MusicPlayerState): Pick<AudioInfoCard, "value" | "detail"> {
  return summaryItem(processingCard(state, undefined));
}

function backendCard(
  state: MusicPlayerState,
  output: NativeOutputView | undefined,
): AudioInfoCard {
  if (!output?.backend) {
    const backend = routeLabel(state.backend);
    const selectedMode = state.outputSettings.wasapiMode === "exclusive" ? trUi("独占") : trUi("共享");
    return {
      category: "audio",
      target: "#output-backend",
      value: state.backend === "browser" ? backend : ui`已选择 ${backend}`,
      detail: state.backend === "browser"
        ? trUi("浏览器播放；设备输出格式暂无法读取。")
        : state.backend === "wasapi"
          ? ui`已选择 WASAPI ${selectedMode}模式；播放后显示实际输出模式。`
          : trUi("已选择此播放方式；播放后显示实际状态。"),
    };
  }

  let detail: string;
  let value = routeLabel(output.backend);
  if (output.backend === "asio") {
    const rate = rateLabel(output.sampleRate, output.mode === "native");
    if (output.mode === "dop") value = "ASIO · DoP（DSD）";
    detail = rate
      ? output.mode === "native"
        ? ui`DSD 输出速率：${rate}。`
        : ui`输出流率：${rate}。`
      : trUi("输出采样率暂无法读取。");
    if (output.mode === "dop") detail = ui`${hasValue(output.dsdRate) ? ui`DSD 音源：${rateLabel(output.dsdRate, true)}。` : trUi("DSD 音源经 DoP 封装。")}${rate ? ui`DoP 传输帧率：${rate}。` : trUi("DoP 传输帧率暂无法读取。")}PCM 传输帧承载 DSD 数据，音乐内容仍为 DSD。`;
  } else {
    const selectedMode = state.outputSettings.wasapiMode === "exclusive" ? trUi("独占") : trUi("共享");
    const confirmedMode = output.wasapiMode;
    if (confirmedMode) value = `WASAPI · ${confirmedMode === "exclusive" ? trUi("独占") : trUi("共享")}${output.mode === "dop" ? " · DoP（DSD）" : ""}`;
    const details = [
      confirmedMode
        ? ui`当前以 WASAPI ${confirmedMode === "exclusive" ? trUi("独占") : trUi("共享")}模式输出。`
        : ui`已选择 WASAPI ${selectedMode}模式；播放后显示实际模式。`,
    ];
    const clientRate = rateLabel(output.sampleRate);
    if (output.mode === "dop") {
      details.push(hasValue(output.dsdRate) ? ui`DSD 音源：${rateLabel(output.dsdRate, true)}。` : trUi("DSD 音源经 DoP 封装。"));
      details.push(clientRate ? ui`DoP 传输帧率：${clientRate}。` : trUi("DoP 传输帧率暂无法读取。"));
      details.push(trUi("音乐保持 DSD，PCM 格式仅用于传输。"));
    } else details.push(clientRate ? ui`播放流采样率：${clientRate}。` : trUi("播放流采样率暂不可用。"));
    const clientBits = output.sampleFormat === "float" && hasValue(output.bitsPerSample)
      ? ui`${Math.round(output.bitsPerSample)} bit 浮点` : bitDepthLabel(output.bitsPerSample, output.validBitsPerSample);
    if (clientBits) details.push(`${output.mode === "dop" ? trUi("DoP 传输容器") : trUi("播放流位深")}：${clientBits}。`);
    if (confirmedMode === "shared") details.push(trUi("此处为播放器提交格式；之后经过 Windows 共享混音。"));
    detail = details.join(" ");
  }

  return {
    category: "audio",
    target: "#output-backend",
    value,
    detail,
  };
}

function deviceCard(
  state: MusicPlayerState,
  output: NativeOutputView | undefined,
  status: NativeStatus | undefined,
): AudioInfoCard {
  const backend = output?.backend ?? state.backend;
  if (backend === "asio") {
    const id = state.outputSettings.device;
    const device = status?.available
      ? status.devices.find((item) => item.id === id)
      : undefined;
    return {
      category: "audio",
      target: "#output-device",
      value: device?.name ?? (id >= 0 ? trUi("已选 ASIO 驱动") : trUi("请选择 ASIO 驱动")),
      detail: device
        ? trUi("已选择的 ASIO 驱动。")
        : trUi("驱动名称暂不可用，请刷新设备列表。"),
    };
  }
  if (backend === "wasapi") {
    const sessionName = output?.deviceName?.trim();
    const sessionId = output?.deviceId?.trim();
    if (sessionName || sessionId) {
      return {
        category: "audio",
        target: "#output-wasapi-device",
        value: sessionName || trUi("WASAPI 输出设备"),
        detail: wasapiDefaultChanged(state, output, status)
          ? trUi("Windows 默认播放设备已变化；当前歌曲仍使用打开时的设备。重新打开歌曲后应用新默认设备。")
          : trUi("当前播放使用的 Windows 输出设备。选择系统默认设备时，会在打开歌曲时解析；之后默认设备变化需重新打开歌曲。"),
      };
    }

    const selectedId = state.outputSettings.wasapiDevice || "default";
    const listedDevices = status?.available ? status.wasapiDevices ?? [] : [];
    const selectedDevice = selectedId === "default"
      ? listedDevices.find((item) => item.isDefault)
      : listedDevices.find((item) => item.id === selectedId);
    const selectedName = selectedDevice?.name.trim();
    const isDefault = selectedId === "default" || selectedDevice?.isDefault === true;
    return {
      category: "audio",
      target: "#output-wasapi-device",
      value: selectedId === "default"
        ? selectedName ? ui`已选择 ${selectedName}（系统默认）` : trUi("已选择系统默认设备")
        : ui`已选择 ${selectedName || trUi("WASAPI 设备")}${isDefault ? trUi("（系统默认）") : ""}`,
      detail: selectedName
        ? ui`${selectedId === "default" ? trUi("系统默认设备会在打开歌曲时解析；默认设备变化后需重新打开歌曲。") : isDefault ? trUi("已选设备当前也是 Windows 默认播放设备。") : trUi("已选择的播放设备。")}播放后显示正在使用的设备。`
        : selectedId === "default"
          ? trUi("系统默认设备会在打开歌曲时解析；默认设备变化后需重新打开歌曲。当前设备名称暂不可用。")
          : trUi("设备名称暂不可用，请刷新设备列表。"),
    };
  }
  return {
    category: "audio",
    target: "#device-placeholder",
    value: trUi("浏览器输出设备"),
    detail: trUi("浏览器未提供设备名称或硬件状态。"),
  };
}

function summaryItem(card: AudioInfoCard): Pick<AudioInfoCard, "value" | "detail"> {
  return { value: card.value, detail: card.detail };
}

function precisionLabel(value:unknown):string{
  const name=String(value??'unknown').toLowerCase();
  if(['float64','f64','64','double','dbl','dblp'].includes(name))return trUi('64 位浮点');
  if(['float32','f32','32','float','flt','fltp'].includes(name))return trUi('32 位浮点');
  if(name==='mixed')return trUi('混合精度');
  if(name==='dsd'||name==='bitstream')return trUi('DSD 位流');
  if(name==='integer'||name==='int')return trUi('整数');
  if(/^pcm\d+$/.test(name))return ui`${name.slice(3)} 位整数`;
  if(/^int\d+$/.test(name))return ui`${name.slice(3)} 位整数`;
  const integer=/^s(\d+)(?:v(\d+))?p?$/.exec(name);
  if(integer)return integer[2]?ui`${integer[2]} 位整数（${integer[1]} 位容器）`:ui`${integer[1]} 位整数`;
  return trUi('未报告');
}
function knownPrecision(value:unknown):string|undefined{
  const label=precisionLabel(value);return label===trUi('未报告')?undefined:label;
}
function precisionDetails(stage:ProcessingStage):string{
  return ([[trUi('输入'),stage.inputPrecision],[trUi('运算'),stage.computePrecision],[trUi('输出'),stage.outputPrecision]] as const)
    .flatMap(([label,value])=>{const precision=knownPrecision(value);return precision?[`${label} · ${precision}`]:[];}).join('；');
}

export function pcmConsistencyCode(output?:NativeOutputSnapshot):'pending'|'match'|'mismatch'{
  if((output?.bitPerfectMismatchSamples??0)>0)return 'mismatch';
  return output?.capabilities?.bitPerfectActive&&
    (output.bitPerfectCheckedSamples??0)>0&&output.bitPerfectMismatchSamples===0?'match':'pending';
}
export function pcmConsistencyStatus(output?:NativeOutputSnapshot):string{
  const code=pcmConsistencyCode(output);
  return code==='mismatch'?trUi('不一致'):code==='match'?trUi('一致'):trUi('等待校验');
}

/** Actual stage data only; explanatory text belongs in the expandable note. */
export function audioPrecisionMarkup(state:MusicPlayerState|undefined,expanded=false):string{
  const output=state?nativeOutput(state):undefined;
  if(!output)return trUi('<p class="precision-empty">当前链路 · 未播放</p>');
  if(output.mode==='native'||output.mode==='dop')return ui`<p class="precision-empty">当前链路 · ${output.mode==='dop'?trUi('DoP 位流输出'):trUi('原生 DSD 输出')}</p>`;
  const direct=output.capabilities?.bitPerfectActive===true;
  const sourceRate=rateLabel(output.sourceSampleRate)??'—',targetRate=rateLabel(output.sampleRate)??'—';
  const format=output.bitsPerSample?ui`${output.validBitsPerSample??output.bitsPerSample} 位${output.sampleFormat==='float'?trUi('浮点'):trUi('整数')}${output.validBitsPerSample&&output.validBitsPerSample!==output.bitsPerSample?ui`（${output.bitsPerSample} 位容器）`:''}`:'—';
  const stages=aggregateStages(output.processingStages??[]);
  const showCompute=!direct&&stages.some(stage=>stage.active&&stage.id!=='decode'&&knownPrecision(stage.computePrecision));
  const row=(name:string,input:string,compute:string,result:string)=>`<tr><th scope="row">${safeMarkup(name)}</th><td>${safeMarkup(input)}</td>${showCompute?`<td>${safeMarkup(compute)}</td>`:''}<td>${safeMarkup(result)}</td></tr>`;
  const decode=stages.find(stage=>stage.id==='decode');
  const decoded=precisionLabel(output.decodedSampleFormat??decode?.inputPrecision);
  const active=direct
    ?row(output.decoderName??trUi('解码'), trUi('音乐文件'),'—',decoded)+row(trUi('格式打包'),decoded,'—',format)
    :stages.filter(stage=>stage.active).map(stage=>row(audioStageName(stage),stage.id==='decode'?trUi('音乐文件'):precisionLabel(stage.inputPrecision),stage.id==='decode'?'':knownPrecision(stage.computePrecision)??'',precisionLabel(stage.outputPrecision))).join('');
  const inactive=stages.filter(stage=>!stage.active&&!['decode','float64'].includes(stage.id));
  return ui`<div class="precision-metrics"><div><span>播放模式</span><strong>${direct?trUi('解码直通'):trUi('声音处理')}</strong></div><div><span>采样率</span><strong>${sourceRate===targetRate?sourceRate:`${sourceRate} → ${targetRate}`}</strong></div><div><span>提交格式</span><strong>${safeMarkup(format)}</strong></div></div>
    ${direct?trUi('<p class="precision-route">解码 <span>→</span> 格式打包 <span>→</span> 输出接口</p>'):''}
    <div class="precision-table-scroll"><table class="precision-table"><caption>实际链路</caption><thead><tr><th>环节</th><th>输入格式</th>${showCompute?trUi('<th>运算精度</th>'):''}<th>输出格式</th></tr></thead><tbody>${active||row(trUi('链路'),'—','',trUi('未报告'))}</tbody></table></div>
    ${!direct&&inactive.length?ui`<details class="precision-inactive" ${expanded?'open':''}><summary>未启用 · ${inactive.length} 项</summary><div>${inactive.map(stage=>`<span>${safeMarkup(audioStageName(stage))}</span>`).join('')}</div></details>`:''}`;
}
function stageTarget(id:string):string{
  if(/tone/i.test(id))return '#audio-settings-tone';
  if(/eq|equal/i.test(id))return '#music-eq-page';
  if(/replay|gain/i.test(id))return '#audio-settings-replaygain';
  if(/resampl|src/i.test(id))return '#audio-settings-resampling';
  if(/mix|fade|queue|transition/i.test(id))return '#audio-settings-transition';
  if(/volume/i.test(id))return '#volume';
  if(/quant|dither|output/i.test(id))return '#output-backend';
  return '#audio-settings-precision';
}
export type AudioInfoRow={label:string;value:string};
export type AudioChainNode=AudioInfoCard & {id:string;title:string;active:boolean;rows?:AudioInfoRow[]};
const stageNames:Record<string,string>={decode:trUi('解码'),float64:trUi('缓冲格式'),eq:trUi('均衡器'),tone:trUi('音调'),replaygain:trUi('播放增益'),resample:trUi('重采样'),mix:trUi('切歌混音'),volume:trUi('数字音量'),quantize:trUi('输出格式')};
export function audioStageName(stage:ProcessingStage):string{return stageNames[stage.id]??(/[㐀-鿿]/u.test(stage.name)?stage.name:trUi('其他处理'))}
function readableStageReason(reason:string|undefined):string|undefined{
  if(!reason)return undefined;
  const names:Record<string,string>={'identity':trUi('零增益'),'eq-disabled':trUi('已关闭'),'tone-disabled':trUi('已关闭'),'disabled':trUi('已关闭'),'bit-perfect':trUi('纯输出'),'no-replaygain-tags':trUi('无增益标签')};
  return names[reason.toLowerCase()]??(/[㐀-鿿]/u.test(reason)?reason:undefined);
}
function aggregateStages(stages:ProcessingStage[]):ProcessingStage[]{
  const result:ProcessingStage[]=[],groups=new Map<string,ProcessingStage[]>();
  for(const stage of stages){
    const family=/^eq[.]/.test(stage.id)?'eq':/^tone[.]/.test(stage.id)?'tone':stage.id;
    const group=groups.get(family);
    if(group){group.push(stage);continue}
    groups.set(family,[stage]);result.push({...stage,id:family,name:stageNames[family]??stage.name});
  }
  for(const merged of result){
    const group=groups.get(merged.id)!;if(group.length===1)continue;
    const active=group.filter(stage=>stage.active);merged.active=active.length>0;
    const used=active.length?active:group;
    for(const field of ['inputPrecision','computePrecision','outputPrecision'] as const){
      const values=[...new Set(used.map(stage=>stage[field]))];merged[field]=values.length===1?values[0]:values.some(value=>!value||value==='unknown')?'unknown':'mixed';
    }
    merged.reason=active.length?ui`${active.length} 个活动环节`:trUi('当前未应用增益或滤波');
  }
  return result;
}
function stageNode(stage:ProcessingStage,output?:NativeOutputView):AudioChainNode{
  const node:AudioChainNode = {id:stage.id,title:audioStageName(stage),category:'audio',target:stageTarget(stage.id),active:stage.active,
    value:stage.active?knownPrecision(stage.computePrecision)??trUi('已启用'):trUi('未启用'),
    detail:stage.active?precisionDetails(stage):readableStageReason(stage.reason)||trUi('未启用')};
  if (stage.id === 'resample') {
    node.title = trUi('输出重采样');
    node.value = rateConversionLabel(output?.sourceSampleRate, output?.sampleRate);
    node.detail = stage.active
      ? `${precisionDetails(stage)}。${stage.reason?.includes('SoXr') ? `SoX / libsoxr · ${stage.soxrQuality === 'hq' ? 'HQ' : 'VHQ'}${stage.soxrPassband ? ui` · 通带 ${tidyNumber(stage.soxrPassband * 100)}%` : ''}。` : stage.reason?.includes('r8brain') ? trUi('r8brain 高精度重采样。') : stage.reason?.includes('Linear') ? trUi('线性插值快速重采样。') : ''}`
      : hasValue(output?.sourceSampleRate)&&hasValue(output?.sampleRate)&&output.sourceSampleRate===output.sampleRate
        ? trUi('输入与提交采样率相同，未进行采样率转换。') : trUi('重采样未运行；完整采样率暂未读取。');
  }
  return node;
}
/** Source metadata, actual arithmetic precision and endpoint format remain separate. */
export function audioChainNodes(state:MusicPlayerState,status?:NativeStatus):AudioChainNode[]{
  const output=nativeOutput(state),track=state.currentTrack,nodes:AudioChainNode[]=[];
  const dsd=!!track&&isDsd(track),raw=output?.mode==='native'||output?.mode==='dop';
  const pure=output?.capabilities?.bitPerfectActive===true;
  const prepared=!raw&&typeof state.sonyProcessing.streaming==='boolean';
  const stages=output?.processingStages??[];
  const rows=():AudioInfoRow[]=>[];
  const addRow=(list:AudioInfoRow[],label:string,value:string|undefined)=>{if(value)list.push({label,value})};
  const add=(id:string,title:string,value:string,list:AudioInfoRow[],target:string,active=true)=>nodes.push({id,title,value,rows:list,detail:list.map(row=>`${row.label} · ${row.value}`).join('；'),category:'audio',target,active});
  const db=(value:number)=>`${value>0?'+':''}${value.toFixed(1)} dB`;
  const sampleFormat=(bits:number|undefined,valid:number|undefined,floating:boolean)=>hasValue(bits)?ui`${floating?bits:hasValue(valid)?valid:bits} 位${floating?trUi('浮点'):trUi('整数')}`:undefined;

  const sourceRows=rows();
  addRow(sourceRows,trUi('采样率'),rateLabel(track?.sampleRate,dsd));
  addRow(sourceRows,trUi('位深'),hasValue(track?.bitsPerSample)?ui`${track.bitsPerSample} 位`:undefined);
  addRow(sourceRows,trUi('声道'),sourceChannels(track?.numberOfChannels));
  addRow(sourceRows,trUi('码率'),hasValue(track?.bitrate)?`${Math.round(track.bitrate/1000).toLocaleString()} kb/s`:undefined);
  addRow(sourceRows,trUi('类型'),typeof track?.lossless==='boolean'?track.lossless?trUi('无损'):trUi('有损'):undefined);
  add('source',trUi('音轨'),track?.codec?.trim()||track?.format?.trim()||trUi('未选择音轨'),sourceRows,'#current-audio-settings');

  const decodeRows=rows();
  const decode=stages.find(stage=>stage.id==='decode');
  const decoderName=prepared?state.sonyProcessing.sourceDecoder:output?.decoderName;
  const decoderValue=decoderName||(dsd&&output?.mode?prepared?trUi('DSD 解码'):'BASSDSD':state.backend==='browser'?trUi('浏览器解码'):output?trUi('解码器'):trUi('等待播放'));
  addRow(decodeRows,trUi('解码结果'),raw?trUi('DSD 位流'):output?.mode==='pcm'?'PCM':undefined);
  addRow(decodeRows,trUi('播放路线'),output?.mode==='dop'?trUi('DoP 封装'):output?.mode==='native'?trUi('原生 DSD'):dsd&&output?.mode==='pcm'?'DSD → PCM':pure?trUi('解码直通'):undefined);
  addRow(decodeRows,trUi('采样率'),raw?rateLabel(output?.dsdRate??track?.sampleRate,true):rateLabel(prepared?state.sonyProcessing.inputSampleRate:output?.sourceSampleRate));
  addRow(decodeRows,trUi('样本格式'),raw?undefined:prepared?trUi('32 位浮点'):knownPrecision(output?.decodedSampleFormat??decode?.inputPrecision));
  add('decoder',trUi('解码器'),decoderValue,decodeRows,dsd?'#dsd-route-settings':'#decoder-settings');

  const dspRows=rows(),effects=stages.filter(stage=>stage.active&&!/^(decode|float64|quantize|volume)$/.test(stage.id));
  const sony=!raw&&!pure&&state.sonyProcessing.state==='active'?state.sonyProcessing.effectiveSettings:undefined;
  const sonyActive=!raw&&!pure&&state.sonyProcessing.state==='active'&&(!sony||sony.dsee||sony.dc>0||sony.vinyl>0);
  const processingActive=!raw&&!pure&&(effects.length>0||sonyActive);
  const compute=[...new Set(effects.map(stage=>knownPrecision(stage.computePrecision)).filter((value):value is string=>!!value))];
  const dspValue=raw?trUi('DSD 位流'):pure?trUi('解码直通'):sonyActive?compute.length?trUi('声音增强 + 浮点处理'):trUi('声音增强'):compute.join(' / ')||(processingActive?trUi('已启用'):trUi('无声音处理'));
  if(processingActive)addRow(dspRows,trUi('采样率'),rateLabel(output?.dspSampleRate??output?.sourceSampleRate));
  if(sonyActive&&compute.length)addRow(dspRows,trUi('后级运算'),compute.join(' / '));
  if(sony?.dsee)addRow(dspRows,'DSEE AI',hasValue(state.sonyProcessing.inputSampleRate)&&hasValue(state.sonyProcessing.sampleRate)?`${rateLabel(state.sonyProcessing.inputSampleRate)} → ${rateLabel(state.sonyProcessing.sampleRate)}`:trUi('已启用'));
  if(sony?.dc)addRow(dspRows,trUi('DC 相位'),[trUi('关闭'),trUi('A 型 · 低'),trUi('A 型 · 标准'),trUi('A 型 · 高'),trUi('B 型 · 低'),trUi('B 型 · 标准'),trUi('B 型 · 高')][sony.dc]);
  if(sony?.vinyl)addRow(dspRows,trUi('黑胶处理'),[trUi('关闭'),trUi('标准'),trUi('唱臂共振'),trUi('转盘'),trUi('表面噪声')][sony.vinyl]);
  const eq=effects.find(stage=>stage.id==='eq');
  const eqFilters=Array.isArray(eq?.filters)?eq.filters:effects.filter(stage=>stage.id.startsWith('eq.'));
  const eqBands=eqFilters.filter(stage=>stage.id.startsWith('eq.band.')||stage.id.startsWith('eq.lsp.band.'));
  if(eq||eqFilters.length){
    addRow(dspRows,trUi('均衡器'),eqBands.length?ui`${eqBands.length} 段 · ${eqBands.filter(stage=>stage.active).length} 段生效`:trUi('已启用'));
    const preamp=eqFilters.find(stage=>stage.id==='eq.preamp');if(preamp&&Number.isFinite(preamp.gainDb))addRow(dspRows,trUi('均衡器前级'),db(preamp.gainDb!));
    if(eq?.engine==='lsp') {
      addRow(dspRows,trUi('均衡器引擎'),'LSP Parametric Equalizer');
      if(eq.routing)addRow(dspRows,trUi('声道处理'),eq.routing==='ms'?'M/S':'L/R');
      if(Number.isFinite(eq.gainDb))addRow(dspRows,trUi('均衡器前级'),db(eq.gainDb!));
      if(Number.isFinite(eq.outputGainDb))addRow(dspRows,trUi('均衡器输出'),db(eq.outputGainDb!));
      if(Number.isFinite(eq.latencyFrames)&&hasValue(eq.sampleRate))addRow(dspRows,trUi('均衡器延迟'),`${tidyNumber(eq.latencyFrames!*1000/eq.sampleRate!)} ms`);
    }
  }
  const tone=effects.find(stage=>stage.id==='tone');
  const toneFilters=Array.isArray(tone?.filters)?tone.filters:effects.filter(stage=>stage.id.startsWith('tone.'));
  for(const filter of toneFilters.filter(stage=>stage.active)){
    const values=[hasValue(filter.frequencyHz)?rateLabel(filter.frequencyHz):undefined,Number.isFinite(filter.gainDb)?db(filter.gainDb!):undefined];
    addRow(dspRows,filter.id.includes('bass')?trUi('低音'):trUi('高音'),values.filter(Boolean).join(' · ')||trUi('已启用'));
  }
  const rg=effects.find(stage=>stage.id==='replaygain');
  if(rg)addRow(dspRows,trUi('播放增益'),[Number.isFinite(rg.gainDb)?db(rg.gainDb!):trUi('已启用'),rg.source==='album'?trUi('专辑'):rg.source==='track'?trUi('单曲'):undefined].filter(Boolean).join(' · '));
  const src=effects.find(stage=>stage.id==='resample');
  if(src){
    addRow(dspRows,trUi('重采样'),hasValue(output?.sourceSampleRate)&&hasValue(output?.sampleRate)?`${rateLabel(output.sourceSampleRate)} → ${rateLabel(output.sampleRate)}`:undefined);
    addRow(dspRows,trUi('算法'),src.engine==='soxr'?`SoX · ${src.soxrQuality==='hq'?trUi('高质量'):trUi('极高质量')}`:src.engine==='r8brain'?'r8brain':src.engine==='fast'?trUi('线性插值'):undefined);
  }
  if(effects.some(stage=>stage.id==='mix'))addRow(dspRows,trUi('切歌'),trUi('交叉淡化中'));
  add('dsp',trUi('信号处理'),dspValue,dspRows,eq?'#music-eq-page':src?'#audio-settings-resampling':'#audio-settings-dsp',processingActive);

  const volumeRows=rows(),locked=raw||pure||output?.volumeLocked===true;
  const gain=Math.max(0,Math.min(1,state.volume));
  if(!locked){addRow(volumeRows,trUi('播放器音量'),`${Math.round(gain*100)}%`);addRow(volumeRows,trUi('数字增益'),gain>0?db(20*Math.log10(gain)):trUi('静音'));}
  else if(pure){addRow(volumeRows,trUi('播放器音量'),'100%');addRow(volumeRows,trUi('数字增益'),'0.0 dB');}
  add('volume',trUi('音量控制'),locked?trUi('设备调节'):trUi('数字音量'),volumeRows,'#volume',!locked);

  const outputRows=rows();
  const backend=output?.backend?`${routeLabel(output.backend)}${output.backend==='wasapi'&&output.wasapiMode?` · ${output.wasapiMode==='exclusive'?trUi('独占'):trUi('共享')}`:''}`:state.backend==='browser'?trUi('浏览器输出'):trUi('等待播放');
  addRow(outputRows,output?.mode==='dop'?trUi('DoP 帧率'):trUi('采样率'),rateLabel(output?.sampleRate,output?.mode==='native'));
  addRow(outputRows,output?.mode==='dop'?trUi('传输格式'):trUi('输出位深'),output?.mode==='native'?trUi('DSD · 1 位'):sampleFormat(output?.bitsPerSample,output?.validBitsPerSample,output?.sampleFormat==='float'||output?.outputFormat==='f32'));
  if(hasValue(output?.bitsPerSample)&&hasValue(output?.validBitsPerSample)&&output.bitsPerSample!==output.validBitsPerSample)addRow(outputRows,trUi('容器'),ui`${output.bitsPerSample} 位`);
  addRow(outputRows,trUi('声道'),sourceChannels(output?.channels));
  const dithers={none:trUi('关闭'),rectangular:trUi('矩形'),triangular:trUi('三角'),highpass:trUi('高通三角')};
  if(!raw)addRow(outputRows,trUi('抖动'),pure?trUi('停用'):output?.dither?dithers[output.dither]:undefined);
  if(output?.mode!=='native'&&hasValue(output?.bufferMs))addRow(outputRows,output.backend==='asio'?trUi('输出延迟'):trUi('缓冲'),`${tidyNumber(output.bufferMs)} ms`);
  if(pure||state.outputSettings.processing.bitPerfect)addRow(outputRows,trUi('比特一致性'),pcmConsistencyStatus(output));
  if(output?.overRangeSamples)addRow(outputRows,trUi('电平'),trUi('超过 0 dBFS'));
  if(output?.clippingSamples)addRow(outputRows,trUi('削波'),trUi('已发生'));
  add('output',trUi('输出'),backend,outputRows,'#output-backend');

  const deviceRows=rows();
  const deviceName=output?.deviceName||(output?.backend==='asio'?status?.devices.find(device=>device.id===state.outputSettings.device)?.name:undefined);
  if(output?.backend==='wasapi'){
    addRow(deviceRows,trUi('选择方式'),state.outputSettings.wasapiDevice==='default'?trUi('系统默认'):trUi('指定设备'));
    if(output.wasapiMode==='shared'){
      addRow(deviceRows,trUi('系统混音'),rateLabel(output.mixSampleRate));
      addRow(deviceRows,trUi('混音格式'),sampleFormat(output.mixBitsPerSample,undefined,output.mixSampleFormat==='float'));
    }
    if(wasapiDefaultChanged(state,output,status))addRow(deviceRows,trUi('默认设备'),trUi('已变化 · 重开后更新'));
  }
  add('device',trUi('输出设备'),deviceName||(state.backend==='browser'?trUi('系统默认设备'):trUi('设备名称未读取')),deviceRows,output?.backend==='asio'?'#output-device':'#output-wasapi-device');
  return nodes;
}

function safeMarkup(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))}

/** Current per-stage summary, using the same source and backend evidence as the popup. */
export function audioSignalSummary(
  state: MusicPlayerState,
  status?: NativeStatus,
): AudioSignalSummary {
  const output = nativeOutput(state);
  return {
    source: summaryItem(sourceCard(state)),
    decoder: summaryItem(conversionCard(state, output)),
    dsp: summaryItem(processingCard(state, output)),
    volume: summaryItem(volumeCard(state, output)),
    output: summaryItem(backendCard(state, output)),
    device: summaryItem(deviceCard(state, output, status)),
  };
}

function actualNodeVisibility(
  state: MusicPlayerState,
  output: NativeOutputView | undefined,
): boolean[] {
  const confirmedDsdBypass = output?.mode === "native" || output?.mode === "dop";
  const processing = state.sonyProcessing;
  const effective = processing.effectiveSettings;
  const dspActive =
    !confirmedDsdBypass &&
    processing.state === "active" &&
    (!effective || effectNames(effective).length > 0);

  return [
    true,
    true,
    dspActive,
    !(output?.volumeLocked === true || confirmedDsdBypass),
    true,
    true,
  ];
}

function cardMarkup(index: number, title: string, category: AudioInfoCategory, target: string): string {
  return ui`<button class="audio-info-card" type="button" data-audio-info-category="${category}" data-audio-info-target="${target}" aria-label="${title}，打开设置">
    <span class="audio-info-card-heading"><span class="audio-info-index">${String(index).padStart(2, "0")}</span><span class="audio-info-title">${title}</span></span>
    <strong class="audio-info-value" data-audio-info-value></strong>
    <span class="audio-info-rows" data-audio-info-rows></span>
    <span class="audio-info-card-hint" aria-hidden="true">设置 <span>↗</span></span>
  </button>`;
}

const popupMarkup = () => trUi(`
  <header class="audio-info-header">
    <div class="audio-info-heading-copy">
      <span class="audio-info-eyebrow">音乐信号链</span>
      <h2 id="music-audio-info-title">音频信息</h2>
      <p class="audio-info-track" data-audio-info-track>未选择曲目</p>
    </div>
    <div class="audio-info-view-controls" role="group" aria-label="音频信息显示方式">
      <button type="button" data-audio-info-view="actual" aria-pressed="false">实际链路</button>
      <button type="button" data-audio-info-view="all" aria-pressed="true">全部环节</button>
    </div>
    <span class="audio-info-transport" data-audio-info-transport>待播放</span>
    <button class="audio-info-close" type="button" data-audio-info-close aria-label="关闭音频信息" title="关闭">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </button>
  </header>
  <div class="audio-info-scroll" aria-label="音频信号链">
    <div class="audio-info-flow" role="group" aria-label="音频信号链设置入口"></div>
  </div>
  <footer class="audio-info-footer">
    <p class="audio-info-footnote" data-audio-info-footnote></p>
    <nav class="audio-info-placeholders" aria-label="音频设置">
      <button type="button" data-audio-info-category="audio" data-audio-info-target="#music-eq-page">均衡器 ↗</button>
      <button type="button" data-audio-info-category="audio" data-audio-info-target="#output-backend">输出设置 ↗</button>
      <button type="button" data-audio-info-category="audio" data-audio-info-target="#audio-settings-transition">切歌与淡变 ↗</button>
    </nav>
  </footer>`);

export function setupAudioInfoPopup(
  host: HTMLElement,
  callbacks: {
    navigate: (category: AudioInfoCategory, target: string) => void;
    refresh: () => void;
  },
) {
  const popup = document.createElement("div");
  popup.id = "music-audio-info";
  popup.className = "music-audio-info";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-modal", "false");
  popup.setAttribute("aria-labelledby", "music-audio-info-title");
  popup.hidden = true;
  popup.innerHTML = popupMarkup();
  host.append(popup);

  const trackLabel = popup.querySelector<HTMLElement>("[data-audio-info-track]")!;
  const transportLabel = popup.querySelector<HTMLElement>("[data-audio-info-transport]")!;
  const viewButtons = [...popup.querySelectorAll<HTMLButtonElement>("[data-audio-info-view]")];
  const footnote = popup.querySelector<HTMLElement>("[data-audio-info-footnote]")!;
  const flow = popup.querySelector<HTMLElement>(".audio-info-flow")!;
  let layoutSignature='';
  let latestState: MusicPlayerState | undefined;
  let deviceStatus: NativeStatus | undefined;
  let triggerElement: HTMLElement | undefined;
  let viewMode = readAudioInfoView();

  function setViewMode(mode: AudioInfoViewMode, persist = true) {
    viewMode = mode;
    for (const button of viewButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.audioInfoView === mode));
    }
    footnote.textContent = mode === "actual" ? trUi("实际链路") : trUi("全部环节");
    if (persist) writeAudioInfoView(mode);
    if (!popup.hidden) render(latestState, deviceStatus);
  }

  function render(state: MusicPlayerState | undefined, status: NativeStatus | undefined) {
    const track = state?.currentTrack;
    for (const button of viewButtons) button.disabled = !track;
    if (!state || !track) {
      layoutSignature = "";
      trackLabel.textContent = trUi("未选择曲目");
      transportLabel.textContent = trUi("待播放");
      flow.innerHTML = `<p class="audio-info-empty" role="status">${trUi("播放歌曲后，可查看实际音频链路。")}</p>`;
      footnote.textContent = trUi("尚无播放链路");
      return;
    }
    const output = nativeOutput(state);
    trackLabel.textContent = [track.artist, track.title].filter(Boolean).join(" · ");
    transportLabel.textContent = transportLabelFor(state);

    const views=audioChainNodes(state,status);
    const visibleNodes =
      views.map(view=>viewMode==='all'||view.active);
    const signature=JSON.stringify(views.map((view,index)=>[view.id,view.title,view.target,visibleNodes[index]]));
    if(signature!==layoutSignature){
      layoutSignature=signature;
      flow.innerHTML=views.map((view,index)=>`${index?'<span class="audio-info-connector" aria-hidden="true">→</span>':''}${cardMarkup(index+1,safeMarkup(view.title),view.category,view.target)}`).join('');
    }
    const cards=[...flow.querySelectorAll<HTMLButtonElement>('.audio-info-card')];
    const connectors=[...flow.querySelectorAll<HTMLElement>('.audio-info-connector')];

    views.forEach((view, index) => {
      const card = cards[index];
      if (!card) return;
      const visibleNumber = visibleNodes.slice(0, index + 1).filter(Boolean).length;
      const title = card.querySelector<HTMLElement>(".audio-info-title")!.textContent ?? "";
      const indexLabel = card.querySelector<HTMLElement>(".audio-info-index");
      card.hidden = !visibleNodes[index];
      if (indexLabel) indexLabel.textContent = String(visibleNumber).padStart(2, "0");
      const value = card.querySelector<HTMLElement>("[data-audio-info-value]")!;
      const rows = card.querySelector<HTMLElement>("[data-audio-info-rows]")!;
      value.textContent = view.value;
      const rowMarkup=(view.rows??[]).map(row=>`<span class="audio-info-row"><span class="audio-info-row-label">${safeMarkup(row.label)}</span><span class="audio-info-row-value">${safeMarkup(row.value)}</span></span>`).join('');
      if(rows.dataset.markup!==rowMarkup){rows.innerHTML=rowMarkup;rows.dataset.markup=rowMarkup;}
      card.dataset.active=String(view.active);
      card.dataset.audioInfoCategory = view.category;
      card.dataset.audioInfoTarget = view.target;
      card.setAttribute(
        "aria-label",
        String(visibleNumber).padStart(2, "0") + " " + title + ": " +
          view.value + ". " + view.detail + trUi(" 打开设置。"),
      );
    });
    connectors.forEach((connector, index) => {
      connector.hidden =
        !visibleNodes[index+1] || !visibleNodes.slice(0,index+1).some(Boolean);
    });
    footnote.textContent=ui`${viewMode==='actual'?trUi('实际链路'):trUi('全部环节')} · ${visibleNodes.filter(Boolean).length} 个环节`;
  }

  function close(restoreFocus = false) {
    popup.hidden = true;
    if (triggerElement) triggerElement.setAttribute("aria-expanded", "false");
    const restore = triggerElement;
    triggerElement = undefined;
    if (restoreFocus) restore?.focus({ preventScroll: true });
  }

  function toggle(trigger: HTMLElement) {
    if (!popup.hidden && triggerElement === trigger) {
      close(true);
      return;
    }
    if (!popup.hidden) close(false);
    triggerElement = trigger;
    trigger.setAttribute("aria-controls", popup.id);
    trigger.setAttribute("aria-expanded", "true");
    popup.hidden = false;
    render(latestState, deviceStatus);
    callbacks.refresh();
  }

  function update(state: MusicPlayerState, status?: NativeStatus) {
    latestState = state;
    if (status) deviceStatus = status;
    if (!popup.hidden) render(state, deviceStatus);
  }

  function onPopupClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const viewButton = target.closest<HTMLButtonElement>("button[data-audio-info-view]");
    if (viewButton && popup.contains(viewButton)) {
      const mode = viewButton.dataset.audioInfoView;
      if (mode === "actual" || mode === "all") setViewMode(mode);
      return;
    }
    const closeControl = target.closest<HTMLButtonElement>("[data-audio-info-close]");
    if (closeControl && popup.contains(closeControl)) {
      close(true);
      return;
    }
    const button = target.closest<HTMLButtonElement>(
      "button[data-audio-info-category][data-audio-info-target]",
    );
    if (!button || !popup.contains(button)) return;
    const category = button.dataset.audioInfoCategory;
    const route = button.dataset.audioInfoTarget;
    if (category === "audio" && route) {
      close(false);
      callbacks.navigate(category, route);
    }
  }

  function onDocumentClick(event: MouseEvent) {
    if (popup.hidden) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (popup.contains(target) || triggerElement?.contains(target)) return;
    close(false);
  }

  function onDocumentKeydown(event: KeyboardEvent) {
    if (popup.hidden || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }

  host.addEventListener("click", onPopupClick);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown, true);
  setViewMode(viewMode, false);

  return {
    toggle,
    close,
    update,
    get isOpen() {
      return !popup.hidden;
    },
  };
}

function transportLabelFor(state: MusicPlayerState): string {
  return transportLabel(state);
}
