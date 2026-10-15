import { lspFilterCatalog } from "./lsp-eq-catalog.mjs";

const graphicFrequencies = [31, 62, 124, 249, 498, 996, 1995, 3993, 7993, 16000];
const bandColors = ["#8b9a9c", "#a58d84", "#9a9d81", "#8f91a2", "#9a8798", "#85999a", "#a2947c", "#8b91a0", "#9d8d80", "#879889"];
const defaultRates = [44100, 48000, 88200, 96000, 176400, 192000];
const outputFormats = ["auto", "s16", "s24", "s32", "s32v24", "f32"];
const dithers = ["none", "rectangular", "triangular", "highpass"];
const automaticTransitions = ["gapless", "crossfade", "none"];
const manualTransitions = ["none", "short", "crossfade"];

function defaultBands() {
  return graphicFrequencies.map((frequency, index) => ({
    type: 2,
    channels: 0,
    frequency,
    q: 0,
    gain: 0,
    color: bandColors[index],
    enabled: true,
  }));
}

function defaultLspBands() {
  return [100, 400, 1500, 6000].map((frequency, index) => ({
    filter: "rlc-bell-bt",
    frequency,
    frequency2: frequency * 2,
    q: 0.707,
    gain: 0,
    slope: 1,
    channels: 0,
    enabled: true,
    solo: false,
    locked: false,
    color: bandColors[index],
  }));
}

const defaultLspSettings = Object.freeze({
  algorithm: "iir",
  fftRank: 12,
  routing: "stereo",
  preamp: 0,
  output: 0,
  pluginState: "",
  bands: Object.freeze(defaultLspBands().map((band) => Object.freeze(band))),
});

const lspPluginStateMaxChars = 699_052;
const lspPluginStateMaxBytes = 512 * 1024;
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const canonicalBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const lspSettingsKeys = ["algorithm", "fftRank", "routing", "preamp", "output", "pluginState", "bands"];
const lspBandKeys = ["filter", "frequency", "frequency2", "q", "gain", "slope", "channels", "enabled", "solo", "locked", "color"];

function canonicalLspPluginState(value) {
  if (
    typeof value !== "string" ||
    value.length > lspPluginStateMaxChars ||
    value.length % 4 !== 0 ||
    !canonicalBase64Pattern.test(value)
  ) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if ((value.length / 4) * 3 - padding > lspPluginStateMaxBytes) return false;
  if (value.endsWith("==")) {
    const secondSextet = base64Alphabet.indexOf(value[value.length - 3]);
    return secondSextet >= 0 && (secondSextet & 15) === 0;
  }
  if (value.endsWith("=")) {
    const thirdSextet = base64Alphabet.indexOf(value[value.length - 2]);
    return thirdSextet >= 0 && (thirdSextet & 3) === 0;
  }
  return true;
}

function strictObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}格式无效。`);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) throw new TypeError(`${label}包含未知字段：${unknown.join("、")}。`);
  return value;
}

function lspFilterSpec(filter, label) {
  if (typeof filter !== "string") throw new TypeError(`${label}滤波器标识无效。`);
  const spec = lspFilterCatalog.find((item) => item?.id === filter);
  if (!spec || !Number.isInteger(spec.maxSlope) || spec.maxSlope < 1) {
    throw new TypeError(`${label}滤波器“${filter}”无效或未登记。`);
  }
  return spec;
}

function normalizeLspBand(value, index, clamp) {
  const label = `LSP 第 ${index + 1} 段`;
  const band = strictObject(value, lspBandKeys, label);
  const filter = band.filter === undefined ? "rlc-bell-bt" : band.filter;
  const spec = lspFilterSpec(filter, label);
  const color = band.color === undefined ? bandColors[index % bandColors.length] : band.color;
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) throw new TypeError(`${label}颜色无效。`);
  return {
    filter,
    frequency: finite(band.frequency, 1000, 10, 96000, `${label}频率（Hz）`, clamp),
    frequency2: finite(band.frequency2, 2000, 10, 96000, `${label}第二频率（Hz）`, clamp),
    q: finite(band.q, 0.707, spec.minQ, 100, `${label} Q 值`, clamp),
    gain: finite(band.gain, 0, -36, 36, `${label}增益（dB）`, clamp),
    slope: integer(band.slope, 1, 1, spec.maxSlope, `${label}斜率`, clamp),
    channels: integer(band.channels, 0, 0, 2, `${label}声道`, false),
    enabled: boolean(band.enabled, true, `${label}启用状态`),
    solo: boolean(band.solo, false, `${label}独奏状态`),
    locked: boolean(band.locked, false, `${label}锁定状态`),
    color: color.toLowerCase(),
  };
}

function normalizeLspSettings(value, clamp) {
  const source = value === undefined ? defaultLspSettings : strictObject(value, lspSettingsKeys, "LSP 均衡器设置");
  const bands = source.bands === undefined ? defaultLspBands() : source.bands;
  if (!Array.isArray(bands)) throw new TypeError("LSP 频段列表格式无效。");
  if (bands.length > 32) throw new RangeError("LSP 均衡器最多支持 32 段。");
  const pluginState = source.pluginState === undefined ? "" : source.pluginState;
  if (typeof pluginState !== "string") throw new TypeError("LSP 插件状态必须是 Base64 字符串。");
  if (pluginState.length > lspPluginStateMaxChars) throw new RangeError("LSP 插件状态超过 512 KiB 限制。");
  if (!canonicalLspPluginState(pluginState)) throw new TypeError("LSP 插件状态不是规范 Base64 字符串。");
  return {
    algorithm: choice(source.algorithm, "iir", ["iir", "fir", "fft", "spm"], "LSP 算法"),
    fftRank: integer(source.fftRank, 12, 10, 15, "LSP FFT 阶数", clamp),
    routing: choice(source.routing, "stereo", ["stereo", "ms"], "LSP 声道路由"),
    preamp: finite(source.preamp, 0, -36, 36, "LSP 前级增益（dB）", clamp),
    output: finite(source.output, 0, -36, 36, "LSP 输出增益（dB）", clamp),
    pluginState,
    bands: bands.map((band, index) => normalizeLspBand(band, index, clamp)),
  };
}

export const processingDefault = Object.freeze({
  float64: false,
  eq: Object.freeze({
    enabled: false,
    engine: "standard",
    mode: "graphic",
    name: "平直",
    preamp: 0,
    bandwidth: 1,
    bands: Object.freeze(defaultBands().map((band) => Object.freeze(band))),
    lsp: defaultLspSettings,
  }),
  tone: Object.freeze({
    enabled: false,
    bass: Object.freeze({ frequency: 80, q: 0.707, gain: 0 }),
    treble: Object.freeze({ frequency: 8000, q: 0.707, gain: 0 }),
  }),
  replayGain: Object.freeze({ mode: "off", source: "track", preamp: 0, noTagPreamp: 0 }),
  resampling: Object.freeze({
    mode: "follow",
    rate: 48000,
    engine: "r8brain",
    allowedRates: Object.freeze([...defaultRates]),
    family: false,
    soxrQuality: "vhq",
    soxrPassband: 0.97,
  }),
  outputFormat: "auto",
  dither: "none",
  bufferMs: 0,
  reconfigureMs: 250,
  bitPerfect: false,
  transition: Object.freeze({
    automatic: "gapless",
    manual: "none",
    crossfadeMs: 5000,
    manualMs: 400,
    transportFade: true,
    transportMs: 400,
    seekFade: true,
    seekMs: 100,
    preloadMs: 2000,
    gapMs: 0,
  }),
});

function object(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}格式无效。`);
  return value;
}

function boolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${label}必须是开关值。`);
  return value;
}

function choice(value, fallback, choices, label) {
  if (value === undefined) return fallback;
  if (!choices.includes(value)) throw new TypeError(`${label}选项无效。`);
  return value;
}

function finite(value, fallback, min, max, label, clamp) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label}必须是有限数字。`);
  if (value < min || value > max) {
    if (!clamp) throw new RangeError(`${label}范围为 ${min}–${max}。`);
    return Math.min(max, Math.max(min, value));
  }
  return value;
}

function integer(value, fallback, min, max, label, clamp) {
  const number = finite(value, fallback, min, max, label, clamp);
  if (!Number.isInteger(number)) {
    if (clamp) return Math.min(max, Math.max(min, Math.round(number)));
    throw new TypeError(`${label}必须是整数。`);
  }
  return number;
}

function text(value, fallback, maxLength, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new TypeError(`${label}格式无效。`);
  const clean = value.trim();
  if (!clean || clean.length > maxLength) throw new RangeError(`${label}不能为空，且最多 ${maxLength} 个字符。`);
  return clean;
}

