export const CASE_STRUCTURES = ["minimal", "rhine", "punk"] as const;
export type CaseStructure = typeof CASE_STRUCTURES[number];

export type CasePart =
  | "frame"
  | "cover"
  | "back"
  | "accent"
  | "spine"
  | "clip"
  | "fasteners"
  | "emblem"
  | "label"
  | "ink"
  | "trim"
  | "ruler"
  | "vents"
  | "lettering"
  | "optics"
  | "film"
  | "filmEdge"
  | "amber"
  | "ceramic"
  | "rim"
  | "trimHighlight";

export type CaseFinish = "glass" | "frost" | "metal" | "paint";
export type CasePattern = "none" | "marble" | "carbon" | "gradient" | "brushed";
export type CaseVector3 = [number, number, number];
export type CaseTransform = {
  visible: boolean;
  /** Translation in scene model units. */
  offset: CaseVector3;
  /** Euler angles in degrees. */
  rotation: CaseVector3;
  scale: CaseVector3;
};

export type CaseSurface = {
  finish: CaseFinish;
  color: string;
  roughness: number;
  transmission: number;
  ior: number;
  emission: number;
  pattern?: CasePattern;
  secondaryColor?: string;
  gradientAngle?: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  iridescence?: number;
  thickness?: number;
  attenuationDistance?: number;
  preserveSource?: boolean;
  /** Optional Rhine-only optical overrides; keep the underlying source material. */
  transmissionOverride?: number;
  opacityOverride?: number;
};

export type CaseAppearance = {
  preset: string;
  presetRevision?: number;
  surfaces: Record<CasePart, CaseSurface>;
  transforms?: Partial<Record<CasePart, CaseTransform>>;
};

export type CaseSettings = {
  version: 1;
  enabled: boolean;
  structure: CaseStructure;
  appearances: Record<CaseStructure, CaseAppearance>;
};

export type CaseProfiles = Record<"rhine" | "archive", CaseSettings>;

/** Future can borrow Punk's case; Punk always uses its own structure. */
export function caseStructuresForDesign(design: "rhine" | "archive"): readonly CaseStructure[] {
  return design === "archive" ? ["punk"] : CASE_STRUCTURES;
}

const CORE_PARTS = ["frame", "cover", "back", "accent"] as const satisfies readonly CasePart[];
const MINIMAL_PARTS = ["frame", "cover", "back"] as const satisfies readonly CasePart[];
const PUNK_PARTS = [
  ...CORE_PARTS,
  "spine",
  "clip",
  "fasteners",
  "optics",
  "emblem",
  "label",
  "ink",
  "trim",
  "ruler",
  "vents",
  "lettering",
] as const satisfies readonly CasePart[];
const RHINE_PARTS = [
  ...CORE_PARTS,
  "fasteners",
  "trim",
  "trimHighlight",
  "lettering",
  "label",
  "ink",
] as const satisfies readonly CasePart[];
const ALL_PARTS = [
  ...PUNK_PARTS,
  "film",
  "filmEdge",
  "amber",
  "ceramic",
  "rim",
  "trimHighlight",
] as const satisfies readonly CasePart[];

export function casePartsForStructure(structure: CaseStructure): CasePart[] {
  if (structure === "punk") return [...PUNK_PARTS];
  if (structure === "rhine") return [...RHINE_PARTS];
  return [...MINIMAL_PARTS];
}

export const caseStructureLabels: Record<CaseStructure, string> = {
  minimal: "简单粗糙",
  rhine: "精细",
  punk: "Punk拓展",
};

export const casePartLabels: Record<CasePart, string> = {
  frame: "外框",
  cover: "正面封装玻璃",
  back: "背板 / 内衬",
  accent: "标记与装饰",
  spine: "右侧内板",
  clip: "卡扣",
  fasteners: "螺钉与紧固件",
  emblem: "徽记",
  label: "标签板",
  ink: "标签墨层",
  trim: "饰条",
  ruler: "刻度线",
  vents: "通风槽",
  lettering: "字标",
  optics: "光学件",
  film: "透明薄片",
  filmEdge: "薄片边缘",
  amber: "琥珀透光件",
  ceramic: "陶瓷件",
  rim: "内沿",
  trimHighlight: "饰条高光",
};

export const caseFinishLabels: Record<CaseFinish, string> = {
  glass: "透明玻璃",
  frost: "磨砂玻璃",
  metal: "金属",
  paint: "涂层",
};

export const casePatternLabels: Record<CasePattern, string> = {
  none: "无纹理",
  marble: "大理石",
  carbon: "碳纤维",
  gradient: "渐变",
  brushed: "拉丝",
};

