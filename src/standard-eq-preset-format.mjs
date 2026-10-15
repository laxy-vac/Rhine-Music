import {
  importPowerampPreset,
  normalizeProcessing,
  processingDefault,
} from "./audio-processing-model.mjs";

const RHINE_FORMAT = "rhine-standard-eq-preset";
const RHINE_SCHEMA_VERSION = 1;
const eqKeys = ["enabled", "mode", "preamp", "bandwidth", "bands"];
const toneKeys = ["enabled", "bass", "treble"];
const filterKeys = ["frequency", "q", "gain"];
const bandKeys = ["type", "channels", "frequency", "q", "gain", "color", "enabled", "locked"];

function fileLeaf(fileName) {
  if (fileName === undefined) return "";
  if (typeof fileName !== "string") throw new TypeError("预设文件名必须是文本。");
  return fileName.split(/[\\/]/).at(-1)?.trim() ?? "";
}

function filePresetName(fileName) {
  const leaf = fileLeaf(fileName);
  const stem = leaf.replace(/\.[^.]+$/, "").trim();
  return stem ? stem.slice(0, 80) : undefined;
}

function contextualize(error, fileName) {
  const label = fileLeaf(fileName);
  if (!label) throw error;
  const ErrorType = error instanceof RangeError ? RangeError : TypeError;
  throw new ErrorType(`${label}：${error?.message ?? "EQ 预设格式无效。"}`, { cause: error });
}