function normalizeBand(value, index, clamp) {
  const band = object(value, {}, `第 ${index + 1} 段`);
  let q = finite(band.q, 0, 0, 36, `第 ${index + 1} 段 Q 值`, clamp);
  if (q > 0 && q < 0.001) {
    if (!clamp) throw new RangeError(`第 ${index + 1} 段 Q 值需至少为 0.001；图形自动模式可使用 0。`);
    q = 0.001;
  }
  const color = band.color === undefined ? bandColors[index % bandColors.length] : band.color;
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) throw new TypeError(`第 ${index + 1} 段颜色无效。`);
  return {
    type: integer(band.type, 2, 0, 5, `第 ${index + 1} 段类型`, false),
    channels: integer(band.channels, 0, 0, 2, `第 ${index + 1} 段声道`, false),
    frequency: finite(band.frequency, 1000, 10, 96000, `第 ${index + 1} 段频率（Hz）`, clamp),
    q,
    gain: finite(band.gain, 0, -36, 36, `第 ${index + 1} 段增益（dB）`, clamp),
    color: color.toLowerCase(),
    enabled: boolean(band.enabled, true, `第 ${index + 1} 段启用状态`),
    locked: boolean(band.locked, false, `第 ${index + 1} 段锁定状态`),
  };
}

function normalizeToneFilter(value, fallback, label, clamp) {
  const filter = object(value, fallback, label);
  return {
    frequency: finite(filter.frequency, fallback.frequency, 10, 40000, `${label}频率（Hz）`, clamp),
    q: finite(filter.q, fallback.q, 0.1, 18, `${label} Q 值`, clamp),
    gain: finite(filter.gain, fallback.gain, -24, 24, `${label}增益（dB）`, clamp),
  };
}