export const CASE_PUNK_RECONSTRUCTION_NOTE =
  "依据多视角图重建，材质参数为估算。";

const surface = (
  finish: CaseFinish,
  color: string,
  roughness: number,
  transmission = 0,
  emission = 0,
  options: Partial<CaseSurface> = {},
): CaseSurface => ({
  finish,
  color,
  roughness,
  transmission,
  emission,
  ior: 1.46,
  pattern: "none",
  secondaryColor: color,
  gradientAngle: 90,
  metalness: finish === "metal" ? 0.48 : 0,
  clearcoat: finish === "glass" ? 0.3 : 0.12,
  clearcoatRoughness: options.clearcoatRoughness ?? roughness,
  iridescence: 0,
  thickness: 0.22,
  attenuationDistance: 2.5,
  preserveSource: false,
  ...options,
});

type SkinPalette = {
  frame: string;
  frameSecondary: string;
  frameFinish: CaseFinish;
  framePattern: CasePattern;
  frameRoughness: number;
  frameTransmission: number;
  frameMetalness: number;
  frameClearcoat: number;
  frameClearcoatRoughness: number;
  cover: string;
  coverFinish: "glass" | "frost";
  coverRoughness: number;
  coverTransmission: number;
  back: string;
  backSecondary: string;
  backPattern: CasePattern;
  accent: string;
  accentSecondary: string;
  accentFinish: CaseFinish;
  interior: string;
  highlight: string;
  ink: string;
  emblem: string;
  amber: string;
  opticsTransmission: number;
  filmTransmission: number;
  thickness: number;
  attenuationDistance: number;
  iridescence: number;
};

function punkSurfaces(palette: SkinPalette): Record<CasePart, CaseSurface> {
  const frame = surface(
    palette.frameFinish,
    palette.frame,
    palette.frameRoughness,
    palette.frameTransmission,
    0,
    {
      pattern: palette.framePattern,
      secondaryColor: palette.frameSecondary,
      metalness: palette.frameMetalness,
      clearcoat: palette.frameClearcoat,
      clearcoatRoughness: palette.frameClearcoatRoughness,
      iridescence: palette.iridescence,
      thickness: palette.thickness,
      attenuationDistance: palette.attenuationDistance,
    },
  );
  const cover = surface(
    palette.coverFinish,
    palette.cover,
    palette.coverRoughness,
    palette.coverTransmission,
    0,
    {
      secondaryColor: palette.highlight,
      metalness: 0,
      clearcoat: 0.72,
      iridescence: palette.iridescence * 0.4,
      thickness: palette.thickness,
      attenuationDistance: palette.attenuationDistance,
    },
  );
  const back = surface(
    "paint",
    palette.back,
    0.58,
    0,
    0,
    { secondaryColor: palette.backSecondary, pattern: palette.backPattern },
  );
  const accent = surface(
    palette.accentFinish,
    palette.accent,
    palette.accentFinish === "metal" ? 0.26 : 0.3,
    palette.accentFinish === "glass" ? 0.34 : 0,
    0,
    {
      secondaryColor: palette.accentSecondary,
      metalness: palette.accentFinish === "metal" ? 0.68 : 0.04,
      clearcoat: 0.36,
    },
  );
  const opaqueMetal = (color = palette.highlight) =>
    surface("metal", color, 0.28, 0, 0, {
      secondaryColor: palette.accent,
      metalness: 0.72,
      clearcoat: 0.34,
    });
  const labelSurface = surface("paint", "#afadac", 0.48, 0, 0, {
    secondaryColor: palette.highlight,
  });
  const ink = surface("paint", palette.ink, 0.74, 0, 0, {
    secondaryColor: palette.accent,
  });
  const amber = surface("glass", palette.amber, 0.24, 0.38, 0, {
    secondaryColor: palette.accent,
    metalness: 0,
    clearcoat: 0.58,
    thickness: palette.thickness * 0.72,
    attenuationDistance: palette.attenuationDistance * 0.72,
  });
  const optics = surface("glass", palette.cover, 0.12, palette.opticsTransmission, 0, {
    secondaryColor: palette.highlight,
    metalness: 0,
    clearcoat: 0.8,
    iridescence: palette.iridescence,
    thickness: palette.thickness,
    attenuationDistance: palette.attenuationDistance,
  });
  const film = surface(
    palette.coverFinish,
    palette.cover,
    palette.coverRoughness,
    palette.filmTransmission,
    0,
    {
      secondaryColor: palette.highlight,
      metalness: 0,
      clearcoat: 0.64,
      thickness: palette.thickness * 0.5,
      attenuationDistance: palette.attenuationDistance,
    },
  );
  const ceramic = surface("paint", palette.interior, 0.42, 0, 0, {
    secondaryColor: palette.highlight,
    clearcoat: 0.28,
  });

  const surfaces: Record<CasePart, CaseSurface> = {
    frame,
    cover,
    back,
    accent,
    spine: surface("paint", palette.interior, 0.42, 0, 0, {
      pattern: palette.backPattern,
      secondaryColor: palette.backSecondary,
      metalness: .06,
      clearcoat: .12,
      thickness: .025,
    }),
    clip: opaqueMetal(),
    fasteners: opaqueMetal(palette.highlight),
    emblem: surface("paint", "#e4e4e2", .36, 0, 0, { metalness: .04, clearcoat: .16 }),
    label: labelSurface,
    ink,
    trim: surface("paint", "#d0d0cd", .55, 0, 0, { clearcoat: .06 }),
    ruler: surface("paint", "#d4d4d1", .55, 0, 0, { clearcoat: .06 }),
    vents: surface("paint", "#515250", .65, 0, 0, { metalness: .05 }),
    lettering: surface("paint", "#c2c2bf", .65, 0, 0),
    optics,
    film,
    filmEdge: opaqueMetal(palette.accent),
    amber,
    ceramic,
    rim: opaqueMetal(palette.frameSecondary),
    trimHighlight: opaqueMetal(palette.highlight),
  };
  return surfaces;
}

