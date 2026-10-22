import styleTokensJson from "./assets/style/tokens.json";
import { uiLanguage } from "./i18n";
import { futureAppearancePickerMarkup, syncFutureAppearancePicker } from "./future-appearance-picker";

export type MusicStyle = {
  design: "rhine" | "archive";
  dayPalette: "soft" | "original";
  camera: "player" | "foobar";
  caseStyle:
    | "rhine"
    | "marble"
    | "hazard"
    | "white"
    | "glass"
    | "frost"
    | "red"
    | "blue"
    | "coral"
    | "tide"
    | "aurora";
  scheme: "rhine" | "archive" | "hazard" | "flare" | "field" | "front" | "hearth";
  shelf: boolean;
  direction: "left-to-right" | "right-to-left";
  floor: "plain" | "deck" | "real";
  arrayScale: number;
  inspectScale: number;
  textScale: number;
  topTitles: boolean;
  grain: boolean;
};

type CaseStyle = MusicStyle["caseStyle"];
type ColourScheme = MusicStyle["scheme"];
type PaletteTokenSet = Record<string, string>;
type SchemeToken = {
  name: string;
  light: PaletteTokenSet;
  dark: PaletteTokenSet;
};
export type StylePalette = PaletteTokenSet & {
  bg: string;
  fg: string;
  muted: string;
  line: string;
  accent: string;
  panel: string;
  surface: string;
  veil: string;
  well: string;
};

const CASE_STYLES: CaseStyle[] = [
  "marble",
  "hazard",
  "white",
  "glass",
  "frost",
  "red",
  "blue",
  "coral",
  "tide",
  "aurora",
];
const SCHEMES: ColourScheme[] = [
  "archive",
  "hazard",
  "flare",
  "field",
  "front",
  "hearth",
];
const TEXT_SCALES = [0.9, 1, 1.1, 1.2, 1.35, 1.5];
const ARRAY_SCALES = [0.8, 0.9, 1, 1.15, 1.3];
const INSPECT_SCALES = [1, 1.15, 1.3, 1.5];

export const defaultMusicStyle: MusicStyle = {
  design: "rhine",
  dayPalette: "soft",
  camera: "player",
  caseStyle: "rhine",
  scheme: "rhine",
  shelf: false,
  direction: "left-to-right",
  floor: "plain",
  arrayScale: 1,
  inspectScale: 1,
  textScale: 1,
  topTitles: false,
  grain: false,
};

export const archiveMusicStyle: MusicStyle = {
  ...defaultMusicStyle,
  design: "archive",
  camera: "foobar",
  caseStyle: "glass",
  scheme: "archive",
  shelf: true,
  direction: "left-to-right",
  topTitles: true,
  grain: true,
};
export type DesignProfile = { style: MusicStyle; mode: "day" | "night" };
export type DesignProfiles = Record<MusicStyle["design"], DesignProfile>;

/** Old single-combination preferences migrate without changing their chosen assets. */
export function normalizeDesignProfiles(value: unknown, active: MusicStyle, mode: "day" | "night"): DesignProfiles {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<DesignProfiles> : {};
  const profiles = {} as DesignProfiles;
  for (const design of ["rhine", "archive"] as const) {
    const entry = raw[design];
    const baseline = design === "archive" ? archiveMusicStyle : defaultMusicStyle;
    profiles[design] = {
      style: normalizeMusicStyle({ ...baseline, ...(entry && typeof entry.style === "object" ? entry.style : {}), design }),
      // Retain the legacy field as a compatibility mirror, never as a
      // per-design preference that can overwrite the global day/night mode.
      mode,
    };
  }
  profiles[active.design] = { style: normalizeMusicStyle(active), mode };
  return profiles;
}

const TOKEN_SCHEMES = (
  styleTokensJson as unknown as { schemes: Record<string, SchemeToken> }
).schemes;

const LANG = () => (uiLanguage() === "en" ? "en" : "zh-CN");
const t = (zh: string, en: string) => (LANG() === "en" ? en : zh);
const textScaleLabel = (value: number) => `${Math.round(value * 100)}%`;

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function closestScale(value: unknown, values: readonly number[], fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return values.reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest,
  );
}