function parseJsonObject(sourceText) {
  if (typeof sourceText !== "string" || !sourceText.trim()) {
    throw new TypeError("请选择 EQ 预设 JSON 文件。");
  }
  let value;
  try {
    value = JSON.parse(sourceText.replace(/^\uFEFF/, "").trim());
  } catch (error) {
    throw new TypeError("无法读取 EQ 预设 JSON。", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("EQ 预设必须是 JSON 对象。");
  }
  return value;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}格式无效。`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new TypeError(`${label}字段无效。`);
  }
  return value;
}

function validateRhinePreset(value, displayName) {
  exactKeys(value, ["format", "schemaVersion", "eq", "tone"], "Rhine 标准 EQ 预设");
  if (value.format !== RHINE_FORMAT) throw new TypeError("Rhine 标准 EQ 预设标记无效。");
  if (value.schemaVersion !== RHINE_SCHEMA_VERSION) {
    throw new RangeError(`不支持 Rhine 标准 EQ 预设版本 ${String(value.schemaVersion)}。`);
  }
  const eq = exactKeys(value.eq, eqKeys, "Rhine 标准 EQ 设置");
  const tone = exactKeys(value.tone, toneKeys, "Rhine 标准音调设置");
  if (!Array.isArray(eq.bands)) throw new TypeError("Rhine 标准 EQ 频段列表格式无效。");
  eq.bands.forEach((band, index) => exactKeys(band, bandKeys, `Rhine 第 ${index + 1} 个 EQ 频段`));
  exactKeys(tone.bass, filterKeys, "Rhine 低音参数");
  exactKeys(tone.treble, filterKeys, "Rhine 高音参数");

  const normalized = normalizeProcessing({
    eq: {
      ...eq,
      engine: "standard",
      name: displayName ?? "导入预设",
      lsp: processingDefault.eq.lsp,
    },
    tone,
  }, { clamp: false });
  return { format: "rhine-standard", eq: normalized.eq, tone: normalized.tone };
}

function looksLikePowerampTonePrefix(bands) {
  if (bands.length < 2) return false;
  const [bass, treble] = bands;
  return bass?.type === 0 && treble?.type === 1
    && (bass.channels === undefined || bass.channels === 0)
    && (treble.channels === undefined || treble.channels === 0)
    && bass.color === 0 && treble.color === 0;
}

function withPowerampToneDefaults(preset) {
  const bands = preset.bands.map((band) => ({ ...band }));
  if (!looksLikePowerampTonePrefix(bands)) return { ...preset, bands };
  const defaults = [processingDefault.tone.bass, processingDefault.tone.treble];
  for (let index = 0; index < 2; index += 1) {
    const band = bands[index];
    const filter = defaults[index];
    if ((band.frequency ?? band.freq) === undefined || (band.frequency ?? band.freq) === 0) {
      band.frequency = filter.frequency;
    }
    if (band.q === undefined || band.q === 0) band.q = filter.q;
  }
  return { ...preset, bands };
}

function emptyParametricPreset(preset, displayName) {
  if (preset.parametric !== true || preset.bands.length !== 0) return undefined;
  const normalized = normalizeProcessing({
    eq: {
      enabled: true,
      engine: "standard",
      mode: "parametric",
      name: displayName ?? (typeof preset.name === "string" && preset.name.trim()
        ? preset.name.trim().slice(0, 80)
        : "导入预设"),
      preamp: preset.preamp,
      bands: [],
    },
  }, { clamp: false });
  return { format: "poweramp", eq: normalized.eq };
}

function importPowerampFile(preset, displayName) {
  if (typeof preset.parametric !== "boolean") {
    throw new TypeError("Poweramp 预设缺少有效的 parametric 模式标记。");
  }
  if (!Array.isArray(preset.bands)) throw new TypeError("Poweramp 预设缺少 bands 频段列表。");
  if (preset.bands.length > 130) throw new RangeError("Poweramp 预设频段数量无效。");
  const fallback = emptyParametricPreset(preset, displayName);
  if (fallback) return fallback;

  const prepared = withPowerampToneDefaults(preset);
  const tonePrefix = looksLikePowerampTonePrefix(prepared.bands);
  const hasOnlyTone = tonePrefix && prepared.parametric && prepared.bands.length === 2;
  const validationPreset = hasOnlyTone
    ? { ...prepared, bands: [...prepared.bands, { type: 3, channels: 0, frequency: 1000, q: 1, gain: 0, color: 0 }] }
    : prepared;
  const imported = importPowerampPreset(JSON.stringify(validationPreset));
  const display = displayName ?? imported.eq.name;
  const normalized = normalizeProcessing({
    eq: {
      ...imported.eq,
      name: display,
      ...(hasOnlyTone ? { bands: [] } : {}),
      engine: "standard",
      lsp: processingDefault.eq.lsp,
    },
    ...(imported.tone ? { tone: { ...imported.tone, enabled: false } } : {}),
  }, { clamp: false });
  return {
    format: "poweramp",
    eq: normalized.eq,
    ...(imported.tone
      ? { tone: { bass: normalized.tone.bass, treble: normalized.tone.treble } }
      : {}),
  };
}

/** Parse a Poweramp EQ preset or a strictly versioned Rhine standard-EQ file. */
export function parseStandardEqPresetFile(sourceText, fileName) {
  fileLeaf(fileName);
  try {
    const value = parseJsonObject(sourceText);
    const displayName = filePresetName(fileName);
    if (value.format === RHINE_FORMAT) return validateRhinePreset(value, displayName);
    if (Object.hasOwn(value, "format")) throw new TypeError("不支持此 EQ 预设文件格式。");
    return importPowerampFile(value, displayName);
  } catch (error) {
    contextualize(error, fileName);
  }
}

/** Serialize only standard EQ and Tone settings in the Rhine-owned format. */
export function serializeStandardEqPresetFile(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("音频设置格式无效。");
  }
  const sourceEq = settings.eq;
  if (sourceEq?.engine === "lsp") {
    throw new TypeError("LSP 进阶均衡器不能保存为入门 EQ 预设。");
  }
  if (sourceEq?.engine !== undefined && sourceEq.engine !== "standard") {
    throw new TypeError("均衡器引擎无效。");
  }
  const normalized = normalizeProcessing({
    eq: {
      enabled: sourceEq?.enabled,
      engine: "standard",
      mode: sourceEq?.mode,
      name: "标准 EQ 预设",
      preamp: sourceEq?.preamp,
      bandwidth: sourceEq?.bandwidth,
      bands: sourceEq?.bands,
    },
    tone: settings.tone,
  }, { clamp: false });
  const { eq, tone } = normalized;
  return JSON.stringify({
    format: RHINE_FORMAT,
    schemaVersion: RHINE_SCHEMA_VERSION,
    eq: {
      enabled: eq.enabled,
      mode: eq.mode,
      preamp: eq.preamp,
      bandwidth: eq.bandwidth,
      bands: eq.bands.map(({ type, channels, frequency, q, gain, color, enabled, locked }) => ({
        type, channels, frequency, q, gain, color, enabled, locked,
      })),
    },
    tone,
  }, null, 2);
}