function originalSurfaces(): Record<CasePart, CaseSurface> {
  const frame = surface("frost", "#e6ddd1", 0.34, 0.66);
  const cover = surface("frost", "#f3f0e9", 0.48, 0.88);
  const back = surface("frost", "#eee8df", 0.46, 0.56);
  const accent = surface("paint", "#e7a335", 0.28, 0, 0.08);
  const paleMetal = (color = "#e7e2d7") =>
    surface("metal", color, 0.3, 0, 0, { metalness: 0.48, clearcoat: 0.3 });
  const ink = surface("paint", "#35322e", 0.72, 0, 0);
  const surfaces: Record<CasePart, CaseSurface> = {
    frame,
    cover,
    back,
    accent,
    spine: surface("frost", "#e6ddd1", 0.34, 0.66),
    clip: paleMetal(),
    fasteners: paleMetal("#c8c1b7"),
    emblem: surface("paint", "#e7a335", 0.28, 0, 0.08),
    label: surface("paint", "#eee8df", 0.52, 0),
    ink,
    trim: paleMetal("#d3c9bd"),
    ruler: surface("paint", "#d8a34b", 0.42, 0),
    vents: paleMetal("#d9d1c6"),
    lettering: surface("paint", "#35322e", 0.72, 0, 0),
    optics: surface("glass", "#f5f1e8", 0.18, 0.86, 0, { clearcoat: 0.64 }),
    film: surface("frost", "#f3f0e9", 0.48, 0.88),
    filmEdge: paleMetal("#d3c9bd"),
    amber: surface("glass", "#e7a335", 0.24, 0.46, 0.02, { attenuationDistance: 1.5 }),
    ceramic: surface("paint", "#e6ddd1", 0.42, 0, 0, { clearcoat: 0.24 }),
    rim: paleMetal("#d8d0c5"),
    trimHighlight: paleMetal("#f3f0e9"),
  };
  for (const part of RHINE_PARTS) surfaces[part].preserveSource = true;
  return surfaces;
}