/** Normalize persisted processing settings. Set clamp:false when validating direct user input. */
export function normalizeProcessing(value, options = {}) {
  const clamp = options.clamp !== false;
  const input = object(value, {}, "音频设置");
  const sourceEq = object(input.eq, processingDefault.eq, "均衡器设置");
  const eqEngine = choice(sourceEq.engine, "standard", ["standard", "lsp"], "均衡器引擎");
  const eqMode = choice(sourceEq.mode, processingDefault.eq.mode, ["graphic", "parametric"], "均衡器模式");
  const lspSettings = normalizeLspSettings(sourceEq.lsp, clamp);
  const rawBands = sourceEq.bands === undefined ? defaultBands() : sourceEq.bands;
  if (!Array.isArray(rawBands)) throw new TypeError("均衡器频段列表格式无效。");
  const maximumBands = eqMode === "graphic" ? 32 : 128;
  const minimumBands = eqMode === "graphic" ? 5 : 0;
  if (rawBands.length > maximumBands) throw new RangeError(`${eqMode === "graphic" ? "图形均衡器" : "参数均衡器"}最多支持 ${maximumBands} 段。`);
  if (rawBands.length < minimumBands) throw new RangeError(`图形均衡器至少需要 ${minimumBands} 段。`);

  let normalizedBands = rawBands.map((band, index) => normalizeBand(band, index, clamp));
  if (eqMode === "graphic") {
    if (normalizedBands.some((band) => band.type !== 2)) throw new TypeError("图形均衡器的频段类型必须是峰值段。");
    const ordered = [...normalizedBands].sort((a, b) => a.frequency - b.frequency);
    const isOrdered = ordered.every((band, index) => band === normalizedBands[index]);
    const hasDuplicates = ordered.some((band, index) => index > 0 && band.frequency <= ordered[index - 1].frequency);
    if ((!isOrdered || hasDuplicates) && !clamp) throw new RangeError("图形均衡器频率需要从低到高排列且不能重复。");
    if (!isOrdered || hasDuplicates) {
      normalizedBands = ordered;
      for (let index = 1; index < normalizedBands.length; index += 1) {
        if (normalizedBands[index].frequency <= normalizedBands[index - 1].frequency) {
          normalizedBands[index].frequency = Math.min(96000, normalizedBands[index - 1].frequency + 1);
        }
      }
      if (normalizedBands.some((band, index) => index > 0 && band.frequency <= normalizedBands[index - 1].frequency)) {
        throw new RangeError("图形均衡器频率无法整理为不重复的升序布局。");
      }
    }
  }
  if (eqMode === "parametric") {
    normalizedBands.forEach((band, index) => {
      if (band.enabled && band.q === 0) {
        if (!clamp) throw new RangeError(`第 ${index + 1} 段参数均衡器的 Q 值必须大于 0。`);
        band.q = 0.001;
      }
    });
  }

  const sourceTone = object(input.tone, processingDefault.tone, "音调设置");
  const sourceReplayGain = object(input.replayGain, processingDefault.replayGain, "播放增益设置");
  const sourceResampling = object(input.resampling, processingDefault.resampling, "重采样设置");
  const rawRates = sourceResampling.allowedRates === undefined ? [...defaultRates] : sourceResampling.allowedRates;
  if (!Array.isArray(rawRates) || rawRates.length > 24) throw new RangeError("允许的采样率列表最多包含 24 项。");
  const allowedRates = [...new Set(rawRates.map((rate, index) => integer(rate, 48000, 8000, 768000, `第 ${index + 1} 个采样率`, false)))].sort((a, b) => a - b);
  const selectedRate = integer(sourceResampling.rate, 48000, 8000, 768000, "输出采样率（Hz）", clamp);
  if (sourceResampling.mode === "fixed" && !allowedRates.includes(selectedRate)) allowedRates.push(selectedRate), allowedRates.sort((a, b) => a - b);
  const sourceTransition = object(input.transition, processingDefault.transition, "歌曲过渡设置");

  return {
    float64: boolean(input.float64, processingDefault.float64, "64 位浮点处理"),
    eq: {
      enabled: boolean(sourceEq.enabled, processingDefault.eq.enabled, "均衡器"),
      engine: eqEngine,
      mode: eqMode,
      name: text(sourceEq.name, processingDefault.eq.name, 80, "均衡器名称"),
      preamp: finite(sourceEq.preamp, 0, -36, 36, "均衡器前级增益（dB）", clamp),
      bandwidth: finite(sourceEq.bandwidth, 1, 0.5, 2, "图形均衡器带宽倍数", clamp),
      bands: normalizedBands,
      lsp: lspSettings,
    },
    tone: {
      enabled: boolean(sourceTone.enabled, processingDefault.tone.enabled, "音调"),
      bass: normalizeToneFilter(sourceTone.bass, processingDefault.tone.bass, "低音", clamp),
      treble: normalizeToneFilter(sourceTone.treble, processingDefault.tone.treble, "高音", clamp),
    },
    replayGain: {
      mode: choice(sourceReplayGain.mode, "off", ["off", "gain", "protect"], "播放增益模式"),
      source: choice(sourceReplayGain.source, "track", ["album", "track"], "播放增益来源"),
      preamp: finite(sourceReplayGain.preamp, 0, -24, 24, "播放增益前级（dB）", clamp),
      noTagPreamp: finite(sourceReplayGain.noTagPreamp, 0, -24, 24, "缺少标签时的前级（dB）", clamp),
    },
    resampling: {
      mode: choice(sourceResampling.mode, "follow", ["follow", "auto", "fixed"], "重采样模式"),
      rate: selectedRate,
      engine: choice(sourceResampling.engine, "r8brain", ["r8brain", "soxr", "fast"], "重采样引擎"),
      soxrQuality: choice(sourceResampling.soxrQuality, "vhq", ["hq", "vhq"], "SoX 重采样质量"),
      soxrPassband: finite(sourceResampling.soxrPassband, 0.97, 0.85, 0.995, "SoX 通带截止比例", clamp),
      allowedRates,
      family: boolean(sourceResampling.family, false, "采样率系列匹配"),
    },
    outputFormat: choice(input.outputFormat, "auto", outputFormats, "输出格式"),
    dither: choice(input.dither, "none", dithers, "抖动方式"),
    bufferMs: integer(input.bufferMs, 0, 0, 2000, "播放缓冲（毫秒）", clamp),
    reconfigureMs: integer(input.reconfigureMs, 250, 0, 10000, "重配置淡变（毫秒）", clamp),
    bitPerfect: boolean(input.bitPerfect, false, "比特一致性"),
    transition: {
      automatic: choice(sourceTransition.automatic, "gapless", automaticTransitions, "自动切歌方式"),
      manual: choice(sourceTransition.manual, "none", manualTransitions, "手动切歌方式"),
      crossfadeMs: integer(sourceTransition.crossfadeMs, 5000, 0, 30000, "交叉渐变时长（毫秒）", clamp),
      manualMs: integer(sourceTransition.manualMs, 400, 0, 10000, "手动切歌淡变（毫秒）", clamp),
      transportFade: boolean(sourceTransition.transportFade, true, "播放与暂停淡变"),
      transportMs: integer(sourceTransition.transportMs, 400, 0, 10000, "播放与暂停淡变时长（毫秒）", clamp),
      seekFade: boolean(sourceTransition.seekFade, true, "跳转淡变"),
      seekMs: integer(sourceTransition.seekMs, 100, 0, 10000, "跳转淡变时长（毫秒）", clamp),
      preloadMs: integer(sourceTransition.preloadMs, 2000, 0, 30000, "预载时间（毫秒）", clamp),
      gapMs: integer(sourceTransition.gapMs, 0, 0, 10000, "曲间停顿（毫秒）", clamp),
    },
  };
}

