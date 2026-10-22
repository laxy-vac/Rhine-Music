import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { escapeHtml } from "./html.ts";
import { trUi } from "./i18n.ts";
import {
  CASE_STRUCTURES,
  caseAppearancePresets,
  caseFinishLabels,
  casePartsForStructure,
  casePatternLabels,
  casePartLabels,
  casePreset,
  caseStructureLabels,
  caseStructuresForDesign,
  defaultCaseSettings,
  type CaseAppearance,
  type CaseFinish,
  type CasePart,
  type CaseSurface,
  type CaseSettings,
  type CaseStructure,
  type CaseTransform,
} from "./case-settings.ts";
import { createCaseStudioLighting } from "./case-studio-lighting";
import { createCaseIllumination } from "./case-illumination";
import { setCaseAlbumOcclusion } from "./case-materials";
import {
  createCaseModel,
  applyCaseAppearance,
  disposeCaseModel,
} from "./case-model.ts";
import { MUSIC_MODEL, createAlbumPrintMaterial } from "./music-model.ts";
import { createAlbumInsert, albumInsertGeometry } from "./album-insert";
import { getCaseLayout } from "./case-layout.ts";
import type { RenderQuality } from "./render-quality.ts";
import { renderDimensions } from "./render-quality";
import "./case-editor.css";
import { CaseAlbumInfo } from "./rhine-album-info";
import type { ArchiveRecord } from "./data";
import { isHiResAlbum } from "./hi-res";
import { prepareHiResGold } from "./hi-res-gold";
import {
  CASE_USER_PRESET_LIMIT,
  caseUserPresetAppearance,
  caseUserPresetMatches,
  normalizeCaseUserPresets,
  type CaseUserPreset,
} from "./case-user-presets";

type CaseTheme = "day" | "night";
type EditorView = "display" | "front";
type SurfaceField = keyof CaseSurface;
type SurfaceNumericField =
  | "roughness"
  | "transmission"
  | "ior"
  | "emission"
  | "metalness"
  | "clearcoat"
  | "clearcoatRoughness"
  | "iridescence"
  | "gradientAngle"
  | "thickness"
  | "attenuationDistance";
type TransformVector = "offset" | "rotation" | "scale";

export type CaseEditorOptions = {
  getSettings: () => CaseSettings;
  getQuality: () => RenderQuality;
  getTheme: () => CaseTheme;
  getDesign: () => "rhine" | "archive";
  getCover: () => { url?: string; title?: string };
  onChange: (next: CaseSettings) => void;
  getUserPresets?: () => CaseUserPreset[];
  onUserPresetsChange?: (next: CaseUserPreset[]) => void;
  getAlbumInfo?: () => { record?: ArchiveRecord; index?: number; reduced?: boolean };
};

export type CaseEditorHandle = { refresh: () => void; destroy: () => void };

const STRUCTURE_DETAILS: Record<CaseStructure, string> = {
  minimal: "ESSENTIAL",
  rhine: "RHINE LAB",
  punk: "LONE TRAIL–INSPIRED",
};
const SURFACE_LIMITS: Record<SurfaceNumericField, [number, number]> = {
  roughness: [0, 1],
  transmission: [0, 1],
  ior: [1, 2.5],
  emission: [0, 2],
  metalness: [0, 1],
  clearcoat: [0, 1],
  clearcoatRoughness: [0, 1],
  iridescence: [0, 1],
  gradientAngle: [-180, 180],
  thickness: [0, 10],
  attenuationDistance: [0.01, 100],
};

const label = (value: string) => escapeHtml(trUi(value));
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function hexColor(value: string): string | undefined {
  const code = value.trim().replace(/^#/, "");
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(code)) return undefined;
  return `#${(code.length === 3 ? [...code].map(char => char + char).join("") : code).toUpperCase()}`;
}

function colorMarkup(field: "color" | "secondaryColor", title: string) {
  return `<label class="case-editor__field-row case-editor__color-row"><span>${label(title)}</span><input type="color" data-surface-field="${field}" aria-label="${label(title)}"><input type="text" class="case-editor__hex-input" data-color-code="${field}" data-value="${field}" maxlength="16" autocomplete="off" spellcheck="false" placeholder="#RRGGBB" aria-label="${label(title)} HEX" aria-describedby="case-color-error-${field}"><small id="case-color-error-${field}" class="case-editor__color-error" data-color-code-error="${field}" hidden>${label("请输入有效 HEX 颜色：#RGB 或 #RRGGBB")}</small></label>`;
}

function cloneSettings(settings: CaseSettings): CaseSettings {
  return structuredClone(settings);
}

function rangeMarkup(
  field: SurfaceNumericField,
  title: string,
  min: number,
  max: number,
  step: number,
) {
  return `<label class="case-editor__range-row"><span>${label(title)}</span><output data-value="${field}">0.00</output><input type="range" data-surface-field="${field}" min="${min}" max="${max}" step="${step}" aria-label="${label(title)}"></label>`;
}