const punkNote = CASE_PUNK_RECONSTRUCTION_NOTE;
// Independent colors for the recessed inlay and the mounted top clip. These
// are material estimates calibrated against the source hero renders.
const punkComponents: Record<string, { inlay: string; clip: string; clipFinish?: CaseFinish }> = {
  marble: { inlay: "#c3c3c2", clip: "#d45f17" },
  hazard: { inlay: "#242423", clip: "#d39540" },
  white: { inlay: "#c7c7c7", clip: "#797a7a" },
  glass: { inlay: "#636d63", clip: "#527e7b", clipFinish: "glass" },
  frost: { inlay: "#a87750", clip: "#757478", clipFinish: "frost" },
  red: { inlay: "#8c929b", clip: "#c0c0c0" },
  blue: { inlay: "#6c99e8", clip: "#5c92ff" },
  coral: { inlay: "#9b9b9b", clip: "#c2bfc0" },
  tide: { inlay: "#75a1f1", clip: "#5c92ff" },
  aurora: { inlay: "#9b9b9b", clip: "#28507a" },
};
const punkPreset = (
  id: string,
  label: string,
  palette: SkinPalette,
) => {
  const surfaces = punkSurfaces(palette), component = punkComponents[id];
  surfaces.spine.color = component.inlay;
  surfaces.spine.secondaryColor = id === "marble" ? "#7e807f" : id === "hazard" ? "#3b3b38" : component.inlay;
  surfaces.clip = surface(component.clipFinish ?? "paint", component.clip, .28,
    component.clipFinish === "glass" ? .46 : component.clipFinish === "frost" ? .24 : 0, 0,
    { metalness: .02, clearcoat: .24, thickness: .16, attenuationDistance: 2 });
  surfaces.cover = surface("glass", "#ffffff", id === "frost" ? .14 : .06, .985, 0,
    { metalness: 0, clearcoat: .16, thickness: .018, attenuationDistance: 12, iridescence: 0 });
  surfaces.accent = surface("paint", id === "hazard" ? "#d7a445" : "#d88c4e", .42, 0, 0, { metalness: .04 });
  surfaces.ink = surface("paint", "#30312f", .72, 0, 0);
  surfaces.frame.iridescence = id === "aurora" ? palette.iridescence : 0;
  surfaces.frame.gradientAngle = id === "aurora" ? -12 : id === "tide" ? 0 : 90;
  if (id === "hazard") {
    surfaces.ruler.color = "#cfa750";
    surfaces.trim.color = "#bc9748";
    surfaces.lettering.color = "#c7a655";
  }
  return { label, note: punkNote, structure: "punk" as const, surfaces };
};

export const caseAppearancePresets: Record<
  string,
  {
    label: string;
    note: string;
    structure: "rhine" | "punk";
    surfaces: Record<CasePart, CaseSurface>;
  }