export function normalizeMusicStyle(value: unknown): MusicStyle {
  const candidate =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const design = isOneOf(candidate.design, ["rhine", "archive"])
    ? candidate.design
    : "rhine";

  if (design === "rhine") return {
    ...defaultMusicStyle,
    dayPalette: isOneOf(candidate.dayPalette, ["soft", "original"])
      ? candidate.dayPalette
      : defaultMusicStyle.dayPalette,
  };

  return {
    design: "archive",
    dayPalette: "soft",
    camera: "foobar",
    caseStyle: isOneOf(candidate.caseStyle, CASE_STYLES)
      ? candidate.caseStyle
      : candidate.caseStyle === "rhine"
        ? "glass"
        : archiveMusicStyle.caseStyle,
    scheme: isOneOf(candidate.scheme, SCHEMES)
      ? candidate.scheme
      : candidate.scheme === "rhine"
        ? "archive"
        : archiveMusicStyle.scheme,
    shelf: true,
    direction: "left-to-right",
    floor: isOneOf(candidate.floor, ["plain", "deck", "real"])
      ? candidate.floor
      : archiveMusicStyle.floor,
    arrayScale: closestScale(candidate.arrayScale, ARRAY_SCALES, archiveMusicStyle.arrayScale),
    inspectScale: closestScale(
      candidate.inspectScale,
      INSPECT_SCALES,
      archiveMusicStyle.inspectScale,
    ),
    textScale: closestScale(candidate.textScale, TEXT_SCALES, archiveMusicStyle.textScale),
    topTitles:
      typeof candidate.topTitles === "boolean"
        ? candidate.topTitles
        : archiveMusicStyle.topTitles,
    grain: typeof candidate.grain === "boolean" ? candidate.grain : archiveMusicStyle.grain,
  };
}

const RHINE_PALETTES: Record<"day" | "night", StylePalette> = {
  day: {
    bg: "#e8e5e1",
    fg: "#232722",
    muted: "#74786f",
    line: "rgba(42, 49, 42, 0.18)",
    accent: "#b56834",
    surface: "#efede7",
    panel: "rgba(245, 244, 239, 0.97)",
    veil: "rgba(236, 233, 225, 0.72)",
    well: "#e3e0da",
    "fg-soft": "#555a52",
    "text-muted": "#74786f",
    mark: "#8c9186",
    "line-dim": "rgba(42, 49, 42, 0.18)",
    "line-faint": "rgba(42, 49, 42, 0.18)",
    hair: "rgba(42, 49, 42, 0.18)",
    "panel-hi": "#faf9f5",
    case: "#efede7",
    "case-hi": "#faf9f5",
    "on-accent": "#232722",
  },
  night: {
    bg: "#08121f",
    fg: "#e9eef2",
    muted: "#9caabd",
    line: "rgba(208, 226, 243, 0.2)",
    accent: "#d9ad7d",
    surface: "#162234",
    panel: "rgba(17, 27, 42, 0.97)",
    veil: "rgba(10, 21, 37, 0.75)",
    well: "#101b2b",
    "fg-soft": "#bdcad7",
    "text-muted": "#9caabd",
    mark: "#8294a8",
    "line-dim": "rgba(208, 226, 243, 0.2)",
    "line-faint": "rgba(208, 226, 243, 0.2)",
    hair: "rgba(208, 226, 243, 0.2)",
    "panel-hi": "#1c2b3e",
    case: "#162234",
    "case-hi": "#223249",
    "on-accent": "#08121f",
  },
};

const RHINE_ORIGINAL_DAY_PALETTE: StylePalette = {
  bg: "#e8e5e1",
  fg: "#080a08",
  muted: "#77756d",
  line: "#aaa59a",
  accent: "#9b7247",
  surface: "#edebe4",
  panel: "#edebe4",
  veil: "rgba(232, 229, 225, 0.72)",
  well: "#e7e3d9",
  "fg-soft": "#44443e",
  "text-muted": "#77756d",
  mark: "#928e83",
  "line-dim": "#aaa59a",
  "line-faint": "#aaa59a",
  hair: "#aaa59a",
  "panel-hi": "#f4f1e9",
  case: "#edebe4",
  "case-hi": "#f4f1e9",
  "on-accent": "#fffaf1",
};