/** Derive runtime PCM settings without changing the saved request. */
export function effectivePcmProcessing(value) {
  const settings = normalizeProcessing(value, { clamp: false });
  if (settings.eq.engine === "lsp") settings.tone.enabled = false;
  if (!settings.bitPerfect) return settings;

  settings.eq.enabled = false;
  settings.eq.preamp = 0;
  settings.tone.enabled = false;
  settings.replayGain.mode = "off";
  settings.replayGain.preamp = 0;
  settings.replayGain.noTagPreamp = 0;
  settings.resampling.mode = "follow";
  settings.outputFormat = "auto";
  settings.dither = "none";
  settings.transition.automatic = "none";
  settings.transition.manual = "none";
  settings.transition.transportFade = false;
  settings.transition.seekFade = false;
  settings.transition.gapMs = 0;
  return settings;
}

function graphicAutoQ(eq, index, sampleRate) {
  const band = eq.bands[index];
  if (!band || band.q > 0) return band?.q ?? 0.707;
  const previous = eq.bands[index - 1];
  const next = eq.bands[index + 1];
  const octaveWidth = previous && next
    ? 0.5 * Math.log2(next.frequency / previous.frequency)
    : next
      ? Math.log2(next.frequency / band.frequency)
      : previous
        ? Math.log2(band.frequency / previous.frequency)
        : 1;
  const bandwidth = octaveWidth * eq.bandwidth;
  if (!Number.isFinite(bandwidth) || bandwidth <= 0) throw new RangeError("图形均衡器自动带宽必须为正数。");
  const omega = (2 * Math.PI * band.frequency) / sampleRate;
  const sine = Math.sin(omega);
  if (!(sine > 0)) return 0.707;
  const denominator = 2 * Math.sinh((Math.LN2 / 2) * bandwidth * (omega / sine));
  return denominator > 0 ? 1 / denominator : 0.707;
}

export function processingBandQ(settings, index, sampleRate = 48000) {
  const band = settings?.eq?.bands?.[index];
  if (!band) return 0.707;
  if (settings.eq.mode === "graphic" && band.type === 2 && band.q === 0) {
    return graphicAutoQ(settings.eq, index, Math.max(8000, sampleRate));
  }
  return band.q;
}

function coefficients(type, frequency, q, gain, sampleRate) {
  const nyquist = sampleRate / 2;
  const hz = Math.min(nyquist * 0.999999, Math.max(0.000001, frequency));
  const omega = (2 * Math.PI * hz) / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const safeQ = Math.max(0.000001, q);
  const alpha = sine / (2 * safeQ);
  const amplitude = 10 ** (gain / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 0) {
    b0 = (1 - cosine) / 2;
    b1 = 1 - cosine;
    b2 = (1 - cosine) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosine;
    a2 = 1 - alpha;
  } else if (type === 1) {
    b0 = (1 + cosine) / 2;
    b1 = -(1 + cosine);
    b2 = (1 + cosine) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosine;
    a2 = 1 - alpha;
  } else if (type === 2) {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cosine;
    a2 = 1 - alpha;
  } else if (type === 3) {
    b0 = 1 + alpha * amplitude;
    b1 = -2 * cosine;
    b2 = 1 - alpha * amplitude;
    a0 = 1 + alpha / amplitude;
    a1 = -2 * cosine;
    a2 = 1 - alpha / amplitude;
  } else {
    // The stored Q maps to the RBJ shelf slope through alpha=sin(w0)/(2Q).
    const shelfAlpha = sine / (2 * safeQ);
    const beta = 2 * Math.sqrt(amplitude) * shelfAlpha;
    if (type === 4) {
      b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + beta);
      b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine);
      b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - beta);
      a0 = (amplitude + 1) + (amplitude - 1) * cosine + beta;
      a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosine);
      a2 = (amplitude + 1) + (amplitude - 1) * cosine - beta;
    } else {
      b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + beta);
      b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine);
      b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - beta);
      a0 = (amplitude + 1) - (amplitude - 1) * cosine + beta;
      a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosine);
      a2 = (amplitude + 1) - (amplitude - 1) * cosine - beta;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function magnitudeDb(filter, c1, s1, c2, s2) {
  const realNumerator = filter.b0 + filter.b1 * c1 + filter.b2 * c2;
  const imaginaryNumerator = -filter.b1 * s1 - filter.b2 * s2;
  const realDenominator = 1 + filter.a1 * c1 + filter.a2 * c2;
  const imaginaryDenominator = -filter.a1 * s1 - filter.a2 * s2;
  const numerator = Math.hypot(realNumerator, imaginaryNumerator);
  const denominator = Math.hypot(realDenominator, imaginaryDenominator);
  return 20 * Math.log10(Math.max(1e-12, numerator / Math.max(1e-12, denominator)));
}