> = {
  original: {
    label: "Rhine 原始材质",
    note: "使用 Rhine GLB 模型原始材质；关闭部件开关后可自定义。",
    structure: "rhine",
    surfaces: originalSurfaces(),
  },
  marble: punkPreset("marble", "大理石", {
    frame: "#b5b5b5", frameSecondary: "#6e716f", frameFinish: "paint", framePattern: "marble",
    frameRoughness: 0.32, frameTransmission: 0, frameMetalness: 0.06, frameClearcoat: 0.3, frameClearcoatRoughness: 0.11,
    cover: "#f8f8f4", coverFinish: "glass", coverRoughness: 0.14, coverTransmission: 0.94,
    back: "#eeece5", backSecondary: "#aaa9a1", backPattern: "marble", accent: "#db8a48",
    accentSecondary: "#f0bc7e", accentFinish: "metal", interior: "#f1efe9", highlight: "#fbfaf6",
    ink: "#454540", emblem: "#e7e1d4", amber: "#e3a264", opticsTransmission: 0.86,
    filmTransmission: 0.82, thickness: 0.16, attenuationDistance: 3.5, iridescence: 0.08,
  }),
  hazard: punkPreset("hazard", "危标碳纤", {
    frame: "#2e2d28", frameSecondary: "#5a5953", frameFinish: "metal", framePattern: "carbon",
    frameRoughness: 0.38, frameTransmission: 0, frameMetalness: 0.55, frameClearcoat: 0.24, frameClearcoatRoughness: 0.24,
    cover: "#dfe4e4", coverFinish: "glass", coverRoughness: 0.18, coverTransmission: 0.93,
    back: "#34373a", backSecondary: "#55595c", backPattern: "carbon", accent: "#f1b92e",
    accentSecondary: "#ffe18b", accentFinish: "metal", interior: "#292d30", highlight: "#e8e8e2",
    ink: "#202326", emblem: "#f1bd35", amber: "#f0ae28", opticsTransmission: 0.88,
    filmTransmission: 0.8, thickness: 0.18, attenuationDistance: 3.2, iridescence: 0.04,
  }),
  white: punkPreset("white", "霜白陶瓷", {
    frame: "#c1c1c1", frameSecondary: "#b8b9b8", frameFinish: "paint", framePattern: "none",
    frameRoughness: 0.36, frameTransmission: 0, frameMetalness: 0.04, frameClearcoat: 0.38, frameClearcoatRoughness: 0.12,
    cover: "#fbfaf5", coverFinish: "glass", coverRoughness: 0.14, coverTransmission: 0.95,
    back: "#eff0ec", backSecondary: "#d9dad6", backPattern: "none", accent: "#d7a15a",
    accentSecondary: "#f0d39a", accentFinish: "metal", interior: "#eeeeea", highlight: "#ffffff",
    ink: "#585954", emblem: "#e9e6dd", amber: "#e9b35c", opticsTransmission: 0.9,
    filmTransmission: 0.84, thickness: 0.14, attenuationDistance: 4.5, iridescence: 0.08,
  }),
  glass: punkPreset("glass", "薄荷透明", {
    frame: "#a4aba3", frameSecondary: "#74937d", frameFinish: "glass", framePattern: "none",
    frameRoughness: 0.16, frameTransmission: 0.58, frameMetalness: 0, frameClearcoat: 0.74, frameClearcoatRoughness: 0.065,
    cover: "#f2faf6", coverFinish: "glass", coverRoughness: 0.1, coverTransmission: 0.96,
    back: "#d7e0db", backSecondary: "#b7cbc3", backPattern: "none", accent: "#46aa98",
    accentSecondary: "#9de2d0", accentFinish: "glass", interior: "#d4dcd7", highlight: "#f7fbf9",
    ink: "#46544f", emblem: "#eaf4f0", amber: "#e8a765", opticsTransmission: 0.9,
    filmTransmission: 0.84, thickness: 0.24, attenuationDistance: 1.8, iridescence: 0.18,
  }),
  frost: punkPreset("frost", "雾霜琥珀", {
    frame: "#8e8a84", frameSecondary: "#959894", frameFinish: "frost", framePattern: "none",
    frameRoughness: 0.42, frameTransmission: 0.34, frameMetalness: 0, frameClearcoat: 0.3, frameClearcoatRoughness: 0.22,
    cover: "#f1eef2", coverFinish: "frost", coverRoughness: 0.58, coverTransmission: 0.76,
    back: "#e6b99b", backSecondary: "#d99771", backPattern: "none", accent: "#776b96",
    accentSecondary: "#b1a0cf", accentFinish: "metal", interior: "#e8c0a5", highlight: "#f7f4ef",
    ink: "#55535d", emblem: "#f4efe9", amber: "#d99160", opticsTransmission: 0.42,
    filmTransmission: 0.34, thickness: 0.28, attenuationDistance: 0.72, iridescence: 0.06,
  }),
  red: punkPreset("red", "烈焰红", {
    frame: "#f60000", frameSecondary: "#720a08", frameFinish: "metal", framePattern: "none",
    frameRoughness: 0.12, frameTransmission: 0, frameMetalness: 0.8, frameClearcoat: 0.6, frameClearcoatRoughness: 0.07,
    cover: "#f4f7f8", coverFinish: "glass", coverRoughness: 0.13, coverTransmission: 0.95,
    back: "#e4e7e8", backSecondary: "#c9ced0", backPattern: "none", accent: "#db120c",
    accentSecondary: "#ff7567", accentFinish: "metal", interior: "#e4e7e8", highlight: "#fafafa",
    ink: "#393b3d", emblem: "#ececeb", amber: "#df9a54", opticsTransmission: 0.9,
    filmTransmission: 0.86, thickness: 0.16, attenuationDistance: 3.7, iridescence: 0.05,
  }),
  blue: punkPreset("blue", "冰蓝金属", {
    frame: "#467ce1", frameSecondary: "#5886e6", frameFinish: "metal", framePattern: "brushed",
    frameRoughness: 0.3, frameTransmission: 0, frameMetalness: 0.6, frameClearcoat: 0.48, frameClearcoatRoughness: 0.1,
    cover: "#eef6ff", coverFinish: "glass", coverRoughness: 0.15, coverTransmission: 0.94,
    back: "#dae5f1", backSecondary: "#a9c3e6", backPattern: "none", accent: "#4e9be7",
    accentSecondary: "#c0d6f5", accentFinish: "metal", interior: "#dbe4ee", highlight: "#f7f8fb",
    ink: "#465464", emblem: "#edf3fb", amber: "#e7a65b", opticsTransmission: 0.86,
    filmTransmission: 0.82, thickness: 0.18, attenuationDistance: 3.1, iridescence: 0.12,
  }),
  coral: punkPreset("coral", "珊瑚暖粉", {
    frame: "#e88a6f", frameSecondary: "#e98e7e", frameFinish: "paint", framePattern: "none",
    frameRoughness: 0.3, frameTransmission: 0.08, frameMetalness: 0.04, frameClearcoat: 0.38, frameClearcoatRoughness: 0.14,
    cover: "#fff5f0", coverFinish: "glass", coverRoughness: 0.13, coverTransmission: 0.95,
    back: "#eee8e1", backSecondary: "#e5d1c6", backPattern: "none", accent: "#e58b77",
    accentSecondary: "#f8c4b1", accentFinish: "paint", interior: "#e9e5e0", highlight: "#fff9f5",
    ink: "#5d5652", emblem: "#f7eee8", amber: "#e8a36c", opticsTransmission: 0.88,
    filmTransmission: 0.84, thickness: 0.16, attenuationDistance: 3.5, iridescence: 0.08,
  }),
  tide: punkPreset("tide", "潮汐蓝绿", {
    frame: "#2869b4", frameSecondary: "#5aa6d6", frameFinish: "metal", framePattern: "gradient",
    frameRoughness: 0.3, frameTransmission: 0, frameMetalness: 0.38, frameClearcoat: 0.48, frameClearcoatRoughness: 0.1,
    cover: "#eaf7fb", coverFinish: "glass", coverRoughness: 0.14, coverTransmission: 0.93,
    back: "#c9e1ef", backSecondary: "#83c9d4", backPattern: "gradient", accent: "#45b6cb",
    accentSecondary: "#b3e2e7", accentFinish: "metal", interior: "#cee2ec", highlight: "#f2fbfc",
    ink: "#3f5660", emblem: "#f2f8f8", amber: "#e9a967", opticsTransmission: 0.86,
    filmTransmission: 0.82, thickness: 0.18, attenuationDistance: 2.8, iridescence: 0.3,
  }),
  aurora: punkPreset("aurora", "极光渐变", {
    frame: "#c9cabe", frameSecondary: "#566cff", frameFinish: "glass", framePattern: "gradient",
    frameRoughness: 0.2, frameTransmission: 0.28, frameMetalness: 0.04, frameClearcoat: 0.5, frameClearcoatRoughness: 0.085,
    cover: "#f2f7fc", coverFinish: "glass", coverRoughness: 0.1, coverTransmission: 0.96,
    back: "#dfe5f1", backSecondary: "#b6d0e6", backPattern: "gradient", accent: "#7ac8d4",
    accentSecondary: "#d8bff3", accentFinish: "glass", interior: "#e3e8ed", highlight: "#fbfbff",
    ink: "#51576a", emblem: "#f4f4f8", amber: "#e8a86a", opticsTransmission: 0.92,
    filmTransmission: 0.88, thickness: 0.2, attenuationDistance: 2.3, iridescence: 0.54,
  }),
};