function editorMarkup() {
  const structures = CASE_STRUCTURES.map(
    (
      structure,
      index,
    ) => `<button type="button" class="case-editor__structure" data-structure="${structure}" aria-pressed="false">
      <small>0${index + 1} / ${escapeHtml(STRUCTURE_DETAILS[structure])}</small>
      <strong>${label(caseStructureLabels[structure])}</strong>
      <span data-structure-note="${structure}"></span>
    </button>`,
  ).join("");
  const presets = Object.entries(caseAppearancePresets)
    .map(
      ([
        id,
        preset,
      ]) => `<button type="button" class="case-editor__preset" data-preset="${escapeHtml(id)}" aria-pressed="false" aria-label="${label(preset.label)}">
        <i style="--preset-frame:${escapeHtml(preset.surfaces.frame.color)};--preset-accent:${escapeHtml(preset.surfaces.accent.color)}"></i>
        <span>${label(preset.label)}</span>
      </button>`,
    )
    .join("");
  const parts = Object.entries(casePartLabels)
    .map(
      ([part, partLabel]) =>
        `<button type="button" class="case-editor__part" data-part="${part}" role="tab" aria-selected="false">${label(partLabel)}</button>`,
    )
    .join("");
  const finishes = Object.entries(caseFinishLabels)
    .map(
      ([finish, finishLabel]) =>
        `<option value="${finish}">${label(finishLabel)}</option>`,
    )
    .join("");
  const patterns = Object.entries(casePatternLabels)
    .map(
      ([pattern, patternLabel]) =>
        `<option value="${pattern}">${label(patternLabel)}</option>`,
    )
    .join("");
  const partPresetOptions = Object.entries(caseAppearancePresets)
    .map(
      ([id, preset]) =>
        `<option value="${escapeHtml(id)}">${label(preset.label)}</option>`,
    )
    .join("");
  const transformVectorMarkup = (
    field: TransformVector,
    title: string,
    min: number,
    max: number,
    step: number,
  ) => `<fieldset class="case-editor__transform-vector" data-transform-vector="${field}">
      <legend>${label(title)}</legend>
      ${["x", "y", "z"].map((axis, index) => `<label><span>${axis.toUpperCase()}</span><input type="number" data-transform-value="${field}" data-axis="${index}" min="${min}" max="${max}" step="${step}" aria-label="${label(title)} ${axis.toUpperCase()}"></label>`).join("")}
    </fieldset>`;

  return `<section class="case-editor" aria-label="${label("唱片盒体编辑器")}" data-design="rhine" data-theme="day">
    <header class="case-editor__heading">
      <div><small>CASE SYSTEM / 3D EDITOR</small><h2>${label("可调唱片盒体")}</h2><p data-structure-description></p></div>
      <button type="button" class="case-editor__reset" data-action="reset">${label("重置当前外观")}</button>
    </header>
    <div class="case-editor__workspace">
      <div class="case-editor__controls">
        <section class="case-editor__section" aria-labelledby="case-structure-heading">
          <div class="case-editor__section-heading"><small>01 / STRUCTURE</small><h3 id="case-structure-heading">${label("盒体结构")}</h3></div>
          <div class="case-editor__structures">${structures}</div>
        </section>
        <section class="case-editor__section" aria-labelledby="case-preset-heading" data-preset-section>
          <div class="case-editor__section-heading"><small>02 / FINISH STUDIES</small><h3 id="case-preset-heading">${label("外观预设")}</h3></div>
          <p class="case-editor__help" data-builtin-help hidden>${label("内置预设用于切换整盒颜色与材质，部件位置保持不变。")}</p>
          <div class="case-editor__presets">${presets}</div>
          <p class="case-editor__preset-note" data-preset-note></p>
        </section>
        <section class="case-editor__section" data-user-preset-section hidden aria-labelledby="case-user-preset-heading">
          <div class="case-editor__section-heading"><h3 id="case-user-preset-heading">${label("我的预设")}</h3></div>
          <p class="case-editor__help">${label("保存当前整盒的外观和部件设置，以后可一键使用。")}</p>
          <div class="case-editor__user-presets" data-user-presets></div>
          <p class="case-editor__help" data-user-presets-empty>${label("还没有个人预设。调整满意后，在下方命名保存。")}</p>
          <div class="case-editor__save-preset">
            <label><span>${label("预设名称")}</span><input type="text" data-user-preset-name maxlength="64" autocomplete="off" placeholder="${label("例如：暖白磨砂")}"></label>
            <button type="button" data-action="save-user-preset">${label("保存为新预设")}</button>
          </div>
          <p class="case-editor__help" data-user-preset-status role="status" aria-live="polite"></p>
          <div class="case-editor__delete-preset" data-delete-preset-row hidden>
            <span data-delete-preset-message></span>
            <button type="button" data-action="confirm-delete-preset">${label("确认删除此预设")}</button>
            <button type="button" data-action="cancel-delete-preset">${label("取消删除")}</button>
          </div>
        </section>
        <section class="case-editor__section" aria-labelledby="case-part-heading">
          <div class="case-editor__section-heading"><small>03 / SURFACE</small><h3 id="case-part-heading">${label("盒体部件")}</h3></div>
          <div class="case-editor__parts" role="tablist" aria-label="${label("盒体部件")}">${parts}</div>
          <p class="case-editor__part-note" data-part-note hidden></p>
          <div class="case-editor__part-source">
            <label class="case-editor__field-row"><span>${label("从预设取材")}</span><select data-part-preset aria-label="${label("部件材质来源预设")}">${partPresetOptions}</select></label>
            <button type="button" data-action="apply-part-preset">${label("应用到当前部件")}</button>
          </div>
          <div class="case-editor__surface-fields" data-surface-fields>
            <label class="case-editor__field-row"><span>${label("材质类型")}</span><select data-surface-field="finish" aria-label="${label("材质类型")}">${finishes}</select></label>
            ${colorMarkup("color", "颜色")}
            <label class="case-editor__field-row"><span>${label("表面纹理")}</span><select data-surface-field="pattern" aria-label="${label("表面纹理")}">${patterns}</select></label>
            ${colorMarkup("secondaryColor", "纹理辅色")}
            ${rangeMarkup("gradientAngle", "渐变方向（度）", -180, 180, 1)}
            ${rangeMarkup("roughness", "粗糙度", 0, 1, 0.01)}
            ${rangeMarkup("transmission", "透光率", 0, 1, 0.01)}
            ${rangeMarkup("ior", "折射率 IOR", 1, 2.5, 0.01)}
            ${rangeMarkup("emission", "发光强度", 0, 2, 0.01)}
            ${rangeMarkup("metalness", "金属度", 0, 1, 0.01)}
            ${rangeMarkup("clearcoat", "清漆层", 0, 1, 0.01)}
            ${rangeMarkup("clearcoatRoughness", "清漆粗糙度", 0, 1, 0.01)}
            ${rangeMarkup("iridescence", "薄膜干涉", 0, 1, 0.01)}
            ${rangeMarkup("thickness", "光学厚度（模型单位）", 0, 10, 0.01)}
            ${rangeMarkup("attenuationDistance", "衰减距离（模型单位）", 0.01, 100, 0.05)}
            <label class="case-editor__source-toggle"><input type="checkbox" data-surface-field="preserveSource"><span>${label("使用模型原始材质")}</span></label>
            <p class="case-editor__source-note" data-source-note hidden>${label("启用时使用模型内置材质；关闭后可自定义。")}</p>
          </div>
          <details class="case-editor__transform" data-transform-editor>
            <summary>${label("部件位置、角度与比例")}</summary>
            <p>${label("位置使用模型单位；旋转使用度数。变换会随当前盒体外观配置保存。")}</p>
            <label class="case-editor__source-toggle"><input type="checkbox" data-transform-visible><span>${label("显示此部件")}</span></label>
            ${transformVectorMarkup("offset", "位置", -10, 10, 0.01)}
            ${transformVectorMarkup("rotation", "旋转（度）", -360, 360, 1)}
            ${transformVectorMarkup("scale", "缩放", 0.01, 10, 0.01)}
          </details>
        </section>
        <section class="case-editor__section" data-rhine-optics-section hidden aria-labelledby="case-rhine-optics-heading">
          <div class="case-editor__section-heading"><small>02 / RHINE OPTICS</small><h3 id="case-rhine-optics-heading">${label("精细盒体 · 透光设置")}</h3></div>
          <p class="case-editor__help">${label("透光率控制光穿过材质的程度；透明度控制部件本身淡出的程度。")}</p>
          <label class="case-editor__field-row"><span>${label("调整哪个部件")}</span><select data-rhine-optics-part aria-label="${label("调整哪个部件")}">${casePartsForStructure("rhine").map(part => `<option value="${part}">${label(casePartLabels[part])}</option>`).join("")}</select></label>
          <label class="case-editor__range-row"><span>${label("透光率")}</span><output data-rhine-optics-value="transmission">0%</output><input type="range" data-rhine-optics="transmission" min="0" max="1" step="0.01" aria-label="${label("透光率")}"></label>
          <label class="case-editor__range-row"><span>${label("透明度")}</span><output data-rhine-optics-value="transparency">0%</output><input type="range" data-rhine-optics="transparency" min="0" max="1" step="0.01" aria-label="${label("透明度")}"></label>
        </section>
        <section class="case-editor__section" data-minimal-glass-section hidden aria-labelledby="case-minimal-glass-heading">
          <div class="case-editor__section-heading"><small>02 / ESSENTIAL OPTICS</small><h3 id="case-minimal-glass-heading">${label("简单粗糙 · 玻璃设置")}</h3></div>
          <p class="case-editor__help">${label("只调整玻璃主体与背板，专辑封面和金色边缘保持不变。")}</p>
          <label class="case-editor__range-row"><span>${label("透光率")}</span><output data-minimal-glass-value="transmission">0%</output><input type="range" data-minimal-glass="transmission" data-editable-range="false" min="0" max="1" step="0.01" aria-label="${label("透光率")}"></label>
          <label class="case-editor__range-row"><span>${label("磨砂度")}</span><output data-minimal-glass-value="roughness">0%</output><input type="range" data-minimal-glass="roughness" data-editable-range="false" min="0" max="1" step="0.01" aria-label="${label("磨砂度")}"></label>
        </section>
        <section class="case-editor__section" data-punk-material-section hidden aria-labelledby="case-material-heading">
          <div class="case-editor__section-heading"><small>04 / FINISH</small><h3 id="case-material-heading">${label("颜色与材质")}</h3></div>
          <p class="case-editor__help" data-material-part></p>
          <label class="case-editor__field-row"><span>${label("调整哪个部件")}</span><select data-finish-part aria-label="${label("调整哪个部件")}">${casePartsForStructure("punk").map(part => `<option value="${part}">${label(casePartLabels[part])}</option>`).join("")}</select></label>
          <div data-material-controls></div>
        </section>
      </div>
      <aside class="case-editor__preview-panel" aria-label="${label("盒体三维预览")}">
        <div class="case-editor__preview-heading"><div><small>LIVE SPECIMEN</small><strong data-cover-title>${label("唱片盒体预览")}</strong></div>
          <div class="case-editor__views" role="group" aria-label="${label("预览视角")}">
            <button type="button" data-view="display" aria-pressed="true">${label("陈列")}</button>
            <button type="button" data-view="front" aria-pressed="false">${label("正面")}</button>
          </div>
        </div>
        <div class="case-editor__preview-stage" data-preview-stage>
          <div class="case-editor__canvas" data-canvas-host></div>
          <p class="case-editor__preview-error" data-preview-error role="status" hidden></p>
        </div>
        <label class="case-editor__cover-toggle"><input type="checkbox" data-field="show-cover" checked><span>${label("显示专辑封面")}</span><small>${label("仅控制此预览，用来检查被封面遮住的壳体细节。")}</small></label>
        <p class="case-editor__preview-note" data-cover-note>${label("拖动可旋转盒体。当前专辑封面仅作为独立表面预览。")}</p>
      </aside>
    </div>
  </section>`;
}