function responseFilters(settings, sampleRate, channel) {
  const filters = [];
  const eq = settings?.eq;
  let preamp = 0;
  if (eq?.enabled) {
    preamp = eq.preamp;
    eq.bands.forEach((band, index) => {
      const filter = responseBandFilter(settings, index, sampleRate, channel);
      if (filter) filters.push(filter);
    });
  }
  if (settings?.tone?.enabled) {
    const { bass, treble } = settings.tone;
    filters.push({ coefficients: coefficients(4, bass.frequency, bass.q, bass.gain, sampleRate), gain: 0 });
    filters.push({ coefficients: coefficients(5, treble.frequency, treble.q, treble.gain, sampleRate), gain: 0 });
  }
  return { filters, preamp };
}

function requireStandardEqResponse(settings) {
  if (settings?.eq?.engine === "lsp") {
    throw new TypeError("LSP 均衡器响应必须由原生 LSP 预览接口计算。");
  }
}

function responseBandFilter(settings, index, sampleRate, channel) {
  const band = settings?.eq?.bands?.[index];
  if (!settings?.eq?.enabled || !band?.enabled || (band.channels !== 0 && band.channels !== channel + 1)) return undefined;
  const q = processingBandQ(settings, index, sampleRate);
  const filterType = settings.eq.mode === "graphic" && band.type === 2 ? 3 : band.type;
  return {
    coefficients: coefficients(filterType, band.frequency, q, band.gain, sampleRate),
    gain: band.type === 2 && settings.eq.mode === "parametric" ? band.gain : 0,
  };
}

/** RBJ biquad response in dB for a mono channel (0=left, 1=right). */
export function calcEqResponseSamples(settings, frequencies, sampleRate = 48000, channel = 0) {
  requireStandardEqResponse(settings);
  if (!Array.isArray(frequencies) || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const { filters, preamp } = responseFilters(settings, sampleRate, channel);
  return responseSamples(filters, preamp, frequencies, sampleRate);
}

/** One band's contribution, excluding the common preamp and tone. Graphic Q uses the full layout. */
export function calcEqBandResponseSamples(settings, index, frequencies, sampleRate = 48000, channel = 0) {
  requireStandardEqResponse(settings);
  if (!Array.isArray(frequencies) || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const filter = responseBandFilter(settings, index, sampleRate, channel);
  return responseSamples(filter ? [filter] : [], 0, frequencies, sampleRate);
}

function responseSamples(filters, preamp, frequencies, sampleRate) {
  const nyquist = sampleRate / 2;
  return frequencies.map((frequency) => {
    if (!Number.isFinite(frequency) || frequency <= 0 || frequency >= nyquist) return 0;
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const c1 = Math.cos(omega);
    const s1 = Math.sin(omega);
    const c2 = Math.cos(2 * omega);
    const s2 = Math.sin(2 * omega);
    let response = preamp;
    for (const filter of filters) response += magnitudeDb(filter.coefficients, c1, s1, c2, s2) + filter.gain;
    return response;
  });
}

export function calcEqResponse(settings, frequency, sampleRate = 48000, channel = 0) {
  return calcEqResponseSamples(settings, [frequency], sampleRate, channel)[0] ?? 0;
}

const backupSettingKeys = Object.keys(processingDefault).filter((key) => key !== "tone");
const backupToneKeys = ["enabled", "bass", "treble"];
const toneFilterKeys = ["frequency", "q", "gain"];

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}格式无效。`);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length) throw new TypeError(`${label}包含未知字段：${unknown.join("、")}。`);
  if (missing.length) throw new TypeError(`${label}缺少字段：${missing.join("、")}。`);
  return value;
}

function exactObjectWithOptional(value, requiredKeys, optionalKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}格式无效。`);
  const allowed = [...requiredKeys, ...optionalKeys];
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !allowed.includes(key));
  const missing = requiredKeys.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length) throw new TypeError(`${label}包含未知字段：${unknown.join("、")}。`);
  if (missing.length) throw new TypeError(`${label}缺少字段：${missing.join("、")}。`);
  return value;
}

function validateBackupEq(value, label) {
  const eq = exactObjectWithOptional(value, ["enabled", "mode", "name", "preamp", "bandwidth", "bands"], ["engine", "lsp"], label);
  if (!Array.isArray(eq.bands)) throw new TypeError(`${label}频段列表格式无效。`);
  eq.bands.forEach((band, index) => exactObjectWithOptional(band,
    ["type", "channels", "frequency", "q", "gain", "color", "enabled"], ["locked"], `${label}第 ${index + 1} 段`));
  return eq;
}