export function casePreset(id: string, structure?: CaseStructure): CaseAppearance {
  const key = Object.hasOwn(caseAppearancePresets, id) ? id : "original";
  const targetStructure = structure ?? caseAppearancePresets[key].structure;
  const surfaces = structuredClone(caseAppearancePresets[key].surfaces);
  // Only the Punk reconstruction uses this slot for its clear emblem tube.
  // Rhine optical parts keep the existing finish when borrowing the palette.
  if (targetStructure === "punk" && key !== "original") {
    surfaces.optics = surface("glass", "#ffffff", .065, .995, 0,
      { metalness: 0, clearcoat: .08, clearcoatRoughness: .06, thickness: .012, attenuationDistance: 12, iridescence: 0 });
    // The source guide is a muted pink orange rather than a gold edge strip.
    // Keep Hazard's yellow filament and the borrowed Rhine palette unchanged.
    if (key !== "hazard") {
      surfaces.accent.color = "#df7c52";
      surfaces.accent.secondaryColor = surfaces.accent.color;
    }
  }
  for (const part of ALL_PARTS) {
    surfaces[part].preserveSource =
      targetStructure === "rhine" && key === "original" && RHINE_PARTS.includes(part as typeof RHINE_PARTS[number]);
  }
  return { preset: key, presetRevision: 4, surfaces };
}