function rangeText(field: SurfaceField, value: unknown) {
  if (field === "color" || field === "secondaryColor")
    return typeof value === "string" ? value.toUpperCase() : "";
  if (typeof value === "boolean") return value ? "是" : "否";
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : "";
}

export function setupCaseEditor(
  host: HTMLElement,
  options: CaseEditorOptions,
): CaseEditorHandle {
  host.replaceChildren();
  host.insertAdjacentHTML("beforeend", editorMarkup());
  const root = host.querySelector<HTMLElement>(".case-editor")!;
  const canvasHost = root.querySelector<HTMLElement>("[data-canvas-host]")!;
  const previewStage = root.querySelector<HTMLElement>("[data-preview-stage]")!;
  const errorNode = root.querySelector<HTMLElement>("[data-preview-error]")!;
  const fieldsNode = root.querySelector<HTMLElement>("[data-surface-fields]")!;
  const partNote = root.querySelector<HTMLElement>("[data-part-note]")!;
  const coverTitle = root.querySelector<HTMLElement>("[data-cover-title]")!;
  const coverNote = root.querySelector<HTMLElement>("[data-cover-note]")!;
  const presetNote = root.querySelector<HTMLElement>("[data-preset-note]")!;
  const sourceNote = root.querySelector<HTMLElement>("[data-source-note]")!;
  const partPresetSelect = root.querySelector<HTMLSelectElement>("[data-part-preset]")!;
  const coverVisibility = root.querySelector<HTMLInputElement>("[data-field='show-cover']")!;
  const presetSection = root.querySelector<HTMLElement>("[data-preset-section]")!;
  const partSection = root.querySelector<HTMLElement>("[aria-labelledby='case-part-heading']")!;
  const partSource = root.querySelector<HTMLElement>(".case-editor__part-source")!;
  const transformEditor = root.querySelector<HTMLDetailsElement>("[data-transform-editor]")!;
  const materialSection = root.querySelector<HTMLElement>("[data-punk-material-section]")!;
  const materialHost = root.querySelector<HTMLElement>("[data-material-controls]")!;
  const personalSection = root.querySelector<HTMLElement>("[data-user-preset-section]")!;
  const personalList = root.querySelector<HTMLElement>("[data-user-presets]")!;
  const personalName = root.querySelector<HTMLInputElement>("[data-user-preset-name]")!;
  const personalStatus = root.querySelector<HTMLElement>("[data-user-preset-status]")!;
  const deleteRow = root.querySelector<HTMLElement>("[data-delete-preset-row]")!;
  const originalFieldRows = [...fieldsNode.children];
  const rhineOpticsSection = root.querySelector<HTMLElement>("[data-rhine-optics-section]")!;
  const minimalGlassSection = root.querySelector<HTMLElement>("[data-minimal-glass-section]")!;
  const opticalDetails = document.createElement("details");
  opticalDetails.className = "case-editor__advanced";
  opticalDetails.innerHTML = `<summary>${label("进阶光学参数")}</summary>`;
  const sourceDetails = document.createElement("details");
  sourceDetails.className = "case-editor__advanced";
  sourceDetails.innerHTML = `<summary>${label("仅替换当前部件的材质")}</summary>`;
  let layoutConfigured = false;
  let pendingDeleteId: string | undefined;
  let personalSource: CaseUserPreset[] | undefined;
  let personalCache: CaseUserPreset[] = [];
  let personalListSource: CaseUserPreset[] | undefined;

  function configureLayout() {
    if (layoutConfigured) return;
    layoutConfigured = true;
    root.querySelector("h2")!.textContent = trUi("唱片盒体");
    root.querySelector("#case-preset-heading")!.textContent = trUi("仿孤星内置预设");
    presetSection.querySelector("small")!.textContent = "02 / PRESETS";
    materialSection.querySelector("small")!.textContent = "03 / FINISH";
    root.querySelector<HTMLElement>("[data-builtin-help]")!.hidden = false;
    personalSection.before(materialSection);
    transformEditor.open = false;
    materialHost.append(fieldsNode, sourceDetails, transformEditor);
    sourceDetails.append(partSource);
    const commonFields = new Set(["finish", "color", "pattern", "secondaryColor", "roughness", "transmission"]);
    for (const row of originalFieldRows) {
      const field = row.querySelector<HTMLElement>("[data-surface-field]")?.dataset.surfaceField;
      if (!field || !commonFields.has(field)) opticalDetails.append(row);
    }
    fieldsNode.append(opticalDetails);
  }

  function canEditFinish() {
    return settings.structure === "punk";
  }

  function canUsePersonalPresets() {
    return settings.structure === "punk" &&
      !!options.getUserPresets && !!options.onUserPresetsChange;
  }

  function personalPresets() {
    const source = options.getUserPresets?.();
    if (source !== personalSource) {
      personalSource = source;
      personalCache = normalizeCaseUserPresets(source);
    }
    return personalCache;
  }

  function syncPersonalPresets() {
    personalSection.hidden = !canUsePersonalPresets();
    if (personalSection.hidden) { pendingDeleteId = undefined; deleteRow.hidden = true; return; }
    const presets = personalPresets();
    if (personalListSource !== presets) {
      personalListSource = presets;
      personalList.innerHTML = presets.map(preset => `<div class="case-editor__user-preset">
      <button type="button" class="case-editor__preset" data-user-preset="${escapeHtml(preset.id)}" aria-pressed="${caseUserPresetMatches(preset, currentAppearance())}">
        <i style="--preset-frame:${escapeHtml(preset.appearance.surfaces.frame.color)};--preset-accent:${escapeHtml(preset.appearance.surfaces.accent.color)}"></i><span>${escapeHtml(preset.name)}</span>
      </button><button type="button" data-delete-user-preset="${escapeHtml(preset.id)}" aria-label="${label("删除预设")} ${escapeHtml(preset.name)}">${label("删除预设")}</button></div>`).join("");
    }
    for (const button of personalList.querySelectorAll<HTMLButtonElement>("[data-user-preset]")) {
      const preset = presets.find(preset => preset.id === button.dataset.userPreset);
      button.setAttribute("aria-pressed", String(!!preset && caseUserPresetMatches(preset, currentAppearance())));
    }
    root.querySelector<HTMLElement>("[data-user-presets-empty]")!.hidden = presets.length > 0;
    if (pendingDeleteId && !presets.some(preset => preset.id === pendingDeleteId)) pendingDeleteId = undefined;
    deleteRow.hidden = !pendingDeleteId;
  }

  function themeSettings(value: CaseSettings): CaseSettings {
    const next = cloneSettings(value);
    const allowed = caseStructuresForDesign(options.getDesign());
    if (!allowed.includes(next.structure)) next.structure = allowed[0]!;
    if (options.getDesign() === "archive") next.enabled = true;
    return next;
  }

  let settings = themeSettings(options.getSettings());
  let selectedPart: CasePart = settings.structure === "rhine" ? "cover" : "frame";
  let selectedView: EditorView = "display";
  let showAlbumCover = true;
  let destroyed = false;
  let intersecting = true;
  let modelRevision = 0;
  let pendingKey: string | undefined;
  let currentKey: string | undefined;
  let model: THREE.Group | undefined;
  let albumInfo: CaseAlbumInfo | undefined;
  let badgeAnimationFrame = 0;
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene | undefined;
  let illumination: ReturnType<typeof createCaseIllumination> | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let controls: OrbitControls | undefined;
  let studio: ReturnType<typeof createCaseStudioLighting> | undefined;
  let coverGeometry: THREE.PlaneGeometry | undefined;
  let coverMaterial: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial | undefined;
  let coverMesh: THREE.Mesh | undefined;
  let insertMesh: ReturnType<typeof createAlbumInsert> | undefined;
  let insertKey = "";
  let coverLayoutKey = "";
  let coverRevision = 0;
  let coverKey = "";
  const ownedTextures = new Set<THREE.Texture>();
  let resizeObserver: ResizeObserver | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let documentVisibilityHandler: (() => void) | undefined;
  let windowResizeHandler: (() => void) | undefined;

  root.dataset.design = options.getDesign();
  root.dataset.theme = options.getTheme();

  const defaultTransform: CaseTransform = {
    visible: true,
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };

  function currentTransform(): CaseTransform {
    return currentAppearance().transforms?.[selectedPart] ?? defaultTransform;
  }

  function currentAppearance(): CaseAppearance {
    return settings.appearances[settings.structure];
  }

  function previewAppearance(): CaseAppearance {
    // The editor previews the saved editable profile even while the archive
    // uses legacy sprites; changing a control explicitly enables that profile.
    return currentAppearance();
  }

  function nativeSurface(part: CasePart, fallback: CaseSurface): CaseSurface {
    const mesh = model?.children.find(child => child instanceof THREE.Mesh && child.userData.casePart === part) as THREE.Mesh | undefined;
    const material = mesh?.material as THREE.MeshPhysicalMaterial | undefined;
    const native = material?.userData.caseNative;
    if (!native) return fallback;
    return { ...fallback, color: native.color, secondaryColor: native.color, pattern: "none",
      finish: native.transmission > 0 ? native.roughness > .3 ? "frost" : "glass" : native.metalness > .45 ? "metal" : "paint",
      roughness: native.roughness, transmission: native.transmission, ior: native.ior,
      metalness: native.metalness, clearcoat: native.clearcoat,
      clearcoatRoughness: native.clearcoatRoughness, iridescence: native.iridescence,
      thickness: native.thickness, attenuationDistance: Number.isFinite(native.attenuationDistance) ? native.attenuationDistance : 100,
      emission: native.emissive === "#000000" ? 0 : native.emissiveIntensity };
  }

  function syncStructureButtons() {
    const design = options.getDesign();
    const allowed = caseStructuresForDesign(design);
    root
      .querySelectorAll<HTMLButtonElement>("[data-structure]")
      .forEach((button) => {
        const structure = button.dataset.structure as CaseStructure;
        button.hidden = !allowed.includes(structure);
        button.disabled = button.hidden;
        button.querySelector("strong")!.textContent = trUi(
          design === "archive" ? "仿孤星盒体" : caseStructureLabels[structure],
        );
        button.querySelector("small")!.textContent = design === "archive"
          ? "01 / LONE TRAIL–INSPIRED" : `0${CASE_STRUCTURES.indexOf(structure) + 1} / ${STRUCTURE_DETAILS[structure]}`;
        button.setAttribute(
          "aria-pressed",
          String(structure === settings.structure),
        );
        const note = button.querySelector<HTMLElement>("[data-structure-note]");
        if (note)
          note.textContent =
            structure === settings.structure ? trUi("当前结构") : "";
      });
  }

  function syncSurfaceControls() {
    const availableParts = casePartsForStructure(settings.structure);
    if (!availableParts.includes(selectedPart)) selectedPart = availableParts[0] ?? "frame";
    const absent = !availableParts.includes(selectedPart);
    fieldsNode.hidden = absent || !canEditFinish();
    partNote.hidden = settings.structure !== "minimal";
    if (!partNote.hidden) partNote.textContent = trUi("极简结构仅包含外框、封面窗盖和背板；其他部件在当前结构中不可用。");
    const partSource = root.querySelector<HTMLElement>(".case-editor__part-source");
    const transformEditor = root.querySelector<HTMLDetailsElement>("[data-transform-editor]");
    if (partSource) partSource.hidden = absent || settings.structure !== "punk";
    if (transformEditor) transformEditor.hidden = absent;
    root
      .querySelectorAll<HTMLButtonElement>("[data-part]")
      .forEach((button) => {
        const part = button.dataset.part as CasePart;
        button.disabled = !availableParts.includes(part);
        button.hidden = options.getDesign() === "rhine" && button.disabled;
        button.title = button.disabled ? trUi("当前结构不包含此部件。"): "";
        const active = button.dataset.part === selectedPart;
        button.setAttribute("aria-selected", String(active));
        button.classList.toggle("is-active", active);
      });
    if (absent) return;

    const savedSurface = currentAppearance().surfaces[selectedPart];
    const preserveSource = savedSurface.preserveSource === true;
    const surface = preserveSource ? nativeSurface(selectedPart, savedSurface) : savedSurface;
    sourceNote.hidden = !preserveSource;
    root
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "[data-surface-field]",
      )
      .forEach((control) => {
        const field = control.dataset.surfaceField as SurfaceField;
        const value = surface[field];
        if (control instanceof HTMLInputElement && control.type === "checkbox") {
          control.checked = value === true;
        } else if (value !== undefined) {
          control.value = String(value);
        }
        control.disabled = !canEditFinish() || (preserveSource && field !== "preserveSource");
        if (field === "gradientAngle") {
          const row = control.closest<HTMLElement>(".case-editor__range-row");
          if (row) row.hidden = surface.pattern !== "gradient";
        }
        const output = root.querySelector<HTMLOutputElement | HTMLInputElement>(
          `[data-value="${field}"]`,
        );
        if (output) output.value = rangeText(field, value);
        if (output instanceof HTMLInputElement && output.dataset.colorCode) {
          output.disabled = control.disabled;
          output.removeAttribute("aria-invalid");
          root.querySelector<HTMLElement>(`[data-color-code-error="${field}"]`)!.hidden = true;
        }
      });
    const availablePresets = settings.structure === "punk"
      ? Object.entries(caseAppearancePresets).filter(([id]) => id !== "original")
      : Object.entries(caseAppearancePresets);
    const selectedSource = availablePresets.some(([id]) => id === partPresetSelect.value)
      ? partPresetSelect.value
      : settings.structure === "punk" ? availablePresets[0]?.[0] ?? "marble" : "original";
    partPresetSelect.value = selectedSource;
    Array.from(partPresetSelect.options).forEach((option) => {
      option.hidden = settings.structure === "punk" && option.value === "original";
    });
    syncTransformControls();
    const finishPart = root.querySelector<HTMLSelectElement>("[data-finish-part]")!;
    finishPart.value = selectedPart;
    root.querySelector<HTMLElement>("[data-material-part]")!.textContent = `${trUi("正在调整：")}${trUi(casePartLabels[selectedPart])}`;
    syncRhineOptics();
  }

  function syncRhineOptics() {
    const allowed = options.getDesign() === "rhine" && settings.structure === "rhine";
    rhineOpticsSection.hidden = !allowed;
    const partSelect = root.querySelector<HTMLSelectElement>("[data-rhine-optics-part]")!;
    partSelect.disabled = !allowed;
    rhineOpticsSection.querySelectorAll<HTMLInputElement>("[data-rhine-optics]").forEach(input => { input.disabled = !allowed; });
    if (!allowed) return;
    partSelect.value = selectedPart;
    const surface = currentAppearance().surfaces[selectedPart];
    const native = model?.userData.caseStructure === "rhine" ?
      (model.children.find(child => child.userData.casePart === selectedPart) as THREE.Mesh | undefined)?.material as THREE.MeshPhysicalMaterial | undefined : undefined;
    const baseTransmission = selectedPart === "cover" ? .98 : surface.preserveSource ? native?.userData.caseNative?.transmission ?? surface.transmission : surface.transmission;
    const baseOpacity = surface.preserveSource ? native?.userData.caseNative?.opacity ?? 1 : 1;
    const values = {
      transmission: surface.transmissionOverride ?? baseTransmission,
      transparency: 1 - (surface.opacityOverride ?? baseOpacity),
    };
    for (const field of ["transmission", "transparency"] as const) {
      root.querySelector<HTMLInputElement>(`[data-rhine-optics=${field}]`)!.value = String(values[field]);
      root.querySelector<HTMLOutputElement>(`[data-rhine-optics-value=${field}]`)!.value = `${Math.round(values[field] * 100)}%`;
    }
  }

  function syncMinimalGlass() {
    const allowed = options.getDesign() === "rhine" && settings.structure === "minimal";
    minimalGlassSection.hidden = !allowed;
    const controls = minimalGlassSection.querySelectorAll<HTMLInputElement>("[data-minimal-glass]");
    controls.forEach(control => { control.disabled = !allowed; });
    if (!allowed) return;
    const surface = currentAppearance().surfaces.cover;
    for (const field of ["transmission", "roughness"] as const) {
      const value = surface[field];
      minimalGlassSection.querySelector<HTMLInputElement>(`[data-minimal-glass=${field}]`)!.value = String(value);
      minimalGlassSection.querySelector<HTMLOutputElement>(`[data-minimal-glass-value=${field}]`)!.value = `${Math.round(value * 100)}%`;
    }
  }

  function syncTransformControls() {
    const transform = currentTransform();
    const visible = root.querySelector<HTMLInputElement>("[data-transform-visible]");
    if (visible) visible.checked = transform.visible;
    root
      .querySelectorAll<HTMLInputElement>("[data-transform-value]")
      .forEach((input) => {
        const field = input.dataset.transformValue as TransformVector;
        const axis = Number(input.dataset.axis);
        input.value = String(transform[field][axis] ?? 0);
      });
  }

  function syncSettingsUI() {
    configureLayout();
    root.dataset.design = options.getDesign();
    root.dataset.theme = options.getTheme();
    previewStage.dataset.caseStructure = settings.structure;
    root.querySelector<HTMLElement>("[data-structure-description]")!.textContent = trUi(
      options.getDesign() === "archive"
        ? "仿孤星使用专属盒体，可调整外观和部件。"
        : "简单粗糙款可调玻璃透光与磨砂度；精细款可调透光与透明度；仿孤星拓展可深度定制并保存预设。",
    );
    coverVisibility.checked = showAlbumCover;
    syncStructureButtons();
    syncSurfaceControls();
    syncMinimalGlass();
    partSection.hidden = true;
    const resetButton = root.querySelector<HTMLElement>("[data-action=reset]")!;
    resetButton.hidden = false;
    resetButton.textContent = trUi(options.getDesign() === "rhine" && settings.structure === "minimal"
      ? "恢复玻璃默认设置"
      : settings.structure === "rhine" ? "恢复原始透光设置" : "恢复当前盒体默认设置");
    root.querySelector<HTMLElement>(".case-editor__cover-toggle")!.hidden = options.getDesign() === "rhine" && settings.structure === "minimal";
    const punkOnly = settings.structure === "punk";
    root.querySelector<HTMLElement>("[data-preset-section]")!.hidden = !punkOnly;
    root.querySelector<HTMLElement>(".case-editor__part-source")!.hidden = !punkOnly;
    materialSection.hidden = !punkOnly;
    syncPersonalPresets();
    root
      .querySelectorAll<HTMLButtonElement>("[data-preset]")
      .forEach((button) => {
        button.hidden = !punkOnly || button.dataset.preset === "original";
        button.disabled = button.hidden;
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.preset === currentAppearance().preset),
        );
      });
    const selectedPreset = caseAppearancePresets[currentAppearance().preset];
    presetNote.textContent = canUsePersonalPresets() && currentAppearance().preset === "custom"
      ? trUi("当前外观已调整，可在“我的预设”中命名保存。")
      : currentAppearance().preset === "original" && settings.structure !== "rhine"
      ? trUi("基准外观；切换到 Rhine 结构可使用模型原始材质。")
      : selectedPreset?.note ?? trUi("已自定义材质参数；可通过部件开关恢复模型原始材质。");
    root
      .querySelectorAll<HTMLButtonElement>("[data-view]")
      .forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.view === selectedView),
        );
      });
  }

  function onSettingsChanged(next: CaseSettings) {
    settings = themeSettings(next);
    options.onChange(cloneSettings(settings));
    syncSettingsUI();
    updateModel();
  }

  function makePlaceholderTexture(title: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    const night = options.getTheme() === "night";
    if (context) {
      context.fillStyle = night ? "#182536" : "#e7e1d8";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = night ? "#53667b" : "#b4a18c";
      context.lineWidth = 2;
      context.strokeRect(28, 28, 456, 456);
      context.fillStyle = night ? "#d9e3ee" : "#4a4741";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "500 17px sans-serif";
      context.fillText(trUi("暂无封面"), 256, 226, 400);
      context.fillStyle = night ? "#a6b7ca" : "#756f65";
      context.font = "400 22px sans-serif";
      const trimmed = title.trim();
      context.fillText(
        trimmed ? trimmed.slice(0, 28) : trUi("唱片盒体预览"),
        256,
        276,
        400,
      );
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function setCoverTexture(texture: THREE.Texture) {
    if (!coverMaterial || coverMaterial.map === texture) return;
    const previous = coverMaterial.map;
    coverMaterial.map = texture;
    coverMaterial.needsUpdate = true;
    ownedTextures.add(texture);
    if (previous && ownedTextures.has(previous)) {
      previous.dispose();
      ownedTextures.delete(previous);
    }
    render();
  }

  function updateCoverLayout() {
    if (!model || !coverMesh) return;
    const cover = getCaseLayout(model).cover;
    const geometryKey = `${cover.width}:${cover.height}`;
    if (coverLayoutKey !== geometryKey) {
      const nextGeometry = new THREE.PlaneGeometry(cover.width, cover.height);
      coverMesh.geometry.dispose();
      coverMesh.geometry = nextGeometry;
      coverGeometry = nextGeometry;
      coverLayoutKey = geometryKey;
    }
    coverMesh.position.set(cover.x, cover.y, cover.z);
    coverMesh.visible = showAlbumCover;
    const thickness = getCaseLayout(model).insertThickness ?? 0;
    const physical = thickness > 0;
    if (!(coverMaterial instanceof THREE.MeshLambertMaterial) && coverMaterial) {
      const previous = coverMaterial;
      coverMaterial = createAlbumPrintMaterial(previous.map);
      coverMesh.material = coverMaterial;
      previous.dispose();
    }
    if (coverMaterial) coverMaterial.depthWrite = true;
    coverMesh.renderOrder = 0;
    coverMesh.receiveShadow = true;
    if (physical) {
      const nextKey = JSON.stringify([cover, thickness]);
      if (!insertMesh) { insertMesh = createAlbumInsert(cover, thickness); scene!.add(insertMesh); }
      else if (insertKey !== nextKey) { insertMesh.geometry.dispose(); insertMesh.geometry = albumInsertGeometry(cover, thickness); }
      insertKey = nextKey;
      insertMesh.visible = showAlbumCover;
    } else if (insertMesh) insertMesh.visible = false;
    coverNote.textContent = physical
      ? trUi("专辑位于封装玻璃后方，玻璃的透色与反光会参与预览。")
      : options.getCover().url?.trim()
        ? trUi("封面以原始颜色独立呈现，不受盒体材质调色影响。")
        : trUi("当前没有封面，使用安静的文字占位。可拖动旋转盒体。");
    setCaseAlbumOcclusion(model, physical && showAlbumCover && insertMesh?.visible === true);
  }

  function setCover() {
    if (!coverMaterial) return;
    const cover = options.getCover();
    const url = cover.url?.trim() ?? "";
    const title = cover.title?.trim() ?? "";
    const nextKey = url
      ? `url:${url}`
      : `placeholder:${options.getTheme()}:${title}`;
    coverTitle.textContent = title || trUi("唱片盒体预览");
    coverNote.textContent = settings.structure === "punk" || settings.structure === "rhine" ? trUi("专辑位于封装玻璃后方，玻璃的透色与反光会参与预览。") : url
      ? trUi("封面以原始颜色独立呈现，不受盒体材质调色影响。")
      : trUi("当前没有封面，使用安静的文字占位。可拖动旋转盒体。");
    if (nextKey === coverKey) return;
    coverKey = nextKey;
    const revision = ++coverRevision;
    if (!url) {
      setCoverTexture(makePlaceholderTexture(title));
      return;
    }
    const texture = new THREE.TextureLoader().load(
      url,
      (loaded) => {
        if (destroyed || revision !== coverRevision) {
          loaded.dispose();
          return;
        }
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.needsUpdate = true;
        setCoverTexture(loaded);
      },
      undefined,
      () => {
        texture.dispose();
        if (destroyed || revision !== coverRevision) return;
        setCoverTexture(makePlaceholderTexture(title));
      },
    );
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  function setTheme() {
    const night = options.getTheme() === "night";
    root.dataset.theme = night ? "night" : "day";
    if (scene) {
      scene.background = new THREE.Color(night ? "#07111f" : "#eae5e1");
    }
    studio?.setTheme(night ? "night" : "day");
    setCover();
    render();
  }

  function applyModelAppearance() {
    if (!model) return;
    updateCoverLayout();
    if (settings.structure === "minimal")
      prepareHiResGold(model, isHiResAlbum(options.getAlbumInfo?.().record?.album));
    applyCaseAppearance(model, previewAppearance(), {
      lighting: options.getTheme() === "night" ? "refined" : "baseline",
      transmission: options.getQuality().transmission,
    });
    illumination?.apply(previewAppearance(), options.getQuality());
    illumination?.update(model);
    syncAlbumInfo();
  }

  function syncAlbumInfo() {
    if (!model || !scene || !renderer || settings.structure === "minimal") {
      albumInfo?.dispose(); albumInfo = undefined;
      if (badgeAnimationFrame) cancelAnimationFrame(badgeAnimationFrame);
      badgeAnimationFrame = 0;
      return;
    }
    if (!albumInfo) {
      const info = albumInfo = new CaseAlbumInfo(0, getCaseLayout(model), renderer.capabilities.maxTextureSize, renderer.capabilities.getMaxAnisotropy(), settings.structure);
      scene.add(info.selectedLabel, info.selectedBadge);
      void info.ready.then(() => { if (!destroyed && albumInfo === info) { render(); startBadgeAnimation(); } });
    }
    const current = options.getAlbumInfo?.();
    albumInfo.setVisibility(true);
    albumInfo.select(current?.record, current?.index);
    albumInfo.applyAppearance(previewAppearance(), model);
    albumInfo.setMotion(undefined, current?.reduced === true);
    startBadgeAnimation();
  }

  function startBadgeAnimation() {
    if (badgeAnimationFrame || !albumInfo?.selectedBadge.visible || options.getAlbumInfo?.().reduced ||
      destroyed || !root.isConnected || !intersecting || document.visibilityState === "hidden") return;
    badgeAnimationFrame = requestAnimationFrame(() => { badgeAnimationFrame = 0; render(); startBadgeAnimation(); });
  }

  function updateModel() {
    if (destroyed) return;
    previewStage.dataset.caseStructure = settings.structure;
    if (!scene) return;
    // Editing always shows every available part; scene LOD must not turn a
    // screw/lettering control into a no-op while the user is adjusting it.
    const detail = settings.structure === "minimal" ? "low" : "high";
    const key = `${settings.structure}:${detail}`;
    if (model && currentKey === key) {
      modelRevision++;
      pendingKey = undefined;
      applyModelAppearance();
      previewStage.dataset.casePreviewState = "ready";
      render();
      return;
    }
    if (pendingKey === key) return;
    const revision = ++modelRevision;
    pendingKey = key;
    const structure = settings.structure;
    previewStage.dataset.casePreviewState = "loading";
    void createCaseModel(structure, detail)
      .then((nextModel) => {
        if (destroyed || revision !== modelRevision) {
          disposeCaseModel(nextModel);
          return;
        }
        pendingKey = undefined;
        if (model) {
          albumInfo?.dispose(); albumInfo = undefined;
          scene!.remove(model);
          disposeCaseModel(model);
        }
        model = nextModel;
        currentKey = key;
        errorNode.hidden = true;
        if (selectedView === "front") setView("front");
        applyModelAppearance();
        syncSurfaceControls();
        scene!.add(model);
        previewStage.dataset.caseStructure = structure;
        previewStage.dataset.casePreviewState = "ready";
        render();
      })
      .catch((error: unknown) => {
        if (destroyed || revision !== modelRevision) return;
        pendingKey = undefined;
        previewStage.dataset.caseStructure = structure;
        previewStage.dataset.casePreviewState = "error";
        errorNode.hidden = false;
        errorNode.textContent = `${trUi("无法载入盒体模型：")} ${error instanceof Error ? error.message : String(error)}`;
      });
  }

  function render() {
    if (!renderer || !scene || !camera || destroyed) return;
    if (
      !root.isConnected ||
      !intersecting ||
      document.visibilityState === "hidden"
    )
      return;
    const bounds = previewStage.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    renderer.render(scene, camera);
  }

  function resizePreview() {
    if (!renderer || !camera || !controls || destroyed) return;
    const width = Math.floor(canvasHost.clientWidth);
    const height = Math.floor(canvasHost.clientHeight);
    if (width <= 0 || height <= 0) return;
    const quality = options.getQuality();
    studio?.setQuality(quality);
    const dimensions = renderDimensions(quality, width, height, 1, window.devicePixelRatio || 1, renderer.capabilities.maxTextureSize);
    renderer.setPixelRatio(dimensions.ratio);
    renderer.transmissionResolutionScale = quality.transmission;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    controls.update();
    render();
  }

  function setView(view: EditorView) {
    if (!camera || !controls) return;
    selectedView = view;
    const cover = getCaseLayout(model).cover;
    const target =
      view === "front"
        ? new THREE.Vector3(cover.x, cover.y, cover.z)
        : new THREE.Vector3(
            MUSIC_MODEL.center.x,
            MUSIC_MODEL.center.y,
            MUSIC_MODEL.center.z,
          );
    controls.target.copy(target);
    if (view === "front")
      camera.position.set(cover.x, cover.y, cover.z + 9.8);
    else camera.position.set(5.8, 4.9, 7.2);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    controls.update();
    syncSettingsUI();
    render();
  }

  function refresh() {
    if (destroyed) return;
    settings = themeSettings(options.getSettings());
    syncSettingsUI();
    setTheme();
    updateModel();
    resizePreview();
  }

  function onClick(event: Event) {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("button")
        : null;
    if (!target || !root.contains(target)) return;
    const userPresetId = target.dataset.userPreset;
    const deletePresetId = target.dataset.deleteUserPreset;
    if (userPresetId || deletePresetId || ["save-user-preset", "confirm-delete-preset", "cancel-delete-preset"].includes(target.dataset.action ?? "")) {
      if (!canUsePersonalPresets()) return;
      const presets = personalPresets();
      try {
        if (userPresetId) {
          const preset = presets.find(item => item.id === userPresetId);
          if (!preset) return;
          const next = cloneSettings(settings);
          next.appearances.punk = caseUserPresetAppearance(preset.appearance);
          next.enabled = true;
          onSettingsChanged(next);
          personalStatus.textContent = `${trUi("已使用个人预设：")}${preset.name}`;
        } else if (deletePresetId) {
          const preset = presets.find(item => item.id === deletePresetId);
          if (!preset) return;
          pendingDeleteId = preset.id;
          root.querySelector<HTMLElement>("[data-delete-preset-message]")!.textContent = `${trUi("删除这个个人预设？") } ${preset.name}`;
          deleteRow.hidden = false;
        } else if (target.dataset.action === "cancel-delete-preset") {
          pendingDeleteId = undefined;
          deleteRow.hidden = true;
        } else if (target.dataset.action === "confirm-delete-preset") {
          if (!pendingDeleteId) return;
          options.onUserPresetsChange!(presets.filter(item => item.id !== pendingDeleteId));
          pendingDeleteId = undefined;
          personalStatus.textContent = trUi("预设已删除，当前盒体外观保留。");
          syncPersonalPresets();
        } else {
          const name = personalName.value.trim();
          if (!name) { personalStatus.textContent = trUi("请先填写预设名称。"); personalName.focus(); return; }
          if (Array.from(name).length > 64) { personalStatus.textContent = trUi("预设名称最多64个字符。"); return; }
          if (presets.some(preset => preset.name.toLowerCase() === name.toLowerCase())) {
            personalStatus.textContent = trUi("已有同名预设，请使用其他名称。"); personalName.focus(); return;
          }
          if (presets.length >= CASE_USER_PRESET_LIMIT) { personalStatus.textContent = trUi("个人预设已达50个，请先删除不需要的预设。"); return; }
          const preset = { id: crypto.randomUUID(), name, appearance: caseUserPresetAppearance(currentAppearance()) };
          options.onUserPresetsChange!([...presets, preset]);
          personalName.value = "";
          pendingDeleteId = undefined;
          personalStatus.textContent = `${trUi("已保存到本机：")}${name}`;
          syncPersonalPresets();
        }
      } catch (error) {
        personalStatus.textContent = `${trUi("预设未保存：")}${error instanceof Error ? error.message : String(error)}`;
      }
      return;
    }
    const structure = target.dataset.structure as CaseStructure | undefined;
    if (structure) {
      if (!caseStructuresForDesign(options.getDesign()).includes(structure)) return;
      if (structure === settings.structure) return;
      const next = cloneSettings(settings);
      next.structure = structure;
      if (structure === "rhine") selectedPart = "cover";
      if (options.getDesign() === "rhine" && structure === "minimal") showAlbumCover = true;
      next.enabled = true;
      onSettingsChanged(next);
      return;
    }
    const presetId = target.dataset.preset;
    if (presetId && Object.hasOwn(caseAppearancePresets, presetId)) {
      if (settings.structure !== "punk") return;
      const next = cloneSettings(settings);
      const preset = casePreset(presetId, next.structure);
      const transforms = next.appearances[next.structure].transforms;
      if (transforms) preset.transforms = structuredClone(transforms);
      next.appearances[next.structure] = preset;
      next.enabled = true;
      onSettingsChanged(next);
      return;
    }
    const part = target.dataset.part as CasePart | undefined;
    if (part && casePartsForStructure(settings.structure).includes(part)) {
      selectedPart = part;
      syncSurfaceControls();
      return;
    }
    const view = target.dataset.view as EditorView | undefined;
    if (view === "display" || view === "front") {
      setView(view);
      return;
    }
    if (target.dataset.action === "reset") {
      const next = cloneSettings(settings);
      if (options.getDesign() === "rhine" && settings.structure === "minimal") {
        const defaults = defaultCaseSettings("rhine").appearances.minimal.surfaces;
        for (const part of ["cover", "back"] as const) {
          const surface = next.appearances.minimal.surfaces[part];
          const base = defaults[part];
          surface.transmission = base.transmission;
          surface.roughness = base.roughness;
          surface.preserveSource = base.preserveSource;
        }
        next.appearances.minimal.preset = "custom";
        next.enabled = true;
        onSettingsChanged(next);
        return;
      }
      if (options.getDesign() === "rhine" && settings.structure === "rhine") {
        for (const surface of Object.values(next.appearances.rhine.surfaces)) {
          delete surface.transmissionOverride;
          delete surface.opacityOverride;
        }
        onSettingsChanged(next);
        return;
      }
      const defaults = defaultCaseSettings(options.getDesign());
      next.appearances[next.structure] = structuredClone(
        defaults.appearances[next.structure],
      );
      onSettingsChanged(next);
      return;
    }
    if (target.dataset.action === "apply-part-preset") {
      if (settings.structure !== "punk") return;
      const presetId = partPresetSelect.value;
      if (!Object.hasOwn(caseAppearancePresets, presetId)) return;
      const next = cloneSettings(settings);
      const appearance = next.appearances[next.structure];
      const source = casePreset(presetId, next.structure).surfaces[selectedPart];
      appearance.surfaces[selectedPart] = structuredClone(source);
      appearance.preset = "custom";
      next.enabled = true;
      onSettingsChanged(next);
    }
  }

  function applySurfaceValue(target: HTMLInputElement | HTMLSelectElement) {
    if (!canEditFinish()) return;
    const field = target.dataset.surfaceField as SurfaceField | undefined;
    if (!field || !casePartsForStructure(settings.structure).includes(selectedPart)) return;
    const next = cloneSettings(settings);
    const surface = next.appearances[next.structure].surfaces[selectedPart];
    if (field === "preserveSource") {
      if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
      if (!target.checked && surface.preserveSource) Object.assign(surface, nativeSurface(selectedPart, surface));
      surface.preserveSource = target.checked;
    } else if (field === "finish") {
      if (!Object.hasOwn(caseFinishLabels, target.value)) return;
      surface.finish = target.value as CaseFinish;
      surface.metalness = surface.finish === "metal" ? .75 : 0;
      if ((surface.finish === "glass" || surface.finish === "frost") && surface.transmission === 0)
        surface.transmission = surface.finish === "glass" ? .92 : .78;
      surface.preserveSource = false;
    } else if (field === "pattern") {
      if (!Object.hasOwn(casePatternLabels, target.value)) return;
      surface.pattern = target.value as CaseSurface["pattern"];
      surface.preserveSource = false;
    } else if (field === "color") {
      surface.color = target.value.toUpperCase();
      surface.preserveSource = false;
    } else if (field === "secondaryColor") {
      surface.secondaryColor = target.value.toUpperCase();
      surface.preserveSource = false;
    } else {
      const value = Number(target.value);
      if (!Number.isFinite(value)) return;
      if (!Object.hasOwn(SURFACE_LIMITS, field)) return;
      const [min, max] = SURFACE_LIMITS[field as SurfaceNumericField];
      surface[field as SurfaceNumericField] = clamp(value, min, max);
      surface.preserveSource = false;
    }
    next.appearances[next.structure].preset = "custom";
    next.enabled = true;
    onSettingsChanged(next);
  }

  function applyTransformValue(target: HTMLInputElement) {
    if (options.getDesign() === "rhine" && settings.structure !== "punk") return;
    const next = cloneSettings(settings);
    const appearance = next.appearances[next.structure];
    const saved = appearance.transforms?.[selectedPart] ?? defaultTransform;
    const transform: CaseTransform = {
      visible: saved.visible,
      offset: [saved.offset[0], saved.offset[1], saved.offset[2]],
      rotation: [saved.rotation[0], saved.rotation[1], saved.rotation[2]],
      scale: [saved.scale[0], saved.scale[1], saved.scale[2]],
    };
    if (target.hasAttribute("data-transform-visible")) {
      transform.visible = target.checked;
    } else {
      const field = target.dataset.transformValue as TransformVector | undefined;
      const axis = Number(target.dataset.axis);
      const value = Number(target.value);
      if (!field || !["offset", "rotation", "scale"].includes(field) ||
        !Number.isInteger(axis) || axis < 0 || axis > 2 || !Number.isFinite(value)) return;
      const bounds: Record<TransformVector, [number, number]> = {
        offset: [-10, 10],
        rotation: [-360, 360],
        scale: [0.01, 10],
      };
      transform[field][axis] = clamp(value, ...bounds[field]);
    }
    appearance.transforms = {
      ...appearance.transforms,
      [selectedPart]: transform,
    };
    appearance.preset = "custom";
    next.enabled = true;
    onSettingsChanged(next);
  }

  function onInput(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.colorCode) {
      target.removeAttribute("aria-invalid");
      root.querySelector<HTMLElement>(`[data-color-code-error="${target.dataset.colorCode}"]`)!.hidden = true;
      return;
    }
    if (target.dataset.minimalGlass) {
      if (options.getDesign() !== "rhine" || settings.structure !== "minimal") return;
      const field = target.dataset.minimalGlass;
      if (field !== "transmission" && field !== "roughness") return;
      const value = Number(target.value);
      if (!Number.isFinite(value)) return;
      const next = cloneSettings(settings);
      const appearance = next.appearances.minimal;
      const defaults = defaultCaseSettings("rhine").appearances.minimal.surfaces;
      const normalized = clamp(value, 0, 1);
      for (const part of ["cover", "back"] as const) {
        const surface = appearance.surfaces[part];
        if (surface.finish !== "glass" && surface.finish !== "frost")
          surface.finish = defaults[part].finish;
        surface[field] = normalized;
        surface.preserveSource = false;
      }
      appearance.preset = "custom";
      next.enabled = true;
      onSettingsChanged(next);
      return;
    }
    if (target.dataset.rhineOptics) {
      if (options.getDesign() !== "rhine" || settings.structure !== "rhine") return;
      const field = target.dataset.rhineOptics;
      if (field !== "transmission" && field !== "transparency") return;
      const value = Number(target.value);
      if (!Number.isFinite(value)) return;
      const next = cloneSettings(settings);
      const surface = next.appearances.rhine.surfaces[selectedPart];
      if (field === "transmission") surface.transmissionOverride = clamp(value, 0, 1);
      else surface.opacityOverride = 1 - clamp(value, 0, 1);
      next.appearances.rhine.preset = "custom";
      onSettingsChanged(next);
      return;
    }
    if (target.dataset.field === "show-cover") {
      showAlbumCover = target.checked;
      updateCoverLayout();
      render();
      return;
    }
    if (target.hasAttribute("data-transform-visible")) {
      applyTransformValue(target);
      return;
    }
    if (target.dataset.transformValue) return;
    applySurfaceValue(target);
  }

  function onChange(event: Event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.colorCode) {
      applyColorCode(target);
      return;
    }
    if (target instanceof HTMLSelectElement && target.hasAttribute("data-rhine-optics-part")) {
      if (options.getDesign() !== "rhine" || settings.structure !== "rhine" || !casePartsForStructure("rhine").includes(target.value as CasePart)) return;
      selectedPart = target.value as CasePart;
      syncSurfaceControls();
      return;
    }
    if (target instanceof HTMLSelectElement && target.hasAttribute("data-finish-part")) {
      if (settings.structure !== "punk") return;
      if (!casePartsForStructure("punk").includes(target.value as CasePart)) return;
      selectedPart = target.value as CasePart;
      syncSurfaceControls();
      return;
    }
    if (target instanceof HTMLSelectElement) applySurfaceValue(target);
    else if (target instanceof HTMLInputElement && target.dataset.transformValue)
      applyTransformValue(target);
  }

  function applyColorCode(target: HTMLInputElement) {
    const field = target.dataset.colorCode;
    if ((field !== "color" && field !== "secondaryColor") || target.disabled || !canEditFinish()) return;
    const value = hexColor(target.value);
    const error = root.querySelector<HTMLElement>(`[data-color-code-error="${field}"]`)!;
    if (!value) {
      target.setAttribute("aria-invalid", "true");
      error.hidden = false;
      return;
    }
    target.value = value;
    target.removeAttribute("aria-invalid");
    error.hidden = true;
    const picker = root.querySelector<HTMLInputElement>(`[data-surface-field="${field}"]`)!;
    if (currentAppearance().surfaces[selectedPart][field]?.toUpperCase() === value) return;
    picker.value = value;
    applySurfaceValue(picker);
  }

  function onKeydown(event: KeyboardEvent) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.colorCode && !event.isComposing) {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Enter") applyColorCode(target);
        else syncSurfaceControls();
      }
      return;
    }
    if (event.target === personalName && event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      root.querySelector<HTMLButtonElement>("[data-action=save-user-preset]")!.click();
    }
  }

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: options.getQuality().antialias !== "off",
      alpha: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = options.getTheme() === "night" ? 1.08 : 1.05;
    renderer.domElement.setAttribute(
      "aria-label",
      trUi("可拖动旋转的盒体三维预览"),
    );
    canvasHost.append(renderer.domElement);
    scene = new THREE.Scene();
    illumination = createCaseIllumination(scene);
    studio = createCaseStudioLighting(renderer, scene);
    studio.setQuality(options.getQuality());
    camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
    camera.position.set(5.8, 4.9, 7.2);
    camera.lookAt(
      MUSIC_MODEL.center.x,
      MUSIC_MODEL.center.y,
      MUSIC_MODEL.center.z,
    );
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 4.2;
    controls.maxDistance = 15;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI - 0.12;
    controls.target.set(
      MUSIC_MODEL.center.x,
      MUSIC_MODEL.center.y,
      MUSIC_MODEL.center.z,
    );
    controls.addEventListener("change", render);

    const initialCover = getCaseLayout().cover;
    coverGeometry = new THREE.PlaneGeometry(initialCover.width, initialCover.height);
    coverLayoutKey = `${initialCover.width}:${initialCover.height}`;
    coverMaterial = createAlbumPrintMaterial(null);
    coverMesh = new THREE.Mesh(coverGeometry, coverMaterial);
    coverMesh.name = "IndependentAlbumCover";
    coverMesh.position.set(initialCover.x, initialCover.y, initialCover.z);
    coverMesh.visible = showAlbumCover;
    coverMesh.renderOrder = 0;
    coverMesh.receiveShadow = true;
    scene.add(coverMesh);

    setTheme();
    setCover();
    updateModel();
    resizePreview();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(resizePreview);
      resizeObserver.observe(canvasHost);
    } else {
      windowResizeHandler = resizePreview;
      window.addEventListener("resize", windowResizeHandler);
    }
    if (typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        intersecting = !!entry?.isIntersecting;
        if (intersecting) { resizePreview(); startBadgeAnimation(); }
      });
      intersectionObserver.observe(root);
    }
    documentVisibilityHandler = () => {
      if (document.visibilityState === "visible") { render(); startBadgeAnimation(); }
    };
    document.addEventListener("visibilitychange", documentVisibilityHandler);
  } catch (error) {
    errorNode.hidden = false;
    errorNode.textContent =
      error instanceof Error
        ? error.message
        : trUi("当前浏览器无法创建 3D 预览。");
  }

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("keydown", onKeydown);
  syncSettingsUI();

  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      modelRevision++;
      if (badgeAnimationFrame) cancelAnimationFrame(badgeAnimationFrame);
      albumInfo?.dispose(); albumInfo = undefined;
      coverRevision++;
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onChange);
      root.removeEventListener("keydown", onKeydown);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      if (documentVisibilityHandler)
        document.removeEventListener(
          "visibilitychange",
          documentVisibilityHandler,
        );
      if (windowResizeHandler)
        window.removeEventListener("resize", windowResizeHandler);
      controls?.removeEventListener("change", render);
      controls?.dispose();
      if (model) {
        scene?.remove(model);
        disposeCaseModel(model);
        model = undefined;
      }
      if (coverMesh) scene?.remove(coverMesh);
      if (insertMesh) { scene?.remove(insertMesh); insertMesh.geometry.dispose(); insertMesh.material.dispose(); }
      coverGeometry?.dispose();
      coverMaterial?.dispose();
      for (const texture of ownedTextures) texture.dispose();
      ownedTextures.clear();
      studio?.dispose();
      illumination?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
      root.remove();
    },
  };
}