function normalizeBackupEqModes(value, processing, requireActive = true) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Rhine 备份的 eqModes 格式无效。");
  const modes = Object.keys(value);
  if (!modes.length || modes.some((mode) => !["graphic", "parametric"].includes(mode))) throw new TypeError("Rhine 备份的 EQ 模式列表无效。");
  const eqModes = {};
  for (const mode of modes) {
    const eq = validateBackupEq(value[mode], `Rhine 备份的 ${mode} EQ 配置`);
    if (eq.mode !== mode) throw new TypeError(`Rhine 备份的 ${mode} EQ 模式标记不匹配。`);
    eqModes[mode] = normalizeProcessing({ ...processing, eq }, { clamp: false }).eq;
  }
  if (requireActive && !Object.hasOwn(eqModes, processing.eq.mode)) throw new TypeError("Rhine 备份缺少当前模式的 EQ 配置。");
  return eqModes;
}

/** Serialize a complete, local Rhine processing backup with tone stored separately. */
export function serializeRhineProcessingBackup(value, eqModeBanks) {
  const processing = normalizeProcessing(value, { clamp: false });
  const { tone, ...settings } = processing;
  const banks = normalizeBackupEqModes(eqModeBanks ?? { [processing.eq.mode]: processing.eq }, processing);
  return JSON.stringify({ schemaVersion: 1, name: processing.eq.name, settings, tone, eqModes: banks }, null, 2);
}