export function defaultCaseSettings(design: "rhine" | "archive" = "rhine"): CaseSettings {
  return {
    version: 1,
    enabled: true,
    structure: design === "archive" ? "punk" : "minimal",
    appearances: {
      minimal: casePreset("original", "minimal"),
      rhine: casePreset("original", "rhine"),
      punk: casePreset("glass", "punk"),
    },
  };
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
const color = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : fallback;

const DEFAULT_TRANSFORM: CaseTransform = {
  visible: true,
  offset: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

function normalizeVector(
  value: unknown,
  fallback: CaseVector3,
  min: number,
  max: number,
): CaseVector3 {
  if (!Array.isArray(value)) return [fallback[0], fallback[1], fallback[2]];
  return ([0, 1, 2] as const).map((index) =>
    number(value[index], fallback[index], min, max),
  ) as CaseVector3;
}

function normalizeTransform(value: unknown): CaseTransform {
  const raw = object(value);
  return {
    ...raw,
    visible: typeof raw.visible === "boolean" ? raw.visible : DEFAULT_TRANSFORM.visible,
    offset: normalizeVector(raw.offset, DEFAULT_TRANSFORM.offset, -10, 10),
    rotation: normalizeVector(raw.rotation, DEFAULT_TRANSFORM.rotation, -360, 360),
    scale: normalizeVector(raw.scale, DEFAULT_TRANSFORM.scale, 0.01, 10),
  } as CaseTransform;
}

function normalizeSurface(value: unknown, defaults: CaseSurface): CaseSurface {
  const raw = object(value);
  const clearcoatRoughnessFallback =
    typeof raw.roughness === "number" && Number.isFinite(raw.roughness) &&
    raw.roughness >= 0 && raw.roughness <= 1
      ? raw.roughness
      : defaults.clearcoatRoughness ?? defaults.roughness;
  const finish = Object.hasOwn(caseFinishLabels, String(raw.finish))
    ? raw.finish as CaseFinish
    : defaults.finish;
  const pattern = Object.hasOwn(casePatternLabels, String(raw.pattern))
    ? raw.pattern as CasePattern
    : defaults.pattern ?? "none";
  return {
    ...defaults,
    ...raw,
    finish,
    color: color(raw.color, defaults.color),
    roughness: number(raw.roughness, defaults.roughness, 0, 1),
    transmission: number(raw.transmission, defaults.transmission, 0, 1),
    transmissionOverride: typeof raw.transmissionOverride === "number" && Number.isFinite(raw.transmissionOverride)
      ? number(raw.transmissionOverride, 0, 0, 1) : undefined,
    opacityOverride: typeof raw.opacityOverride === "number" && Number.isFinite(raw.opacityOverride)
      ? number(raw.opacityOverride, 1, 0, 1) : undefined,
    ior: number(raw.ior, defaults.ior, 1, 2.5),
    emission: number(raw.emission, defaults.emission, 0, 2),
    pattern,
    secondaryColor: color(raw.secondaryColor, defaults.secondaryColor ?? defaults.color),
    gradientAngle: number(raw.gradientAngle, defaults.gradientAngle ?? 90, -180, 180),
    metalness: number(raw.metalness, defaults.metalness ?? 0, 0, 1),
    clearcoat: number(raw.clearcoat, defaults.clearcoat ?? 0, 0, 1),
    clearcoatRoughness: number(raw.clearcoatRoughness, clearcoatRoughnessFallback, 0, 1),
    iridescence: number(raw.iridescence, defaults.iridescence ?? 0, 0, 1),
    thickness: number(raw.thickness, defaults.thickness ?? 0.22, 0, 10),
    attenuationDistance: number(raw.attenuationDistance, defaults.attenuationDistance ?? 2.5, 0.01, 100),
    preserveSource: typeof raw.preserveSource === "boolean"
      ? raw.preserveSource
      : defaults.preserveSource ?? false,
  } as CaseSurface;
}

// Fingerprints of the untouched first reconstruction presets. Only exact
// matches are upgraded; custom or manually altered saved finishes survive.
const legacyPunkPresetHashes: Record<string, number> = {
  marble: 488214401, hazard: 435241061, white: 504307058, glass: 4019825096,
  frost: 2946357657, red: 1351143729, blue: 2188553745, coral: 782040014,
  tide: 973666227, aurora: 3238676072,
};
const revisionTwoPresetHashes: Record<string, number> = {
  marble: 2557328749, hazard: 991812386, white: 3208062264, glass: 992395780,
  frost: 2253552188, red: 3748390686, blue: 1804382990, coral: 4133244057,
  tide: 1908124617, aurora: 2658149930,
};
const revisionThreePresetHashes: Record<string, number> = {
  aurora: 3928754121, blue: 2580573428, coral: 1127667167, frost: 2975829841,
  glass: 3281136063, hazard: 2793341412, marble: 720690461, red: 636306797,
  tide: 125832721, white: 1705910860,
};
function legacySurfaceHash(surfaces: Record<string, unknown>, revision = 1) {
  const fields = ["finish", "color", "roughness", "transmission", "ior", "emission", "pattern", "secondaryColor", "metalness", "clearcoat", "iridescence", "thickness", "attenuationDistance"];
  if (revision >= 2) fields.push("gradientAngle");
  const serialized = JSON.stringify(Object.keys(surfaces).sort().map(part => {
    const value = object(surfaces[part]);
    return [part, ...fields.map(key => typeof value[key] === "string" ? value[key].toLowerCase() : value[key] ?? null)];
  }));
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++) { hash ^= serialized.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function revisionThreeSurfaceHash(surfaces: Record<string, unknown>) {
  const fields = [
    "finish", "color", "roughness", "transmission", "ior", "emission", "pattern",
    "secondaryColor", "metalness", "clearcoat", "iridescence", "thickness",
    "attenuationDistance", "gradientAngle", "clearcoatRoughness", "preserveSource",
  ];
  const serialized = JSON.stringify(Object.keys(surfaces).sort().map(part => {
    const value = object(surfaces[part]);
    return [part, ...fields.map(key => typeof value[key] === "string" ? value[key].toLowerCase() : value[key] ?? null)];
  }));
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++) { hash ^= serialized.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function normalizeCaseSettings(value: unknown, design: "rhine" | "archive" = "rhine"): CaseSettings {
  const base = defaultCaseSettings(design);
  const raw = object(value);
  const savedAppearances = object(raw.appearances);
  const appearances = { ...base.appearances } as Record<CaseStructure, CaseAppearance>;

  for (const structure of CASE_STRUCTURES) {
    const saved = object(savedAppearances[structure]);
    const savedAppearance = { ...saved };
    delete savedAppearance.transforms;
    const defaults = typeof saved.preset === "string" && Object.hasOwn(caseAppearancePresets, saved.preset)
      ? casePreset(saved.preset, structure) : base.appearances[structure];
    let savedSurfaces = object(saved.surfaces);
    let upgradePreset = false;
    if (typeof saved.preset === "string" && Object.hasOwn(legacyPunkPresetHashes, saved.preset)) {
      if (saved.presetRevision === 3)
        upgradePreset = revisionThreeSurfaceHash(savedSurfaces) === revisionThreePresetHashes[saved.preset];
      else if (saved.presetRevision === 2)
        upgradePreset = legacySurfaceHash(savedSurfaces, 2) === revisionTwoPresetHashes[saved.preset];
      else if (saved.presetRevision === 1 || typeof saved.presetRevision !== "number")
        upgradePreset = legacySurfaceHash(savedSurfaces) === legacyPunkPresetHashes[saved.preset];
    }
    if (upgradePreset) savedSurfaces = defaults.surfaces;
    const surfaces = structuredClone(defaults.surfaces);
    for (const part of ALL_PARTS) {
      surfaces[part] = normalizeSurface(savedSurfaces[part], defaults.surfaces[part]);
      // Existing custom profiles predate preserveSource; keep their chosen
      // materials rather than silently restoring the new native defaults.
      const savedSurface = object(savedSurfaces[part]);
      if (saved.preset && saved.preset !== "original" && Object.keys(savedSurface).length && !Object.hasOwn(savedSurface, "preserveSource"))
        surfaces[part].preserveSource = false;
    }

    const savedTransforms = object(saved.transforms);
    const transforms: Partial<Record<CasePart, CaseTransform>> = {
      ...savedTransforms,
    } as Partial<Record<CasePart, CaseTransform>>;
    for (const part of ALL_PARTS) {
      if (Object.hasOwn(savedTransforms, part)) {
        transforms[part] = normalizeTransform(savedTransforms[part]);
      }
    }
    const normalized: CaseAppearance = {
      ...defaults,
      ...savedAppearance,
      presetRevision: upgradePreset ? 4 : typeof saved.presetRevision === "number" ? saved.presetRevision : 1,
      preset: typeof saved.preset === "string" &&
        (saved.preset === "custom" || Object.hasOwn(caseAppearancePresets, saved.preset))
        ? saved.preset
        : defaults.preset,
      surfaces,
      ...(Object.keys(transforms).length > 0 ? { transforms } : {}),
    };
    appearances[structure] = normalized;
  }

  return {
    ...base,
    ...raw,
    version: 1,
    enabled: design === "archive" ? true : typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    structure: caseStructuresForDesign(design).includes(raw.structure as CaseStructure)
      ? raw.structure as CaseStructure
      : base.structure,
    appearances,
  } as CaseSettings;
}

export function normalizeCaseProfiles(value: unknown): CaseProfiles {
  const raw = object(value);
  return {
    rhine: normalizeCaseSettings(raw.rhine, "rhine"),
    archive: normalizeCaseSettings(raw.archive, "archive"),
  };
}

export function activeCaseAppearance(settings: CaseSettings) {
  return settings.appearances[settings.structure];
}