function rgbaFromHex(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function stylePalette(style: MusicStyle, mode: "day" | "night"): StylePalette {
  if (style.design === "rhine" && mode === "day" && style.dayPalette === "original")
    return { ...RHINE_ORIGINAL_DAY_PALETTE };
  if (style.design === "rhine") return { ...RHINE_PALETTES[mode] };
  if (style.scheme === "rhine") return { ...RHINE_PALETTES[mode] };

  const raw = TOKEN_SCHEMES[style.scheme]?.[mode === "day" ? "light" : "dark"];
  if (!raw) return { ...RHINE_PALETTES[mode] };
  return {
    ...raw,
    bg: raw.bg,
    fg: raw.fg,
    muted: raw["text-muted"] ?? raw.fg,
    line: raw["line-faint"] ?? raw["line-dim"] ?? raw.fg,
    accent: raw.accent,
    panel: raw.panel,
    surface: raw.case ?? raw.well ?? raw.panel,
    veil: rgbaFromHex(raw.bg, 0.76),
    well: raw.well ?? raw.case ?? raw.panel,
  };
}

const PALETTE_CSS_PROPERTIES = [
  "--ink",
  "--muted",
  "--line",
  "--accent",
  "--surface",
  "--panel",
  "--page-bg",
  "--veil",
  "--fg-soft",
  "--text-muted",
  "--mark",
  "--line-dim",
  "--line-faint",
  "--hair",
  "--panel-hi",
  "--case",
  "--case-hi",
  "--well",
  "--on-accent",
  "--text-scale",
  "--array-scale",
  "--inspect-scale",
  ...Object.values(TOKEN_SCHEMES)
    .flatMap((scheme) => [scheme.light, scheme.dark])
    .flatMap((tokens) => Object.keys(tokens)
      .filter((key) => !["bg", "fg", "muted", "line", "accent", "panel", "surface", "veil", "well"].includes(key))
      .map((key) => `--${key}`)),
];

const STYLE_DATASET_KEYS = [
  "camera",
  "scheme",
  "styleCase",
  "styleShelf",
  "styleDirection",
  "styleFloor",
  "styleArrayScale",
  "styleInspectScale",
  "styleTextScale",
  "styleTopTitles",
  "styleGrain",
] as const;

export function applyStylePalette(
  stage: HTMLElement,
  styleValue: MusicStyle,
  mode: "day" | "night",
) {
  const style = normalizeMusicStyle(styleValue);
  stage.dataset.design = style.design;

  if (style.design === "rhine") {
    for (const key of STYLE_DATASET_KEYS) delete stage.dataset[key];
    for (const property of new Set(PALETTE_CSS_PROPERTIES)) {
      stage.style.removeProperty(property);
    }
    stage.dataset.futureDayPalette = style.dayPalette;
    return;
  }

  delete stage.dataset.futureDayPalette;

  stage.dataset.camera = style.camera;
  stage.dataset.scheme = style.scheme;
  stage.dataset.styleCase = style.caseStyle;
  stage.dataset.styleShelf = String(style.shelf);
  stage.dataset.styleDirection = style.direction;
  stage.dataset.styleFloor = style.floor;
  stage.dataset.styleArrayScale = String(style.arrayScale);
  stage.dataset.styleInspectScale = String(style.inspectScale);
  stage.dataset.styleTextScale = String(style.textScale);
  stage.dataset.styleTopTitles = String(style.topTitles);
  stage.dataset.styleGrain = String(style.grain);
  stage.style.setProperty("--text-scale", String(style.textScale));
  stage.style.setProperty("--array-scale", String(style.arrayScale));
  stage.style.setProperty("--inspect-scale", String(style.inspectScale));

  const palette = stylePalette(style, mode);
  const properties: Record<string, string> = {
    "--ink": palette.fg,
    "--muted": palette.muted,
    "--line": palette.line,
    "--accent": palette.accent,
    "--surface": palette.surface,
    "--panel": palette.panel,
    "--page-bg": palette.bg,
    "--veil": palette.veil,
  };
  for (const key of Object.keys(palette)) {
    if (key in properties || key === "bg" || key === "fg" || key === "muted" || key === "line" || key === "accent" || key === "panel" || key === "surface" || key === "veil" || key === "well") continue;
    properties[`--${key}`] = palette[key];
  }
  properties["--well"] = palette.well;
  for (const [property, value] of Object.entries(properties)) {
    stage.style.setProperty(property, value);
  }
}

const SCHEME_COPY: Record<ColourScheme, { name: string; zh: string; en: string; noteZh: string; noteEn: string }> = {
  archive: { name: "ARCHIVE", zh: "纸本档案", en: "Archive", noteZh: "纸色与深空，点缀档案橙。", noteEn: "Paper and void with archive orange." },
  hazard: { name: "HAZARD", zh: "工业警示", en: "Hazard", noteZh: "黑黄工业配色。", noteEn: "Black and yellow industrial tones." },
  flare: { name: "FLARE", zh: "熔橙闪光", en: "Flare", noteZh: "鲜亮橙色，浅色页面本身也呈橙色。", noteEn: "Vibrant orange, with an orange light page." },
  field: { name: "FIELD", zh: "草木现场", en: "Field", noteZh: "绿色点缀落在微绿纸面上。", noteEn: "Fresh green on green-tinted paper." },
  front: { name: "COLD FRONT", zh: "冷锋蓝调", en: "Cold Front", noteZh: "冷静的蓝色界面。", noteEn: "A cool front of blue." },
  hearth: { name: "HEARTH", zh: "胡桃烛光", en: "Hearth", noteZh: "胡桃木与烛光的暖色调，适配真实场景。", noteEn: "Walnut wood and candlelight, tuned for REAL STYLE." },
  rhine: { name: "RHINE", zh: "莱茵原色", en: "Rhine", noteZh: "当前播放器的日夜配色。", noteEn: "The current Rhine day and night palette." },
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function paletteStyle(palette: StylePalette) {
  return [
    `--mini-bg:${palette.bg}`,
    `--mini-fg:${palette.fg}`,
    `--mini-muted:${palette.muted}`,
    `--mini-line:${palette.line}`,
    `--mini-accent:${palette.accent}`,
    `--mini-panel:${palette.panel}`,
    `--mini-surface:${palette.surface}`,
    `--mini-well:${palette.well}`,
  ].join(";");
}

function miniUiMarkup(scheme: ColourScheme, mode: "day" | "night", style: MusicStyle) {
  const palette = stylePalette({ ...style, scheme }, mode);
  const tag = mode === "day" ? t("日光", "DAY") : t("夜色", "NIGHT");
  return `<div class="style-mini-ui" style="${escapeHtml(paletteStyle(palette))}" aria-label="${escapeHtml(tag)}">
    <header><i></i><b>ARCHIVE</b><span>COLLECTION&nbsp;&nbsp; SIGNAL</span><em>${escapeHtml(tag)}</em></header>
    <div class="style-mini-body"><nav><i></i><i></i><i></i><i></i></nav><div class="style-mini-rows"><small>ARCHIVE / 05</small>${[0, 1, 2, 3].map((row) => `<div class="style-mini-row${row === 1 ? " is-active" : ""}"><i></i><span></span><b>${String(row + 1).padStart(2, "0")}</b></div>`).join("")}</div><div class="style-mini-record"><div></div><i></i><span></span></div></div>
    <footer><i></i><span></span><b>00:42</b></footer>
  </div>`;
}

function swatchesMarkup(scheme: ColourScheme, style: MusicStyle, mode: "day" | "night") {
  const palette = stylePalette({ ...style, scheme }, mode);
  const keys = [
    ["bg", t("页面", "PAGE")],
    ["fg", t("文字", "TEXT")],
    ["fg-soft", t("次级文字", "SOFT")],
    ["text-muted", t("弱文字", "MUTED")],
    ["line-dim", t("分隔线", "RULE")],
    ["accent", t("强调色", "ACCENT")],
  ] as const;
  return `<div class="style-swatches" aria-label="${escapeHtml(t("当前模式色板", "Current mode swatches"))}">${keys.map(([key, label]) => {
    const color = key === "bg" ? palette.bg : key === "fg" ? palette.fg : palette[key] ?? palette.muted;
    return `<div class="style-swatch"><i style="background:${escapeHtml(color)}"></i><span>${escapeHtml(label)}</span></div>`;
  }).join("")}</div>`;
}

function schemeSwatchesMarkup(scheme: ColourScheme, style: MusicStyle) {
  return `<div class="style-dual-swatches foobar-dual-swatches">${(["day", "night"] as const).map((mode) => {
    const label = mode === "day" ? t("日光", "DAY") : t("夜色", "NIGHT");
    return `<div><small>${escapeHtml(label)}</small>${swatchesMarkup(scheme, style, mode)}</div>`;
  }).join("")}</div>`;
}

function schemePreviewMarkup(scheme: ColourScheme, style: MusicStyle, mode: "day" | "night") {
  const copy = SCHEME_COPY[scheme];
  const modes: readonly ("day" | "night")[] = mode === "day" ? ["day", "night"] : ["night", "day"];
  return `<div class="style-preview-scheme">
    <div class="style-mini-pair foobar-mini-pair">${modes.map((previewMode) => miniUiMarkup(scheme, previewMode, style)).join("")}</div>
    <div class="style-preview-copy"><small>${escapeHtml(t("配色预览", "COLOUR PREVIEW"))}</small><h3>${escapeHtml(LANG() === "en" ? copy.en : copy.zh)}</h3><p>${escapeHtml(LANG() === "en" ? copy.noteEn : copy.noteZh)}</p><span>${escapeHtml(copy.name)}</span></div>
    ${schemeSwatchesMarkup(scheme, style)}
  </div>`;
}

function previewMarkup(style: MusicStyle, mode: "day" | "night", hover: PreviewChoice | null) {
  return schemePreviewMarkup(hover?.id ?? style.scheme, style, mode);
}

function selectMarkup(
  field: keyof MusicStyle,
  value: string | number,
  options: readonly (readonly [string | number, string])[],
  label: string,
  hint?: string,
) {
  return `<label class="style-setting-row"><span>${escapeHtml(label)}${hint ? `<small>${escapeHtml(hint)}</small>` : ""}</span><select data-style-field="${field}" aria-label="${escapeHtml(label)}">${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}"${String(value) === String(optionValue) ? " selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select></label>`;
}

function switchMarkup(
  field: "shelf" | "topTitles" | "grain",
  checked: boolean,
  label: string,
  hint?: string,
  disabled = false,
) {
  return `<label class="style-setting-row style-switch-row"><span>${escapeHtml(label)}${hint ? `<small>${escapeHtml(hint)}</small>` : ""}</span><input type="checkbox" role="switch" data-style-field="${field}" aria-label="${escapeHtml(label)}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}/></label>`;
}

function schemeCardMarkup(scheme: ColourScheme, style: MusicStyle) {
  const copy = SCHEME_COPY[scheme];
  const selected = style.scheme === scheme;
  return `<button type="button" class="style-scheme-card foobar-scheme-card${selected ? " is-selected" : ""}" data-style-scheme="${scheme}" aria-pressed="${selected}" aria-label="${escapeHtml(LANG() === "en" ? copy.en : copy.zh)}">
    <div class="style-scheme-mock-row">${miniUiMarkup(scheme, "day", style)}${miniUiMarkup(scheme, "night", style)}</div><span class="style-scheme-name"><i style="--scheme-mark:${escapeHtml(stylePalette({ ...style, scheme }, "day").accent)}"></i><b>${escapeHtml(copy.name)}</b><small>${escapeHtml(LANG() === "en" ? copy.en : copy.zh)}</small></span>${selected ? `<em class="style-in-use">${escapeHtml(t("使用中", "IN USE"))}</em>` : ""}
  </button>`;
}

export function musicAppearanceControlsMarkup(style: MusicStyle, mode: "day" | "night") {
  return style.design === "rhine"
    ? futureAppearancePickerMarkup(style.dayPalette, mode)
    : `<div class="theme-mode-buttons" role="group" aria-label="${escapeHtml(t("日夜模式", "Light and dark mode"))}">
      <button type="button" data-theme="day" aria-pressed="${mode === "day"}"><i class="theme-mode-dot day" aria-hidden="true"></i>LIGHT</button>
      <button type="button" data-theme="night" aria-pressed="${mode === "night"}"><i class="theme-mode-dot night" aria-hidden="true"></i>DARK</button>
    </div>`;
}

function designFamilyMarkup(style: MusicStyle, mode: "day" | "night", followSystemTheme: boolean) {
  const choices = (["rhine", "archive"] as const).map(design => {
    const selected = style.design === design;
    const label = design === "rhine" ? t("莱茵生命：映像", "Rhine: Imagine") : t("仿孤星", "Lone Trail Like");
    const preview = selected ? style : design === "rhine" ? defaultMusicStyle : archiveMusicStyle;
    const palette = stylePalette(preview, mode);
    return `<button type="button" class="design-family-card${selected ? " is-selected" : ""}" data-style-design="${design}" aria-pressed="${selected}" aria-label="${label}">
      <span class="theme-choice-preview" data-preview-design="${design}" data-preview-mode="${mode}" style="${escapeHtml(paletteStyle(palette))}" aria-hidden="true"><i class="theme-choice-nav"></i><span class="theme-choice-scene"><i></i><i></i><i></i></span><span class="theme-choice-info"><i></i><i></i><i></i></span><i class="theme-choice-deck"></i></span>
      <span class="theme-choice-copy"><strong>${label}</strong><small>${escapeHtml(design === "rhine" ? t("轻透材质与柔和层次", "TRANSLUCENT · SPATIAL") : t("仪表排版与档案细节", "INSTRUMENT · ARCHIVE"))}</small></span><i class="theme-choice-check" aria-hidden="true">${selected ? "✓" : ""}</i>
    </button>`;
  }).join("");
  const themeControls = musicAppearanceControlsMarkup(style, mode);
  const modeControls = `<aside class="theme-mode-controls" aria-labelledby="theme-mode-title">
    <div class="theme-mode-heading"><small>APPEARANCE</small><h3 id="theme-mode-title">${escapeHtml(t("日夜模式", "Light and dark mode"))}</h3></div>
    ${themeControls}
    <label class="theme-follow-system"><span>${escapeHtml(t("跟随系统", "Follow system"))}</span><input type="checkbox" role="switch" data-follow-system-theme aria-label="${escapeHtml(t("跟随系统日夜模式", "Follow system light and dark mode"))}"${followSystemTheme ? " checked" : ""}></label>
    <p class="theme-mode-hint">${escapeHtml(t("系统切换时跟随，手动选择仍会保留。", "Follow system changes while keeping manual choices."))}</p>
  </aside>`;
  return `<section class="design-family-section" aria-label="${escapeHtml(t("完整主题", "Complete themes"))}"><div class="style-section-heading"><div><small>COMPLETE THEMES</small><h2>${escapeHtml(t("选择主题", "Choose a theme"))}</h2></div></div><div class="design-family-layout"><div class="design-family-grid">${choices}</div>${modeControls}</div></section>`;
}

function archiveMusicStyleMarkup(style: MusicStyle, mode: "day" | "night", followSystemTheme: boolean): string {
  const current = `${SCHEME_COPY[style.scheme].name}  ·  ${mode === "day" ? "LIGHT" : "DARK"}`;
  const textOptions = TEXT_SCALES.map((value) => [value, textScaleLabel(value)] as const);
  const arrayOptions = ARRAY_SCALES.map((value) => [value, textScaleLabel(value)] as const);
  const inspectOptions = INSPECT_SCALES.map((value) => [value, textScaleLabel(value)] as const);
  return `<section class="music-style-page foobar-style-page" aria-labelledby="music-style-title">
    <header class="music-style-heading foobar-style-heading">
      <div class="foobar-style-heading-copy">
        <small class="foobar-style-kicker"><i></i>STYLE&nbsp; · &nbsp;05</small>
        <h1 id="music-style-title">STYLE</h1>
        <p>${escapeHtml(t("主题、配色、文字大小、唱片盒与场景外观均实时更新。", "Theme, colour, text size, album case and scene appearance update live."))}</p>
      </div>
      <div class="foobar-style-heading-tools">
        <span class="foobar-style-current" title="${escapeHtml(current)}"><i></i>${escapeHtml(current)}</span>
      </div>
    </header>
    ${designFamilyMarkup(style, mode, followSystemTheme)}
    <div class="foobar-style-rule" aria-hidden="true"></div>
    <div class="foobar-style-main">
      <div class="foobar-style-library">
        <section class="foobar-style-section" aria-labelledby="style-scheme-heading">
          <div class="foobar-style-section-heading"><div><small>01&nbsp; / &nbsp;COLOUR STUDIES</small><h2 id="style-scheme-heading">COLOUR SCHEME</h2></div><span>06</span></div>
          <div class="style-scheme-grid foobar-scheme-grid">${SCHEMES.map((scheme) => schemeCardMarkup(scheme, style)).join("")}</div>
        </section>
        <section class="foobar-style-display" aria-labelledby="style-display-heading">
          <div class="foobar-style-section-heading"><div><small>02&nbsp; / &nbsp;TEXT &amp; SCENE</small><h2 id="style-display-heading">${escapeHtml(t("文字与场景外观", "TEXT & SCENE"))}</h2></div><span>${escapeHtml(t("当前主题的外观选项", "CURRENT THEME APPEARANCE OPTIONS"))}</span></div>
          <div class="foobar-display-grid">
            <div class="foobar-display-card"><small>TEXT</small>${selectMarkup("textScale", style.textScale, textOptions, t("文字尺寸", "Text size"))}</div>
            <div class="foobar-display-card"><small>ARRAY</small>${selectMarkup("arrayScale", style.arrayScale, arrayOptions, t("唱片阵列尺寸", "Array size"))}</div>
            <div class="foobar-display-card"><small>INSPECT</small>${selectMarkup("inspectScale", style.inspectScale, inspectOptions, t("细看尺寸", "Inspection size"))}</div>
            <div class="foobar-display-card"><small>FLOOR</small>${selectMarkup("floor", style.floor, [["plain", t("素色地面", "Plain floor")], ["deck", t("实验台", "Lab deck")], ["real", t("木质桌面", "Wood surface")]], t("场景地面", "Scene floor"))}</div>
            <div class="foobar-display-card foobar-display-details"><small>${escapeHtml(t("外观细节", "APPEARANCE DETAILS"))}</small>${switchMarkup("grain", style.grain, t("细颗粒质感", "Fine grain"))}</div>
          </div>
        </section>
      </div>
      <aside class="music-style-preview foobar-style-preview" aria-label="${escapeHtml(t("外观预览", "Style preview"))}">
        <div class="style-preview-heading foobar-style-preview-heading"><small data-style-preview-label>${escapeHtml(t("使用中", "IN USE"))}</small><span>${escapeHtml(t("悬停或聚焦卡片以预览", "HOVER OR FOCUS A CARD TO PREVIEW"))}</span></div>
        <div class="style-preview-content foobar-style-preview-content" data-style-preview-content>${previewMarkup(style, mode, null)}</div>
      </aside>
    </div>
    <div id="theme-quality-slot" class="style-native-quality"></div>
  </section>`;
}

export function musicStyleMarkup(styleValue: MusicStyle, mode: "day" | "night", followSystemTheme = false): string {
  const style = normalizeMusicStyle(styleValue);
  if (style.design === "archive") return archiveMusicStyleMarkup(style, mode, followSystemTheme);
  const modeName = mode === "day" ? "LIGHT" : "DARK";
  const heading = `<header class="music-style-heading"><div><small>STYLE&nbsp; / &nbsp;APPEARANCE</small><h1 id="music-style-title">STYLE</h1><p>${escapeHtml(t("调整主题、配色、文字大小，以及唱片盒与场景外观。", "Adjust the theme, colour scheme and text size, and customize the appearance of the album case and scene."))}</p></div><span class="style-mode-indicator"><i></i>${modeName}</span></header>`;
  const themeSelector = designFamilyMarkup(style, mode, followSystemTheme);
  const pageStart = `<section class="music-style-page" aria-labelledby="music-style-title">${heading}${themeSelector}`;
  return `${pageStart}<div id="theme-quality-slot" class="style-native-quality"></div></section>`;
}

/** Synchronize live STYLE controls without replacing their DOM or stealing focus. */
export function syncMusicStyleAppearance(
  root: HTMLElement,
  styleValue: MusicStyle,
  mode: "day" | "night",
  followSystemTheme: boolean,
): void {
  const style = normalizeMusicStyle(styleValue);
  for (const preview of root.querySelectorAll<HTMLElement>(".theme-choice-preview")) {
    const design = preview.dataset.previewDesign === "archive" ? "archive" : "rhine";
    const previewStyle = design === style.design
      ? style
      : design === "rhine" ? defaultMusicStyle : archiveMusicStyle;
    const palette = stylePalette(previewStyle, mode);
    const properties: Record<string, string> = {
      "--mini-bg": palette.bg,
      "--mini-fg": palette.fg,
      "--mini-muted": palette.muted,
      "--mini-line": palette.line,
      "--mini-accent": palette.accent,
      "--mini-panel": palette.panel,
      "--mini-surface": palette.surface,
      "--mini-well": palette.well,
    };
    for (const [property, value] of Object.entries(properties))
      preview.style.setProperty(property, value);
    preview.dataset.previewMode = mode;
  }
  root.querySelectorAll<HTMLButtonElement>("button[data-theme]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.theme === mode)),
  );
  root.querySelectorAll<HTMLInputElement>("[data-follow-system-theme]").forEach((control) => {
    control.checked = followSystemTheme;
  });
  syncFutureAppearancePicker(root, style.dayPalette, mode);
  const indicator = root.querySelector<HTMLElement>(".style-mode-indicator");
  if (indicator?.lastChild?.nodeType === Node.TEXT_NODE) indicator.lastChild.textContent = mode === "day" ? "LIGHT" : "DARK";
}

type PreviewChoice = { kind: "scheme"; id: ColourScheme };

function previewChoice(target: HTMLElement | null): PreviewChoice | null {
  if (!target) return null;
  if (isOneOf(target.dataset.styleScheme, SCHEMES)) {
    return { kind: "scheme", id: target.dataset.styleScheme };
  }
  return null;
}

function styleCardFrom(target: EventTarget | null, root: HTMLElement) {
  if (!(target instanceof Element)) return null;
  const card = target.closest<HTMLElement>("[data-style-scheme]");
  return card && root.contains(card) ? card : null;
}

export function setupStylePreview(
  root: HTMLElement,
  styleValue: MusicStyle,
  mode: "day" | "night",
): () => void {
  const previewContent = root.querySelector<HTMLElement>("[data-style-preview-content]");
  if (!previewContent) return () => {};

  const style = normalizeMusicStyle(styleValue);
  let pointerChoice: PreviewChoice | null = null;
  let focusChoice: PreviewChoice | null = previewChoice(styleCardFrom(root.ownerDocument.activeElement, root));
  const draw = () => {
    previewContent.innerHTML = previewMarkup(style, mode, pointerChoice ?? focusChoice);
  };
  const onPointerOver = (event: PointerEvent) => {
    pointerChoice = previewChoice(styleCardFrom(event.target, root));
    drawPreview();
  };
  const onPointerOut = (event: PointerEvent) => {
    const next = styleCardFrom(event.relatedTarget, root);
    pointerChoice = previewChoice(next);
    drawPreview();
  };
  const onFocusIn = (event: FocusEvent) => {
    focusChoice = previewChoice(styleCardFrom(event.target, root));
    drawPreview();
  };
  const onFocusOut = (event: FocusEvent) => {
    focusChoice = previewChoice(styleCardFrom(event.relatedTarget, root));
    drawPreview();
  };
  const previewLabel = root.querySelector<HTMLElement>("[data-style-preview-label]");
  const updatePreviewLabel = () => {
    if (!previewLabel) return;
    previewLabel.textContent = pointerChoice || focusChoice
      ? t("预览", "PREVIEW")
      : t("使用中", "IN USE");
  };

  const drawPreview = () => {
    draw();
    updatePreviewLabel();
  };

  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerout", onPointerOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  drawPreview();
  return () => {
    root.removeEventListener("pointerover", onPointerOver);
    root.removeEventListener("pointerout", onPointerOut);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
  };
}