/** Parse a versioned local Rhine processing backup without clamping imported values. */
export function importRhineProcessingBackup(source) {
  if (typeof source !== "string" || !source.trim()) throw new TypeError("请选择 Rhine 音频设置 JSON 备份。");
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { throw new TypeError("无法读取 Rhine 音频设置备份 JSON。"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Rhine 音频设置备份格式无效。");
  exactObject(parsed, ["schemaVersion", "name", "settings", "tone", "eqModes"], "Rhine 音频设置备份");
  if (parsed.schemaVersion !== 1) throw new RangeError(`不支持 Rhine 音频设置备份版本 ${String(parsed.schemaVersion)}。`);
  const name = text(parsed.name, "Rhine 音频设置", 80, "备份名称");
  const settings = exactObject(parsed.settings, backupSettingKeys, "Rhine 备份设置");
  validateBackupEq(settings.eq, "Rhine 备份 EQ 设置");
  exactObject(settings.replayGain, ["mode", "source", "preamp", "noTagPreamp"], "Rhine 备份 ReplayGain 设置");
  exactObjectWithOptional(settings.resampling, ["mode", "rate", "engine", "allowedRates", "family"], ["soxrQuality", "soxrPassband"], "Rhine 备份重采样设置");
  exactObject(settings.transition, ["automatic", "manual", "crossfadeMs", "manualMs", "transportFade", "transportMs", "seekFade", "seekMs", "preloadMs", "gapMs"], "Rhine 备份过渡设置");
  const tone = exactObject(parsed.tone, backupToneKeys, "Rhine 备份音调设置");
  exactObject(tone.bass, toneFilterKeys, "Rhine 备份低音参数");
  exactObject(tone.treble, toneFilterKeys, "Rhine 备份高音参数");
  const processing = normalizeProcessing({ ...settings, tone }, { clamp: false });
  const eqModes = normalizeBackupEqModes(parsed.eqModes, processing);
  const { tone: normalizedTone, ...normalizedSettings } = processing;
  return { schemaVersion: 1, name, settings: normalizedSettings, tone: normalizedTone, eqModes };
}

function importNumber(value, min, max, label, fallback) {
  const number = value === undefined && fallback !== undefined ? fallback : value;
  if (typeof number !== "number" || !Number.isFinite(number)) throw new TypeError(`${label}必须是有限数字。`);
  if (number < min || number > max) throw new RangeError(`${label}超出可用范围 ${min}–${max}。`);
  return number;
}

function importBand(value, index) {
  const band = object(value, null, `第 ${index + 1} 个 Poweramp 频段`);
  if (!Number.isInteger(band.type) || band.type < 0 || band.type > 5) throw new TypeError(`第 ${index + 1} 个 Poweramp 频段类型无效。`);
  const frequency = importNumber(band.frequency ?? band.freq, 10, 96000, `第 ${index + 1} 段频率`);
  const q = importNumber(band.q, 0, 36, `第 ${index + 1} 段 Q 值`, 0);
  const gain = importNumber(band.gain, -36, 36, `第 ${index + 1} 段增益`);
  const channels = band.channels === undefined ? 0 : band.channels;
  if (!Number.isInteger(channels) || channels < 0 || channels > 2) throw new TypeError(`第 ${index + 1} 个 Poweramp 频段声道无效。`);
  return { type: band.type, channels, frequency, q, gain, sourceColor: band.color, color: bandColors[index % bandColors.length], enabled: band.enabled !== false };
}

function isTonePair(bands) {
  if (bands.length < 2) return false;
  const [bass, treble] = bands;
  return bass.type === 0 && treble.type === 1
    && bass.channels === 0 && treble.channels === 0
    && bass.sourceColor === 0 && treble.sourceColor === 0
    && bass.frequency <= 300 && treble.frequency >= 2000
    && bass.frequency < treble.frequency;
}

/** Import a Poweramp EQ JSON preset without changing the local tone enable switch. */
export function importPowerampPreset(source) {
  if (typeof source !== "string" || !source.trim()) throw new TypeError("请选择 Poweramp 导出的预设文本。");
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new TypeError("无法读取 Poweramp 预设；请使用 Poweramp 导出的 JSON 文件。");
  }
  const preset = object(parsed, null, "Poweramp 预设");
  if (typeof preset.parametric !== "boolean") throw new TypeError("Poweramp 预设缺少有效的 parametric 模式标记。");
  if (!Array.isArray(preset.bands)) throw new TypeError("Poweramp 预设缺少 bands 频段列表。");
  if (preset.bands.length < 1 || preset.bands.length > 130) throw new RangeError("Poweramp 预设频段数量无效。");
  const bands = preset.bands.map(importBand);
  const looksLikeTonePair = bands.length >= 2 && bands[0].type === 0 && bands[1].type === 1
    && bands[0].channels === 0 && bands[1].channels === 0
    && bands[0].sourceColor === 0 && bands[1].sourceColor === 0;
  const toneFound = isTonePair(bands);
  if (looksLikeTonePair && !toneFound) throw new TypeError("Poweramp 预设前两段的音调结构有歧义，无法安全区分音调与低通/高通滤波。");
  const toneBands = toneFound ? bands.slice(0, 2) : [];
  const eqBands = toneFound ? bands.slice(2) : bands;
  const mode = preset.parametric ? "parametric" : "graphic";
  if (mode === "graphic" && (eqBands.length < 5 || eqBands.length > 32 || !eqBands.every((band) => band.type === 2 && band.q === 0))) {
    throw new RangeError("Poweramp 图形预设需要 5–32 段 type 2、Q=0 的图形频段。");
  }
  if (mode === "graphic" && eqBands.some((band, index) => index > 0 && band.frequency <= eqBands[index - 1].frequency)) {
    throw new RangeError("Poweramp 图形预设频率必须从低到高排列且不能重复。");
  }
  if (mode === "parametric" && (eqBands.length < 1 || eqBands.length > 128)) throw new RangeError("Poweramp 参数预设需要 1–128 段。");
  if (eqBands.some((band) => band.q > 0 && band.q < 0.001)) throw new RangeError("Poweramp 频段 Q 值需至少为 0.001。");
  if (mode === "parametric" && eqBands.some((band) => band.enabled && band.q === 0)) throw new RangeError("Poweramp 参数频段的 Q 值必须大于 0。");
  const eq = {
    enabled: true,
    engine: "standard",
    mode,
    name: typeof preset.name === "string" && preset.name.trim() ? preset.name.trim().slice(0, 80) : "导入预设",
    preamp: importNumber(preset.preamp, -36, 36, "均衡器前级增益", 0),
    bandwidth: 1,
    bands: eqBands.map((band, index) => ({ ...band, color: bandColors[index % bandColors.length] })),
    lsp: normalizeLspSettings(undefined, false),
  };
  if (!eq.bands.length) throw new RangeError("Poweramp 预设没有可用的均衡器频段。");
  const result = { eq };
  if (toneFound) {
    if (toneBands.some((band) => band.frequency > 40000)) throw new RangeError("Poweramp 音调频率需在 10–40000 Hz 之间。");
    if (toneBands.some((band) => band.q < 0.1 || band.q > 18)) throw new RangeError("Poweramp 音调 Q 值需在 0.1–18 之间。");
    if (toneBands.some((band) => band.gain < -24 || band.gain > 24)) throw new RangeError("Poweramp 音调增益需在 −24 至 +24 dB 之间。");
    result.tone = {
      bass: { frequency: toneBands[0].frequency, q: toneBands[0].q, gain: toneBands[0].gain },
      treble: { frequency: toneBands[1].frequency, q: toneBands[1].q, gain: toneBands[1].gain },
    };
  }
  return result;
}
