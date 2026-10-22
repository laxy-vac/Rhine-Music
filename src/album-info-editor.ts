import { trUi, ui } from "./i18n";
import { enhanceSettingsSelectControls } from "./settings-select-controls";
import type { MusicAlbum, MusicLibrary } from "./music-types";
import type {
  AlbumInfoCandidate,
  AlbumInfoDocument,
  AlbumInfoSearch,
  AlbumInfoSources,
  AlbumInfoSource,
  EditorCover,
  MetadataEditorCallbacks,
  TrackInfoDocument,
  TrackInfoSave,
} from "./metadata-editor-types";
import "./album-info-editor.css";

type EditorMode = "album" | "tracks";
type AlbumTab = "online" | "manual";
type TrackTab = "basic" | "more" | "cover" | "file";

const BASIC_TRACK_FIELDS: Array<[string, string]> = [
  ["TITLE", "曲名"],
  ["ARTIST", "歌手"],
  ["ALBUM", "专辑"],
  ["ALBUMARTIST", "专辑歌手"],
  ["DATE", "日期"],
  ["TRACKNUMBER", "曲目编号"],
  ["TRACKTOTAL", "曲目总数"],
  ["DISCNUMBER", "碟片编号"],
  ["DISCTOTAL", "碟片总数"],
  ["GENRE", "流派"],
  ["COMPOSER", "作曲"],
  ["LYRICIST", "作词"],
  ["COMMENT", "备注"],
];
const BASIC_FIELD_KEYS = new Set(BASIC_TRACK_FIELDS.map(([key]) => key));
const MULTI_VALUE_FIELD_KEYS = new Set(["GENRE", "COMPOSER", "LYRICIST"]);
const SINGLE_VALUE_FIELD_KEYS = new Set([
  "TITLE", "ALBUM", "DATE", "TRACKNUMBER", "TRACKTOTAL", "DISCNUMBER", "DISCTOTAL", "COMMENT",
]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_COVER_BYTES = 8 * 1024 * 1024;
let instanceNumber = 0;

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(document: Document, className: string, label: string): HTMLButtonElement {
  const node = element(document, "button", className, label);
  node.type = "button";
  return node;
}

function setHidden(node: HTMLElement, hidden: boolean): void {
  node.hidden = hidden;
  node.setAttribute("aria-hidden", String(hidden));
}

function cloneFields(fields: Record<string, string[]> | undefined): Record<string, string[]> {
  const clone: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(fields ?? {})) {
    clone[key] = Array.isArray(values) ? values.map((value) => String(value ?? "")) : [String(values ?? "")];
  }
  return clone;
}

function equalFields(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.every((key) => {
    const left = a[key];
    const right = b[key];
    return left === undefined && right === undefined || !!left && !!right && left.length === right.length && left.every((value, index) => value === right[index]);
  });
}

function cloneCover(cover: EditorCover): EditorCover {
  return { ...cover };
}

function equalCover(a: EditorCover, b: EditorCover): boolean {
  return a.mode === b.mode && a.dataUrl === b.dataUrl && a.candidateId === b.candidateId;
}

function cleanChangedFields(fields: Record<string, string[]>, changed: Set<string>): Record<string, string[]> {
  const result = cloneFields(fields);
  for (const key of changed) {
    const values = (result[key] ?? []).filter((value) => value.trim().length > 0);
    if (values.length) result[key] = values;
    else delete result[key];
  }
  return result;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatModified(value: string): string {
  if (!value) return "—";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(time);
}

function fileMime(file: File): string | undefined {
  const mime = file.type.toLowerCase();
  if (IMAGE_MIME_TYPES.has(mime)) return mime;
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return undefined;
}

async function fileAsDataUrl(file: File, mime: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function validHttpTemplate(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const normalized = value.replace(/\{(?:query|album|artist|id)\}/giu, "value");
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function setupAlbumInfoEditor(
  root: HTMLElement,
  callbacks: MetadataEditorCallbacks,
): {
  open(album: MusicAlbum): void;
  close(): void;
  destroy(): void;
  mountSources(host: HTMLElement, options?: { connectionHost?: HTMLElement }): () => void;
  refreshSources(): void;
} {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const prefix = `metadata-editor-${++instanceNumber}`;
  let disposed = false;

  const albumBackdrop = element(document, "div", "metadata-editor-backdrop album-info-editor-backdrop");
  albumBackdrop.dataset.albumInfoEditorBackdrop = "true";
  albumBackdrop.hidden = true;
  albumBackdrop.setAttribute("aria-hidden", "true");
  const albumDialog = element(document, "section", "metadata-editor-dialog album-info-editor-dialog");
  albumDialog.tabIndex = -1;
  albumDialog.setAttribute("role", "dialog");
  albumDialog.setAttribute("aria-modal", "true");
  albumDialog.setAttribute("aria-labelledby", `${prefix}-album-title`);
  const albumHeader = element(document, "header", "metadata-editor-header");
  const albumHeaderText = element(document, "div", "metadata-editor-heading");
  albumHeaderText.append(element(document, "small", "metadata-editor-kicker", trUi("专辑资料 / 编辑")));
  const albumTitle = element(document, "h2", "", trUi("编辑专辑信息"));
  albumTitle.id = `${prefix}-album-title`;
  const albumSubtitle = element(document, "p", "metadata-editor-subtitle", "");
  albumHeaderText.append(albumTitle, albumSubtitle);
  const albumHeaderActions = element(document, "div", "metadata-editor-header-actions");
  const albumCloseButton = button(document, "metadata-editor-close", "×");
  albumCloseButton.setAttribute("aria-label", trUi("关闭专辑资料编辑"));
  albumHeaderActions.append(albumCloseButton);
  albumHeader.append(albumHeaderText, albumHeaderActions);

  const sectionTabs = element(document, "div", "metadata-editor-tabs metadata-editor-primary-tabs");
  sectionTabs.setAttribute("role", "tablist");
  sectionTabs.setAttribute("aria-label", trUi("编辑内容"));
  const albumSectionButton = button(document, "metadata-editor-tab", trUi("专辑信息"));
  const trackSectionButton = button(document, "metadata-editor-tab", trUi("歌曲信息"));
  const albumSection = element(document, "section", "metadata-editor-section metadata-editor-album-section");
  const trackSection = element(document, "section", "metadata-editor-section metadata-editor-track-section");
  for (const [mode, tab, panel] of [["album", albumSectionButton, albumSection], ["tracks", trackSectionButton, trackSection]] as const) {
    tab.id = `${prefix}-section-tab-${mode}`;
    tab.dataset.editorSection = mode;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(mode === "album"));
    tab.setAttribute("aria-controls", `${prefix}-section-${mode}`);
    tab.tabIndex = mode === "album" ? 0 : -1;
    panel.id = `${prefix}-section-${mode}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.hidden = mode !== "album";
  }
  sectionTabs.append(albumSectionButton, trackSectionButton);

  const albumTabs = element(document, "div", "metadata-editor-tabs");
  albumTabs.setAttribute("role", "tablist");
  albumTabs.setAttribute("aria-label", trUi("专辑资料来源"));
  const onlineTabButton = button(document, "metadata-editor-tab", trUi("在线资料"));
  onlineTabButton.id = `${prefix}-album-tab-online`;
  onlineTabButton.setAttribute("role", "tab");
  onlineTabButton.setAttribute("aria-selected", "true");
  onlineTabButton.setAttribute("aria-controls", `${prefix}-album-online-panel`);
  const manualTabButton = button(document, "metadata-editor-tab", trUi("手动编辑"));
  manualTabButton.id = `${prefix}-album-tab-manual`;
  manualTabButton.setAttribute("role", "tab");
  manualTabButton.setAttribute("aria-selected", "false");
  manualTabButton.setAttribute("aria-controls", `${prefix}-album-manual-panel`);
  albumTabs.append(onlineTabButton, manualTabButton);

  const albumBody = element(document, "div", "metadata-editor-body metadata-editor-album-body");
  const albumStatus = element(document, "p", "metadata-editor-status");
  albumStatus.setAttribute("role", "status");
  albumStatus.setAttribute("aria-live", "polite");
  const onlinePanel = element(document, "section", "metadata-editor-panel metadata-editor-online-panel");
  onlinePanel.id = `${prefix}-album-online-panel`;
  onlinePanel.setAttribute("role", "tabpanel");
  onlinePanel.setAttribute("aria-labelledby", onlineTabButton.id);
  const manualPanel = element(document, "section", "metadata-editor-panel metadata-editor-manual-panel");
  manualPanel.id = `${prefix}-album-manual-panel`;
  manualPanel.hidden = true;
  manualPanel.setAttribute("role", "tabpanel");
  manualPanel.setAttribute("aria-labelledby", manualTabButton.id);
  const albumFooter = element(document, "footer", "metadata-editor-footer");
  const albumDirtyPrompt = element(document, "div", "metadata-editor-discard-prompt");
  albumDirtyPrompt.hidden = true;
  albumDirtyPrompt.setAttribute("role", "alert");
  const albumDirtyText = element(document, "span", "", trUi("有未保存的更改。"));
  const albumContinueButton = button(document, "metadata-editor-secondary", trUi("继续编辑"));
  const albumDiscardButton = button(document, "metadata-editor-danger", trUi("放弃更改"));
  albumDirtyPrompt.append(albumDirtyText, albumContinueButton, albumDiscardButton);
  const albumFooterStatus = element(document, "p", "metadata-editor-footer-status");
  albumFooterStatus.setAttribute("role", "status");
  const albumSaveButton = button(document, "metadata-editor-primary", trUi("保存专辑资料"));
  albumFooter.append(albumDirtyPrompt, albumFooterStatus, albumSaveButton);
  albumSection.append(albumTabs, albumBody, albumFooter);
  albumDialog.append(albumHeader, sectionTabs, albumSection, trackSection);
  albumBackdrop.append(albumDialog);

  const searchToolbar = element(document, "div", "metadata-editor-search-toolbar");
  const searchTitleLabel = element(document, "label", "metadata-editor-label", trUi("专辑名称"));
  const searchTitle = element(document, "input", "metadata-editor-input");
  searchTitle.type = "search";
  searchTitle.autocomplete = "off";
  searchTitleLabel.append(searchTitle);
  const searchArtistLabel = element(document, "label", "metadata-editor-label", trUi("艺人"));
  const searchArtist = element(document, "input", "metadata-editor-input");
  searchArtist.type = "search";
  searchArtist.autocomplete = "off";
  searchArtistLabel.append(searchArtist);
  const searchSourceLabel = element(document, "label", "metadata-editor-label", trUi("本专辑来源策略"));
  const searchSource = element(document, "select", "metadata-editor-select");
  searchSource.setAttribute("aria-label", trUi("选择资料来源"));
  searchSourceLabel.append(searchSource);
  const restoreGlobalSource = button(document, "metadata-editor-secondary metadata-editor-source-reset", trUi("恢复全局自动资料（保存后生效）"));
  restoreGlobalSource.title = trUi("保存后按全局来源顺序重新查询并清除本专辑的手工资料覆盖。");
  const searchButton = button(document, "metadata-editor-primary", trUi("搜索资料"));
  searchToolbar.append(searchTitleLabel, searchArtistLabel, searchSourceLabel, restoreGlobalSource, searchButton);
  const sourceStatusList = element(document, "div", "metadata-editor-source-statuses");
  sourceStatusList.setAttribute("aria-live", "polite");
  const sourceHelp = element(document, "p", "metadata-editor-help", trUi("MusicBrainz 仅在设置了有效的联系邮箱后才会显示。"));
  const sourcePreferenceStatus = element(document, "p", "metadata-editor-source-policy-status");
  const onlineResults = element(document, "div", "metadata-editor-results-layout");
  const candidateList = element(document, "div", "metadata-editor-candidate-list");
  candidateList.setAttribute("role", "listbox");
  candidateList.setAttribute("aria-label", trUi("在线专辑资料候选"));
  const candidateDetail = element(document, "section", "metadata-editor-candidate-detail");
  candidateDetail.setAttribute("aria-label", trUi("候选资料预览"));
  candidateDetail.append(element(document, "p", "metadata-editor-empty", trUi("选择一条候选资料查看介绍与封面。")));
  onlineResults.append(candidateList, candidateDetail);
  onlinePanel.append(sourcePreferenceStatus, searchToolbar, sourceHelp, sourceStatusList, onlineResults);

  const manualGrid = element(document, "div", "metadata-editor-manual-grid");
  const descriptionLabel = element(document, "label", "metadata-editor-label", trUi("专辑介绍"));
  const descriptionInput = element(document, "textarea", "metadata-editor-textarea");
  descriptionInput.rows = 8;
  descriptionInput.setAttribute("aria-label", trUi("专辑介绍"));
  descriptionLabel.append(descriptionInput);
  const albumCoverSection = element(document, "section", "metadata-editor-cover-section");
  albumCoverSection.append(element(document, "h3", "metadata-editor-section-title", trUi("专辑封面")));
  const albumCoverPreview = element(document, "div", "metadata-editor-cover-preview");
  const albumCoverImage = element(document, "img", "metadata-editor-cover-image");
  albumCoverImage.alt = trUi("专辑封面预览");
  albumCoverImage.hidden = true;
  const albumCoverPlaceholder = element(document, "span", "metadata-editor-cover-placeholder", trUi("暂无封面"));
  albumCoverPreview.append(albumCoverImage, albumCoverPlaceholder);
  const albumCoverControls = element(document, "div", "metadata-editor-cover-controls");
  const albumCoverFile = element(document, "input", "metadata-editor-file-input");
  albumCoverFile.type = "file";
  albumCoverFile.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
  albumCoverFile.setAttribute("aria-label", trUi("选择专辑封面"));
  const albumCoverUploadLabel = element(document, "label", "metadata-editor-secondary", trUi("上传封面"));
  albumCoverUploadLabel.append(albumCoverFile);
  const albumCoverInherit = button(document, "metadata-editor-secondary", trUi("恢复默认封面"));
  const albumCoverNote = element(document, "p", "metadata-editor-help", trUi("支持 JPEG、PNG、WebP，文件不超过 8 MiB。"));
  albumCoverControls.append(albumCoverUploadLabel, albumCoverInherit);
  albumCoverSection.append(albumCoverPreview, albumCoverControls, albumCoverNote);
  manualGrid.append(descriptionLabel, albumCoverSection);
  manualPanel.append(manualGrid);
  albumBody.append(albumStatus, onlinePanel, manualPanel);

  const trackBody = element(document, "div", "metadata-editor-body metadata-editor-track-body");
  const trackListPane = element(document, "aside", "metadata-editor-track-list-pane");
  const trackListHeading = element(document, "div", "metadata-editor-track-list-heading");
  trackListHeading.append(element(document, "small", "metadata-editor-kicker", trUi("曲目列表")));
  const trackListCount = element(document, "span", "metadata-editor-count", "0");
  trackListHeading.append(trackListCount);
  const trackList = element(document, "div", "metadata-editor-track-list");
  trackList.setAttribute("role", "listbox");
  trackList.setAttribute("aria-label", trUi("专辑歌曲"));
  trackListPane.append(trackListHeading, trackList);
  const trackEditor = element(document, "section", "metadata-editor-track-editor");
  const trackEditorHeader = element(document, "div", "metadata-editor-track-editor-header");
  const trackCurrentLabel = element(document, "p", "metadata-editor-current-track", trUi("选择一首歌曲开始编辑。"));
  trackEditorHeader.append(trackCurrentLabel);
  const trackTabs = element(document, "div", "metadata-editor-tabs metadata-editor-track-tabs");
  trackTabs.setAttribute("role", "tablist");
  trackTabs.setAttribute("aria-label", trUi("歌曲信息分类"));
  const trackTabButtons = new Map<TrackTab, HTMLButtonElement>();
  const trackPanels = new Map<TrackTab, HTMLElement>();
  const trackTabLabels: Array<[TrackTab, string]> = [
    ["basic", "基本信息"], ["more", "更多标签"], ["cover", "封面"], ["file", "文件属性"],
  ];
  for (const [tab, label] of trackTabLabels) {
    const tabButton = button(document, "metadata-editor-tab", trUi(label));
    tabButton.id = `${prefix}-track-tab-${tab}`;
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-controls", `${prefix}-track-panel-${tab}`);
    tabButton.setAttribute("aria-selected", String(tab === "basic"));
    tabButton.tabIndex = tab === "basic" ? 0 : -1;
    trackTabButtons.set(tab, tabButton);
    trackTabs.append(tabButton);
    const panel = element(document, "div", `metadata-editor-panel metadata-editor-track-panel metadata-editor-track-panel-${tab}`);
    panel.id = `${prefix}-track-panel-${tab}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tabButton.id);
    panel.hidden = tab !== "basic";
    trackPanels.set(tab, panel);
  }
  const trackStatus = element(document, "p", "metadata-editor-status");
  trackStatus.setAttribute("role", "status");
  trackStatus.setAttribute("aria-live", "polite");
  const readOnlyNotice = element(document, "p", "metadata-editor-readonly-notice");
  readOnlyNotice.hidden = true;
  const basicFieldsHost = element(document, "div", "metadata-editor-field-list");
  trackPanels.get("basic")!.append(basicFieldsHost);
  const moreFieldsHost = element(document, "div", "metadata-editor-field-list metadata-editor-more-fields");
  const addTagForm = element(document, "div", "metadata-editor-add-tag");
  const addTagKey = element(document, "input", "metadata-editor-input");
  addTagKey.type = "text";
  addTagKey.autocomplete = "off";
  addTagKey.placeholder = trUi("标签名称，如 MUSICBRAINZ_RELEASEID");
  addTagKey.setAttribute("aria-label", trUi("新增标签名称"));
  const addTagButton = button(document, "metadata-editor-secondary", trUi("添加标签"));
  addTagForm.append(addTagKey, addTagButton);
  trackPanels.get("more")!.append(moreFieldsHost, addTagForm);
  const trackCoverPanel = trackPanels.get("cover")!;
  const trackCoverPreview = element(document, "div", "metadata-editor-cover-preview metadata-editor-track-cover-preview");
  const trackCoverImage = element(document, "img", "metadata-editor-cover-image");
  trackCoverImage.alt = trUi("歌曲封面预览");
  trackCoverImage.hidden = true;
  const trackCoverPlaceholder = element(document, "span", "metadata-editor-cover-placeholder", trUi("继承专辑封面"));
  trackCoverPreview.append(trackCoverImage, trackCoverPlaceholder);
  const trackCoverFile = element(document, "input", "metadata-editor-file-input");
  trackCoverFile.type = "file";
  trackCoverFile.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
  trackCoverFile.setAttribute("aria-label", trUi("选择歌曲封面"));
  const trackCoverUploadLabel = element(document, "label", "metadata-editor-secondary", trUi("上传歌曲封面"));
  trackCoverUploadLabel.append(trackCoverFile);
  const trackCoverInherit = button(document, "metadata-editor-secondary", trUi("恢复继承专辑封面"));
  const trackCoverInfo = element(document, "p", "metadata-editor-help", "");
  trackCoverPanel.append(trackCoverPreview, trackCoverUploadLabel, trackCoverInherit, trackCoverInfo);
  const fileProperties = element(document, "dl", "metadata-editor-file-properties");
  trackPanels.get("file")!.append(fileProperties);
  trackEditor.append(trackEditorHeader, trackStatus, readOnlyNotice, ...trackPanels.values());
  trackBody.append(trackListPane, trackEditor);
  const trackFooter = element(document, "footer", "metadata-editor-footer");
  const trackDirtyPrompt = element(document, "div", "metadata-editor-discard-prompt");
  trackDirtyPrompt.hidden = true;
  trackDirtyPrompt.setAttribute("role", "alert");
  const trackDirtyText = element(document, "span", "", trUi("有未保存的更改。"));
  const trackContinueButton = button(document, "metadata-editor-secondary", trUi("继续编辑"));
  const trackDiscardButton = button(document, "metadata-editor-danger", trUi("放弃更改"));
  trackDirtyPrompt.append(trackDirtyText, trackContinueButton, trackDiscardButton);
  const trackFooterStatus = element(document, "p", "metadata-editor-footer-status");
  trackFooterStatus.setAttribute("role", "status");
  const trackSaveButton = button(document, "metadata-editor-primary", trUi("保存歌曲标签"));
  trackFooter.append(trackDirtyPrompt, trackFooterStatus, trackSaveButton);
  trackSection.append(trackTabs, trackBody, trackFooter);

  root.append(albumBackdrop);

  let albumOpen = false;
  let trackOpen = false;
  let albumOpener: HTMLElement | null = null;
  let editorMode: EditorMode = "album";
  let album: MusicAlbum | null = null;
  let albumDocument: AlbumInfoDocument | null = null;
  let albumRevision = "";
  let albumOriginalDescription = "";
  let albumDescriptionSourceCandidateId: string | undefined;
  let albumCoverDraft: EditorCover = { mode: "inherit" };
  let albumCoverInitial: EditorCover = { mode: "inherit" };
  let albumCoverObjectUrl = "";
  let albumCoverCandidateUrl: string | undefined;
  let albumSourceCandidateText = "";
  let selectedCandidate: AlbumInfoCandidate | null = null;
  let automaticCandidateId: string | undefined;
  let albumSources: AlbumInfoSources = { sources: [], defaultSourceId: "" };
  let sourcePreferenceDraft = "auto";
  let selectionModeDraft: "auto" | "manual" = "auto";
  let resetToGlobalDraft = false;
  let descriptionUserEdited = false;
  let albumTab: AlbumTab = "online";
  let albumLoadEpoch = 0;
  let searchEpoch = 0;
  let candidateEpoch = 0;
  let albumLoadController: AbortController | undefined;
  let sourcesController: AbortController | undefined;
  let searchController: AbortController | undefined;
  let candidateController: AbortController | undefined;
  let trackDocument: TrackInfoDocument | null = null;
  let trackRevision = "";
  let trackId = "";
  let trackOriginalFields: Record<string, string[]> = {};
  let trackFields: Record<string, string[]> = {};
  let trackChangedKeys = new Set<string>();
  let trackCoverDraft: EditorCover = { mode: "inherit" };
  let trackCoverInitial: EditorCover = { mode: "inherit" };
  let trackCoverObjectUrl = "";
  let trackAlbum: MusicAlbum | null = null;
  let trackTab: TrackTab = "basic";
  let trackLoadEpoch = 0;
  let trackController: AbortController | undefined;
  let sourcesMountCleanup: (() => void) | undefined;
  let refreshMountedSources: (() => void) | undefined;
  let albumSaving = false;
  let trackSaving = false;

  const selectControls = enhanceSettingsSelectControls(albumDialog);

  function setAlbumStatus(message: string, error = false): void {
    albumStatus.textContent = message;
    albumStatus.classList.toggle("is-error", error);
  }

  function setAlbumFooterStatus(message: string, error = false): void {
    albumFooterStatus.textContent = message;
    albumFooterStatus.classList.toggle("is-error", error);
  }

  function onAlbumDraftChanged(): void {
    albumDirtyPrompt.hidden = true;
    setAlbumFooterStatus("");
    albumSaveButton.disabled = !albumDocument || !albumDirty();
  }

  function setTrackStatus(message: string, error = false): void {
    trackStatus.textContent = message;
    trackStatus.classList.toggle("is-error", error);
  }

  function setTrackFooterStatus(message: string, error = false): void {
    trackFooterStatus.textContent = message;
    trackFooterStatus.classList.toggle("is-error", error);
  }

  function albumDirty(): boolean {
    return !!albumDocument && (
      descriptionInput.value !== albumOriginalDescription ||
      !equalCover(albumCoverDraft, albumCoverInitial) ||
      sourcePreferenceDraft !== (albumDocument.sourcePreference || "auto") ||
      selectionModeDraft !== (albumDocument.manualInformation ? "manual" : "auto") ||
      resetToGlobalDraft
    );
  }

  function trackDirty(): boolean {
    return !!trackDocument && (
      !equalFields(trackFields, trackOriginalFields) ||
      !equalCover(trackCoverDraft, trackCoverInitial)
    );
  }

  function revokeAlbumCoverObjectUrl(): void {
    if (albumCoverObjectUrl) URL.revokeObjectURL(albumCoverObjectUrl);
    albumCoverObjectUrl = "";
  }

  function revokeTrackCoverObjectUrl(): void {
    if (trackCoverObjectUrl) URL.revokeObjectURL(trackCoverObjectUrl);
    trackCoverObjectUrl = "";
  }

  function setCoverPreview(image: HTMLImageElement, placeholder: HTMLElement, url: string | undefined, fallback: string): void {
    if (url) {
      image.src = url;
      image.hidden = false;
      placeholder.hidden = true;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      placeholder.textContent = fallback;
      placeholder.hidden = false;
    }
  }

  function albumCoverPreviewUrl(): string | undefined {
    if (albumCoverDraft.mode === "upload" && albumCoverObjectUrl) return albumCoverObjectUrl;
    if (albumCoverDraft.mode === "candidate") return albumCoverCandidateUrl;
    if (albumCoverDraft.mode === "keep") return album?.coverUrl;
    if (albumCoverDraft.mode === "inherit" && !albumDocument?.customCover) return album?.coverUrl;
    return undefined;
  }

  function updateAlbumCoverPreview(): void {
    setCoverPreview(albumCoverImage, albumCoverPlaceholder, albumCoverPreviewUrl(),
      albumCoverDraft.mode === "inherit" ? trUi("保存后继承默认封面") : trUi("暂无封面"));
    albumCoverInherit.setAttribute("aria-pressed", String(albumCoverDraft.mode === "inherit"));
  }

  function updateTrackCoverPreview(): void {
    let url: string | undefined;
    if (trackCoverDraft.mode === "upload" && trackCoverObjectUrl) url = trackCoverObjectUrl;
    else if (trackCoverDraft.mode === "keep") url = trackDocument?.artwork.url;
    else if (trackCoverDraft.mode === "inherit" && trackDocument?.artwork.mode === "inherit")
      url = callbacks.getAlbum(trackDocument.albumId)?.coverUrl ?? trackDocument.artwork.url;
    setCoverPreview(trackCoverImage, trackCoverPlaceholder, url,
      trackCoverDraft.mode === "inherit" ? trUi("继承专辑封面") : trUi("暂无封面"));
    trackCoverInherit.setAttribute("aria-pressed", String(trackCoverDraft.mode === "inherit"));
  }

  function setAlbumTab(next: AlbumTab): void {
    albumTab = next;
    const online = next === "online";
    onlineTabButton.setAttribute("aria-selected", String(online));
    onlineTabButton.tabIndex = online ? 0 : -1;
    manualTabButton.setAttribute("aria-selected", String(!online));
    manualTabButton.tabIndex = online ? -1 : 0;
    onlinePanel.hidden = !online;
    manualPanel.hidden = online;
  }

  function setEditorMode(next: EditorMode, focus = false): void {
    editorMode = next;
    const tracks = next === "tracks";
    albumSection.hidden = tracks;
    trackSection.hidden = !tracks;
    for (const [tab, active] of [[albumSectionButton, !tracks], [trackSectionButton, tracks]] as const) {
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus({ preventScroll: true });
    }
    albumDirtyPrompt.hidden = true;
    trackDirtyPrompt.hidden = true;
    if (tracks) updateTrackCoverPreview();
  }

  function setTrackTab(next: TrackTab, focus = false): void {
    trackTab = next;
    for (const [tab, tabButton] of trackTabButtons) {
      const active = tab === next;
      tabButton.setAttribute("aria-selected", String(active));
      tabButton.tabIndex = active ? 0 : -1;
      trackPanels.get(tab)!.hidden = !active;
      if (active && focus) tabButton.focus({ preventScroll: true });
    }
  }

  function renderAlbumSourceChoices(): void {
    searchSource.replaceChildren();
    const all = element(document, "option", "", trUi("继承全局来源顺序"));
    all.value = "auto";
    searchSource.append(all);
    const orderedIds = albumSources.sourceOrder ?? albumSources.sources.map((source) => source.id);
    const sources = [...albumSources.sources].sort((left, right) => {
      const leftIndex = orderedIds.indexOf(left.id);
      const rightIndex = orderedIds.indexOf(right.id);
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    });
    for (const source of sources) {
      const option = element(document, "option", "", source.enabled ? source.name : `${source.name} · ${trUi("当前停用")}`);
      option.value = source.id;
      option.disabled = !source.enabled;
      searchSource.append(option);
    }
    const knownPreference = [...searchSource.options].some((option) => option.value === sourcePreferenceDraft);
    if (!knownPreference && sourcePreferenceDraft !== "auto") {
      const pending = element(document, "option", "", `${trUi("已指定来源（当前不可用）")} · ${sourcePreferenceDraft}`);
      pending.value = sourcePreferenceDraft;
      pending.disabled = true;
      searchSource.append(pending);
    }
    searchSource.value = sourcePreferenceDraft;
    updateSourcePreferenceStatus();
    selectControls.sync();
  }

  function updateSourcePreferenceStatus(): void {
    const source = albumSources.sources.find((item) => item.id === sourcePreferenceDraft);
    const unavailable = sourcePreferenceDraft !== "auto" && (!source || !source.enabled);
    const state = sourcePreferenceDraft === "auto"
      ? trUi("自动继承全局来源顺序")
      : unavailable
        ? ui`本专辑指定：${source?.name ?? sourcePreferenceDraft} · ${trUi("当前不可用，已保存资料仍保留")}`
        : ui`本专辑指定：${source?.name ?? sourcePreferenceDraft}`;
    const manualState = selectionModeDraft === "manual" ? ` · ${trUi("手工资料优先")}` : "";
    sourcePreferenceStatus.textContent = `${state}${manualState}${resetToGlobalDraft ? ` · ${trUi("恢复将在保存后生效")}` : sourcePreferenceDraft !== (albumDocument?.sourcePreference || "auto") ? ` · ${trUi("未保存")}` : ""}`;
    restoreGlobalSource.disabled = sourcePreferenceDraft === "auto"
      && !albumDocument?.manualInformation
      && selectionModeDraft === "auto"
      && !descriptionUserEdited
      && !resetToGlobalDraft;
  }

  function renderCandidateStatuses(result?: AlbumInfoSearch): void {
    sourceStatusList.replaceChildren();
    if (!result?.sources?.length) return;
    for (const source of result.sources) {
      const row = element(document, "div", `metadata-editor-source-status is-${source.status}`);
      row.append(element(document, "strong", "", source.name));
      row.append(element(document, "span", "", source.message || (source.count !== undefined ? `${source.count} ${trUi("条结果")}` : source.status === "ok" ? trUi("已完成") : source.status === "empty" ? trUi("无结果") : trUi("查询失败"))));
      sourceStatusList.append(row);
    }
  }

  function renderCandidates(candidates: AlbumInfoCandidate[]): void {
    candidateList.replaceChildren();
    if (!candidates.length) {
      candidateList.append(element(document, "p", "metadata-editor-empty", trUi("没有匹配的资料。")));
      return;
    }
    for (const candidate of candidates) {
      const item = button(document, "metadata-editor-candidate", "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(selectedCandidate?.id === candidate.id));
      item.dataset.candidateId = candidate.id;
      const title = element(document, "strong", "metadata-editor-candidate-title", candidate.title || trUi("未命名专辑"));
      const details = element(document, "span", "metadata-editor-candidate-meta", [candidate.artist, candidate.year ? String(candidate.year) : "", candidate.sourceName].filter(Boolean).join(" · "));
      item.append(title, details);
      if (candidate.id === automaticCandidateId) {
        item.append(element(document, "span", "metadata-editor-candidate-badge", trUi("自动采用")));
        item.dataset.automatic = "true";
      }
      item.addEventListener("click", () => { void loadCandidate(candidate.id); });
      candidateList.append(item);
    }
  }

  function renderCandidateDetail(candidate: AlbumInfoCandidate | null, automatic = false): void {
    candidateDetail.replaceChildren();
    if (!candidate) {
      candidateDetail.append(element(document, "p", "metadata-editor-empty", trUi("选择一条候选资料查看介绍与封面。")));
      return;
    }
    const card = element(document, "div", "metadata-editor-candidate-preview");
    const cover = element(document, "img", "metadata-editor-candidate-cover");
    cover.alt = candidate.title ? trUi("候选专辑封面") : trUi("候选封面");
    if (candidate.coverUrl) cover.src = candidate.coverUrl;
    else cover.hidden = true;
    const details = element(document, "div", "metadata-editor-candidate-copy");
    details.append(element(document, "small", "metadata-editor-kicker", candidate.sourceName));
    details.append(element(document, "h3", "", candidate.title));
    details.append(element(document, "p", "metadata-editor-candidate-meta", [candidate.artist, candidate.year ? String(candidate.year) : ""].filter(Boolean).join(" · ")));
    details.append(element(document, "p", "metadata-editor-candidate-description", candidate.description || trUi("此候选没有提供专辑介绍。")));
    if (automatic) details.append(element(document, "p", "metadata-editor-help", trUi("这是当前来源策略自动采用的候选；你可以在此预览后手动固定候选。")));
    if (candidate.license) details.append(element(document, "small", "metadata-editor-help", ui`许可：${candidate.license}`));
    const fill = button(document, "metadata-editor-primary", trUi("手动使用此候选"));
    fill.addEventListener("click", () => fillAlbumDraftFromCandidate(candidate));
    details.append(fill);
    card.append(cover, details);
    candidateDetail.append(card);
  }

  function fillAlbumDraftFromCandidate(candidate: AlbumInfoCandidate): void {
    if (candidate.description !== undefined) descriptionInput.value = candidate.description;
    albumDescriptionSourceCandidateId = candidate.description !== undefined ? candidate.id : undefined;
    albumSourceCandidateText = candidate.description ?? "";
    descriptionUserEdited = false;
    selectionModeDraft = "manual";
    sourcePreferenceDraft = candidate.sourceId || sourcePreferenceDraft;
    resetToGlobalDraft = false;
    if (candidate.coverUrl) {
      revokeAlbumCoverObjectUrl();
      albumCoverDraft = { mode: "candidate", candidateId: candidate.id };
      albumCoverCandidateUrl = candidate.coverUrl;
      selectedCandidate = candidate;
      updateAlbumCoverPreview();
    }
    searchSource.value = sourcePreferenceDraft;
    updateSourcePreferenceStatus();
    selectControls.sync();
    renderCandidateDetail(candidate, false);
    setAlbumTab("manual");
    onAlbumDraftChanged();
    setAlbumFooterStatus(trUi("候选资料已填入草稿，请检查后保存。"));
    descriptionInput.focus({ preventScroll: true });
  }

  function selectCandidateButton(candidateId: string): void {
    candidateList.querySelectorAll<HTMLButtonElement>(".metadata-editor-candidate").forEach((item) => {
      item.setAttribute("aria-selected", String(item.dataset.candidateId === candidateId));
    });
  }

  async function loadCandidate(id: string, automatic = false): Promise<void> {
    if (disposed || !albumOpen) return;
    const epoch = ++candidateEpoch;
    candidateController?.abort();
    candidateController = new AbortController();
    selectedCandidate = null;
    selectCandidateButton(id);
    renderCandidateDetail(null);
    candidateDetail.replaceChildren(element(document, "p", "metadata-editor-empty", trUi("正在读取候选资料…")));
    try {
      const candidate = await callbacks.request<AlbumInfoCandidate>("/api/album-info/candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: id }),
        signal: candidateController.signal,
      });
      if (disposed || !albumOpen || epoch !== candidateEpoch) return;
      selectedCandidate = candidate;
      renderCandidateDetail(candidate, automatic);
      selectCandidateButton(candidate.id);
      if (automatic) prefillAutomaticCandidate(candidate);
    } catch (error) {
      if (candidateController.signal.aborted || epoch !== candidateEpoch) return;
      candidateDetail.replaceChildren(element(document, "p", "metadata-editor-error", (error as Error).message || trUi("无法读取候选资料。")));
    }
  }

  function prefillAutomaticCandidate(candidate: AlbumInfoCandidate): void {
    const hasDescription = typeof candidate.description === "string" && candidate.description.trim().length > 0;
    const canPrefill = resetToGlobalDraft
      || (selectionModeDraft === "auto" && !albumDocument?.manualInformation && !descriptionUserEdited);
    if (!hasDescription || !canPrefill) return;
    descriptionInput.value = candidate.description!;
    albumDescriptionSourceCandidateId = candidate.id;
    albumSourceCandidateText = candidate.description!;
    selectionModeDraft = "auto";
    updateSourcePreferenceStatus();
    onAlbumDraftChanged();
    setAlbumFooterStatus(trUi("自动候选已填入介绍草稿；封面保持不变。"));
  }

  async function loadAlbumSources(epoch: number): Promise<void> {
    sourcesController?.abort();
    sourcesController = new AbortController();
    try {
      const result = await callbacks.request<AlbumInfoSources>("/api/album-info/sources", { signal: sourcesController.signal });
      if (disposed || !albumOpen || epoch !== albumLoadEpoch) return;
      albumSources = result;
      renderAlbumSourceChoices();
    } catch (error) {
      if (sourcesController.signal.aborted || epoch !== albumLoadEpoch) return;
      setAlbumStatus((error as Error).message || trUi("无法读取资料来源。"), true);
    }
  }

  async function loadAlbumDocument(targetAlbum: MusicAlbum, epoch: number): Promise<void> {
    albumLoadController?.abort();
    albumLoadController = new AbortController();
    albumDocument = null;
    albumRevision = "";
    sourcePreferenceDraft = "auto";
    selectionModeDraft = "auto";
    resetToGlobalDraft = false;
    descriptionUserEdited = false;
    automaticCandidateId = undefined;
    selectedCandidate = null;
    descriptionInput.value = "";
    albumOriginalDescription = "";
    albumDescriptionSourceCandidateId = undefined;
    albumCoverDraft = { mode: "inherit" };
    albumCoverInitial = { mode: "inherit" };
    albumCoverCandidateUrl = undefined;
    albumSourceCandidateText = "";
    revokeAlbumCoverObjectUrl();
    updateAlbumCoverPreview();
    renderAlbumSourceChoices();
    albumSaveButton.disabled = true;
    setAlbumStatus(trUi("正在读取专辑资料…"));
    setAlbumFooterStatus("");
    try {
      const query = new URLSearchParams({ albumId: targetAlbum.id });
      const result = await callbacks.request<AlbumInfoDocument>(`/api/album-info/document?${query.toString()}`, { signal: albumLoadController.signal });
      if (disposed || !albumOpen || epoch !== albumLoadEpoch || album?.id !== targetAlbum.id) return;
      albumDocument = result;
      album = callbacks.getAlbum(result.album.id) ?? result.album ?? targetAlbum;
      albumRevision = result.revision;
      sourcePreferenceDraft = result.sourcePreference || "auto";
      selectionModeDraft = result.manualInformation ? "manual" : "auto";
      resetToGlobalDraft = false;
      descriptionUserEdited = false;
      albumSubtitle.textContent = [album.title, album.artist, album.year ? String(album.year) : ""].filter(Boolean).join(" · ");
      albumOriginalDescription = result.album.description ?? "";
      descriptionInput.value = albumOriginalDescription;
      albumCoverInitial = result.customCover ? { mode: "keep" } : { mode: "inherit" };
      albumCoverDraft = cloneCover(albumCoverInitial);
      updateAlbumCoverPreview();
      renderAlbumSourceChoices();
      albumSaveButton.disabled = !albumDirty();
      setAlbumStatus("");
      setAlbumFooterStatus("");
      renderTrackList();
    } catch (error) {
      if (albumLoadController.signal.aborted || epoch !== albumLoadEpoch) return;
      setAlbumStatus((error as Error).message || trUi("无法读取专辑资料。"), true);
    }
  }

  function beginAlbumOpen(targetAlbum: MusicAlbum, opener: HTMLElement | null): void {
    albumLoadEpoch += 1;
    searchEpoch += 1;
    candidateEpoch += 1;
    albumLoadController?.abort();
    searchController?.abort();
    candidateController?.abort();
    album = targetAlbum;
    albumOpener = opener;
    albumOpen = true;
    setHidden(albumBackdrop, false);
    setEditorMode("album");
    setAlbumTab("online");
    albumSubtitle.textContent = [targetAlbum.title, targetAlbum.artist].filter(Boolean).join(" · ");
    searchTitle.value = targetAlbum.title;
    searchArtist.value = targetAlbum.artist;
    sourcePreferenceDraft = "auto";
    selectionModeDraft = "auto";
    resetToGlobalDraft = false;
    descriptionUserEdited = false;
    automaticCandidateId = undefined;
    selectedCandidate = null;
    searchSource.value = "auto";
    searchButton.disabled = false;
    candidateList.replaceChildren(element(document, "p", "metadata-editor-empty", trUi("使用专辑名称与艺人搜索公开资料。")));
    sourceStatusList.replaceChildren();
    renderCandidateDetail(null);
    const epoch = albumLoadEpoch;
    void loadAlbumDocument(targetAlbum, epoch);
    void loadAlbumSources(epoch);
    requestAnimationFrame(() => albumSectionButton.focus({ preventScroll: true }));
  }

  async function searchAlbumInfo(): Promise<void> {
    if (!album || !albumOpen) return;
    if (!albumDocument) {
      setAlbumStatus(trUi("正在读取专辑资料，请稍后搜索。"));
      return;
    }
    const title = searchTitle.value.trim();
    const artist = searchArtist.value.trim();
    if (!title) {
      setAlbumStatus(trUi("请填写专辑名称。"), true);
      return;
    }
    if (sourcePreferenceDraft !== "auto") {
      const provider = albumSources.sources.find((source) => source.id === sourcePreferenceDraft);
      if (!provider || !provider.enabled) {
        setAlbumStatus(trUi("本专辑指定来源当前不可用；如需继续查询，请主动恢复全局来源顺序。"), true);
        return;
      }
    }
    const epoch = ++searchEpoch;
    searchController?.abort();
    searchController = new AbortController();
    const sourceId = sourcePreferenceDraft || "auto";
    searchButton.disabled = true;
    setAlbumStatus(trUi("正在搜索公开资料…"));
    sourceStatusList.replaceChildren();
    candidateList.replaceChildren(element(document, "p", "metadata-editor-empty", trUi("正在搜索…")));
    automaticCandidateId = undefined;
    candidateEpoch += 1;
    candidateController?.abort();
    selectedCandidate = null;
    renderCandidateDetail(null);
    try {
      const result = await callbacks.request<AlbumInfoSearch>("/api/album-info/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ albumId: album.id, title, artist, ...(sourceId ? { sourceId } : {}) }),
        signal: searchController.signal,
      });
      if (disposed || !albumOpen || epoch !== searchEpoch || !album || result === undefined) return;
      automaticCandidateId = result.automaticCandidateId ?? result.automaticCandidate?.id;
      renderCandidateStatuses(result);
      renderCandidates(Array.isArray(result.candidates) ? result.candidates : []);
      if (result.automaticCandidate) {
        selectedCandidate = result.automaticCandidate;
        renderCandidateDetail(result.automaticCandidate, true);
        selectCandidateButton(result.automaticCandidate.id);
        prefillAutomaticCandidate(result.automaticCandidate);
      } else if (automaticCandidateId) {
        void loadCandidate(automaticCandidateId, true);
      } else {
        renderCandidateDetail(null);
      }
      setAlbumStatus(result.candidates.length ? ui`找到 ${result.candidates.length} 条候选资料。` : trUi("没有找到匹配资料。"));
    } catch (error) {
      if (searchController.signal.aborted || epoch !== searchEpoch) return;
      candidateList.replaceChildren(element(document, "p", "metadata-editor-error", (error as Error).message || trUi("资料搜索失败。")));
      setAlbumStatus((error as Error).message || trUi("资料搜索失败。"), true);
    } finally {
      if (epoch === searchEpoch) searchButton.disabled = false;
    }
  }

  async function chooseAlbumCover(file?: File): Promise<void> {
    if (!file) return;
    const expectedEpoch = albumLoadEpoch;
    const expectedAlbumId = album?.id;
    if (file.size > MAX_COVER_BYTES) {
      callbacks.notify(trUi("封面文件超过 8 MiB，未加入草稿。"));
      return;
    }
    const mime = fileMime(file);
    if (!mime) {
      callbacks.notify(trUi("封面仅支持 JPEG、PNG 或 WebP。"));
      return;
    }
    try {
      const dataUrl = await fileAsDataUrl(file, mime);
      if (disposed || !albumOpen || expectedEpoch !== albumLoadEpoch || expectedAlbumId !== album?.id) return;
      revokeAlbumCoverObjectUrl();
      albumCoverObjectUrl = URL.createObjectURL(file);
      albumCoverCandidateUrl = undefined;
      albumCoverDraft = { mode: "upload", dataUrl };
      updateAlbumCoverPreview();
      onAlbumDraftChanged();
      setAlbumFooterStatus(trUi("封面已加入草稿，保存专辑资料后生效。"));
    } catch (error) {
      callbacks.notify((error as Error).message || trUi("无法读取封面文件。"));
    } finally {
      albumCoverFile.value = "";
    }
  }

  async function saveAlbum(): Promise<void> {
    if (albumSaving || !album || !albumDocument || !albumRevision || !albumDirty()) return;
    albumSaving = true;
    searchEpoch += 1;
    candidateEpoch += 1;
    searchController?.abort();
    candidateController?.abort();
    searchButton.disabled = true;
    albumDialog.inert = true;
    setAlbumFooterStatus(trUi("正在保存专辑资料…"));
    const sourceCandidateId = albumDescriptionSourceCandidateId;
    try {
      const library = await callbacks.request<MusicLibrary>("/api/album-info/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          albumId: album.id,
          revision: albumRevision,
          description: descriptionInput.value,
          ...(sourceCandidateId ? { sourceCandidateId } : {}),
          sourcePreference: sourcePreferenceDraft,
          selectionMode: selectionModeDraft,
          ...(resetToGlobalDraft ? { resetToGlobal: true } : {}),
          cover: cloneCover(albumCoverDraft),
        }),
      });
      if (disposed || !albumOpen) return;
      await callbacks.onLibrary(library);
      if (disposed || !albumOpen) return;
      const updatedAlbum = callbacks.getAlbum(album.id) ?? library.albums.find((item) => item.id === album?.id);
      if (updatedAlbum) album = updatedAlbum;
      albumDescriptionSourceCandidateId = undefined;
      albumSourceCandidateText = "";
      callbacks.notify(trUi("专辑资料已保存。"));
      await loadAlbumDocument(album, albumLoadEpoch);
      setAlbumFooterStatus(trUi("专辑资料已保存。"));
    } catch (error) {
      setAlbumFooterStatus((error as Error).message || trUi("保存专辑资料失败。"), true);
    } finally {
      if (!disposed) {
        albumSaving = false;
        searchButton.disabled = false;
        albumDialog.inert = false;
        albumSaveButton.disabled = !albumDocument || !albumDirty();
      }
    }
  }

  function renderTrackList(): void {
    trackList.replaceChildren();
    const currentAlbum = trackAlbum ?? (trackDocument ? callbacks.getAlbum(trackDocument.albumId) : undefined) ?? album;
    const tracks = currentAlbum?.tracks ?? [];
    trackListCount.textContent = String(tracks.length).padStart(2, "0");
    if (!tracks.length) {
      trackList.append(element(document, "p", "metadata-editor-empty", trUi("这个专辑没有歌曲。")));
      return;
    }
    tracks.forEach((track, index) => {
      const row = button(document, "metadata-editor-track-row", "");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(track.id === trackId));
      row.setAttribute("aria-label", `${track.title} · ${track.artist}`);
      row.dataset.editorTrackId = track.id;
      const number = element(document, "span", "metadata-editor-track-number", String(track.trackNumber ?? index + 1).padStart(2, "0"));
      const text = element(document, "span", "metadata-editor-track-copy");
      text.append(element(document, "strong", "", track.title || trUi("未命名歌曲")));
      text.append(element(document, "small", "", track.artist || trUi("未知艺人")));
      row.append(number, text);
      row.addEventListener("click", () => requestTrackChange(track.id));
      trackList.append(row);
    });
  }

  function updateTrackRowSelection(): void {
    trackList.querySelectorAll<HTMLButtonElement>(".metadata-editor-track-row").forEach((row) => {
      row.setAttribute("aria-selected", String(row.dataset.editorTrackId === trackId));
    });
  }

  function renderArtistField(host: HTMLElement, key: string, labelText: string): void {
    const wrapper = element(document, "section", "metadata-editor-field metadata-editor-artist-field");
    wrapper.dataset.editorArtistKey = key;
    const heading = element(document, "div", "metadata-editor-field-heading");
    heading.append(element(document, "span", "metadata-editor-field-label", trUi(labelText)));
    heading.append(element(document, "code", "metadata-editor-tag-name", key));
    wrapper.append(heading);
    const values = trackFields[key] ?? [""];
    values.forEach((value, index) => {
      const row = element(document, "div", "metadata-editor-artist-row");
      const input = element(document, "input", "metadata-editor-input");
      input.type = "text";
      input.value = value;
      input.setAttribute("aria-label", ui`${trUi(labelText)} ${index + 1}`);
      if (index === 0) row.append(element(document, "small", "metadata-editor-primary-artist", trUi(key === "ARTIST" ? "主唱 / 主要艺人" : "主要专辑艺人")));
      input.addEventListener("input", () => {
        const next = [...(trackFields[key] ?? [""])];
        next[index] = input.value;
        trackFields[key] = next;
        trackChangedKeys.add(key);
        onTrackDraftChanged();
      });
      const controls = element(document, "div", "metadata-editor-row-controls");
      const remove = button(document, "metadata-editor-icon-button", "−");
      remove.setAttribute("aria-label", ui`${trUi("删除艺人")} ${index + 1}`);
      remove.disabled = values.length <= 1;
      remove.addEventListener("click", () => {
        const next = [...(trackFields[key] ?? [""])];
        next.splice(index, 1);
        trackFields[key] = next.length ? next : [""];
        trackChangedKeys.add(key);
        renderTrackFields();
        onTrackDraftChanged();
      });
      const up = button(document, "metadata-editor-icon-button", "↑");
      up.setAttribute("aria-label", ui`${trUi("上移艺人")} ${index + 1}`);
      up.disabled = index === 0;
      up.addEventListener("click", () => moveArtist(key, index, -1));
      const down = button(document, "metadata-editor-icon-button", "↓");
      down.setAttribute("aria-label", ui`${trUi("下移艺人")} ${index + 1}`);
      down.disabled = index === values.length - 1;
      down.addEventListener("click", () => moveArtist(key, index, 1));
      controls.append(remove, up, down);
      row.append(input, controls);
      wrapper.append(row);
    });
    const add = button(document, "metadata-editor-add-value", `+ ${trUi("添加艺人")}`);
    add.addEventListener("click", () => {
      trackFields[key] = [...(trackFields[key] ?? []), ""];
      trackChangedKeys.add(key);
      renderTrackFields();
      const rows = host.querySelectorAll<HTMLInputElement>(`.metadata-editor-artist-field[data-editor-artist-key="${CSS.escape(key)}"] input`);
      rows?.item(rows.length - 1)?.focus();
      onTrackDraftChanged();
    });
    wrapper.append(add);
    host.append(wrapper);
  }

  function moveArtist(key: string, index: number, direction: -1 | 1): void {
    const values = [...(trackFields[key] ?? [])];
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= values.length) return;
    [values[index], values[nextIndex]] = [values[nextIndex], values[index]];
    trackFields[key] = values;
    trackChangedKeys.add(key);
    renderTrackFields();
    onTrackDraftChanged();
    const target = basicFieldsHost.querySelector<HTMLInputElement>(`.metadata-editor-artist-field input[aria-label="${CSS.escape(`${trUi(key === "ARTIST" ? "歌手" : "专辑歌手")} ${nextIndex + 1}`)}"]`);
    target?.focus({ preventScroll: true });
  }

  function renderValueField(
    host: HTMLElement,
    key: string,
    labelText: string,
    allowMultiple = false,
    preserveExtraValues = false,
  ): void {
    const wrapper = element(document, "section", `metadata-editor-field${preserveExtraValues ? " metadata-editor-single-field" : ""}`);
    const heading = element(document, "div", "metadata-editor-field-heading");
    heading.append(element(document, "span", "metadata-editor-field-label", trUi(labelText)));
    heading.append(element(document, "code", "metadata-editor-tag-name", key));
    wrapper.append(heading);
    const values = trackFields[key] ?? [""];
    const visibleValues = allowMultiple || !preserveExtraValues ? values : values.slice(0, 1);
    const renderRow = (value: string, index: number, canRemove: boolean, target: HTMLElement = wrapper) => {
      const row = element(document, "div", "metadata-editor-value-row");
      const input = key === "COMMENT"
        ? element(document, "textarea", "metadata-editor-input")
        : element(document, "input", "metadata-editor-input");
      if (input instanceof HTMLTextAreaElement) {
        input.rows = 2;
      } else {
        input.type = "text";
        if (key === "DATE") {
          input.inputMode = "numeric";
          input.placeholder = trUi("例如 2024、2024-06 或 2024-06-15");
        } else if (["TRACKNUMBER", "TRACKTOTAL", "DISCNUMBER", "DISCTOTAL"].includes(key)) {
          input.inputMode = "numeric";
          input.placeholder = trUi("例如 1");
        }
      }
      input.value = value;
      input.dataset.editorField = key;
      input.dataset.editorValueIndex = String(index);
      input.setAttribute("aria-label", ui`${trUi(labelText)} ${index + 1}`);
      input.addEventListener("input", () => {
        const next = [...(trackFields[key] ?? [""])];
        next[index] = input.value;
        trackFields[key] = next;
        trackChangedKeys.add(key);
        onTrackDraftChanged();
      });
      row.append(input);
      if (canRemove) {
        const remove = button(document, "metadata-editor-icon-button", "−");
        remove.setAttribute("aria-label", ui`${trUi("删除此值")} ${index + 1}`);
        remove.disabled = allowMultiple && values.length <= 1;
        remove.addEventListener("click", () => {
          const next = [...(trackFields[key] ?? [""])];
          next.splice(index, 1);
          trackFields[key] = next.length ? next : [""];
          trackChangedKeys.add(key);
          renderTrackFields();
          onTrackDraftChanged();
        });
        row.append(remove);
      }
      target.append(row);
    };
    visibleValues.forEach((value, index) => renderRow(value, index, allowMultiple));
    if (preserveExtraValues && values.length > 1) {
      const extras = element(document, "details", "metadata-editor-existing-values");
      const summary = element(document, "summary", "", trUi("已有额外值"));
      summary.append(element(document, "span", "metadata-editor-existing-value-count", String(values.length - 1)));
      extras.append(summary);
      values.slice(1).forEach((value, offset) => renderRow(value, offset + 1, true, extras));
      wrapper.append(extras);
    }
    if (allowMultiple) {
      const add = button(document, "metadata-editor-add-value", `+ ${trUi("添加值")}`);
      add.addEventListener("click", () => {
        trackFields[key] = [...(trackFields[key] ?? []), ""];
        trackChangedKeys.add(key);
        renderTrackFields();
        onTrackDraftChanged();
        const inputs = host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[data-editor-field="${CSS.escape(key)}"]`);
        inputs.item(inputs.length - 1)?.focus();
      });
      wrapper.dataset.editorField = key;
      wrapper.append(add);
    }
    host.append(wrapper);
  }

  function renderTrackFields(): void {
    basicFieldsHost.replaceChildren();
    for (const [key, label] of BASIC_TRACK_FIELDS) {
      if (key === "ARTIST" || key === "ALBUMARTIST") renderArtistField(basicFieldsHost, key, label);
      else renderValueField(
        basicFieldsHost,
        key,
        label,
        MULTI_VALUE_FIELD_KEYS.has(key),
        SINGLE_VALUE_FIELD_KEYS.has(key),
      );
    }
    renderMoreFields();
    applyWritableState();
  }

  function renderMoreFields(): void {
    moreFieldsHost.replaceChildren();
    const keys = Object.keys(trackFields).filter((key) => !BASIC_FIELD_KEYS.has(key.toUpperCase())).sort((a, b) => a.localeCompare(b));
    if (!keys.length) moreFieldsHost.append(element(document, "p", "metadata-editor-empty", trUi("没有其他标签。")));
    for (const key of keys) {
      const wrapper = element(document, "section", "metadata-editor-field metadata-editor-extra-field");
      const heading = element(document, "div", "metadata-editor-field-heading");
      heading.append(element(document, "code", "metadata-editor-tag-name", key));
      const removeKey = button(document, "metadata-editor-danger metadata-editor-remove-tag", trUi("删除标签"));
      removeKey.addEventListener("click", () => {
        delete trackFields[key];
        trackChangedKeys.add(key);
        renderMoreFields();
        onTrackDraftChanged();
      });
      heading.append(removeKey);
      wrapper.append(heading);
      const values = trackFields[key] ?? [""];
      values.forEach((value, index) => {
        const row = element(document, "div", "metadata-editor-value-row");
        const input = element(document, "textarea", "metadata-editor-input");
        input.rows = 2;
        input.value = value;
        input.dataset.editorExtraKey = key;
        input.setAttribute("aria-label", ui`${key} ${index + 1}`);
        input.addEventListener("input", () => {
          const next = [...(trackFields[key] ?? [""])];
          next[index] = input.value;
          trackFields[key] = next;
          trackChangedKeys.add(key);
          onTrackDraftChanged();
        });
        const removeValue = button(document, "metadata-editor-icon-button", "−");
        removeValue.setAttribute("aria-label", ui`${trUi("删除此值")} ${index + 1}`);
        removeValue.disabled = values.length <= 1;
        removeValue.addEventListener("click", () => {
          const next = [...(trackFields[key] ?? [""])];
          next.splice(index, 1);
          trackFields[key] = next.length ? next : [""];
          trackChangedKeys.add(key);
          renderMoreFields();
          onTrackDraftChanged();
        });
        row.append(input, removeValue);
        wrapper.append(row);
      });
      const addValue = button(document, "metadata-editor-add-value", `+ ${trUi("添加值")}`);
      addValue.addEventListener("click", () => {
        trackFields[key] = [...(trackFields[key] ?? []), ""];
        trackChangedKeys.add(key);
        renderMoreFields();
        onTrackDraftChanged();
        const inputs = moreFieldsHost.querySelectorAll<HTMLTextAreaElement>(`.metadata-editor-extra-field textarea[data-editor-extra-key="${CSS.escape(key)}"]`);
        inputs?.item(inputs.length - 1)?.focus();
      });
      wrapper.append(addValue);
      moreFieldsHost.append(wrapper);
    }
  }

  function applyWritableState(): void {
    const writable = !!trackDocument?.writable;
    trackPanels.get("basic")!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input, textarea, button").forEach((control) => { control.disabled = !writable; });
    trackPanels.get("more")!.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input, textarea, button").forEach((control) => { control.disabled = !writable; });
    trackCoverFile.disabled = !writable;
    trackCoverInherit.disabled = !writable;
    trackSaveButton.disabled = !writable || !trackDirty();
  }

  function updateCurrentTrackLabel(): void {
    const title = trackFields.TITLE?.[0] ?? trackDocument?.fields.TITLE?.[0] ?? "";
    const artist = (trackFields.ARTIST ?? trackDocument?.fields.ARTIST ?? []).filter(Boolean).join(" / ");
    const position = trackDocument?.file.relativePath ?? "";
    trackCurrentLabel.textContent = [title || trackDocument?.file.name || trUi("未命名歌曲"), artist, position].filter(Boolean).join(" · ");
  }

  function onTrackDraftChanged(): void {
    trackDirtyPrompt.hidden = true;
    setTrackFooterStatus("");
    updateCurrentTrackLabel();
    trackSaveButton.disabled = !trackDocument?.writable || !trackDirty();
    if (trackId) {
      const row = trackList.querySelector<HTMLButtonElement>(`[data-editor-track-id="${CSS.escape(trackId)}"]`);
      const strong = row?.querySelector("strong");
      const small = row?.querySelector("small");
      if (strong) strong.textContent = trackFields.TITLE?.[0] || trUi("未命名歌曲");
      if (small) small.textContent = (trackFields.ARTIST ?? []).filter(Boolean).join(" / ") || trUi("未知艺人");
    }
  }

  function renderFileProperties(file: TrackInfoDocument["file"]): void {
    const rows: Array<[string, string]> = [
      ["文件名", file.name || "—"],
      ["相对路径", file.relativePath || "—"],
      ["格式", file.format || "—"],
      ["文件大小", formatBytes(file.size)],
      ["修改时间", formatModified(file.modifiedAt)],
      ["时长", formatDuration(file.duration)],
      ["采样率", file.sampleRate ? `${(file.sampleRate / 1000).toFixed(file.sampleRate % 1000 ? 1 : 0)} kHz` : "—"],
      ["位深", file.bitsPerSample ? `${file.bitsPerSample} bit` : "—"],
      ["码率", file.bitrate ? `${Math.round(file.bitrate / 1000)} kbps` : "—"],
      ["声道", file.numberOfChannels ? String(file.numberOfChannels) : "—"],
    ];
    fileProperties.replaceChildren();
    for (const [label, value] of rows) {
      const dt = element(document, "dt", "", trUi(label));
      const dd = element(document, "dd", "", value);
      fileProperties.append(dt, dd);
    }
  }

  async function loadTrackDocument(nextTrackId: string): Promise<void> {
    const epoch = ++trackLoadEpoch;
    trackController?.abort();
    trackController = new AbortController();
    trackId = nextTrackId;
    trackDocument = null;
    trackRevision = "";
    trackOriginalFields = {};
    trackFields = {};
    trackChangedKeys = new Set();
    revokeTrackCoverObjectUrl();
    trackSaveButton.disabled = true;
    readOnlyNotice.hidden = true;
    setTrackStatus(trUi("正在读取歌曲标签…"));
    setTrackFooterStatus("");
    renderTrackList();
    try {
      const query = new URLSearchParams({ trackId: nextTrackId });
      const result = await callbacks.request<TrackInfoDocument>(`/api/track-info/document?${query.toString()}`, { signal: trackController.signal });
      if (disposed || !trackOpen || epoch !== trackLoadEpoch || trackId !== nextTrackId) return;
      trackDocument = result;
      trackRevision = result.revision;
      trackAlbum = callbacks.getAlbum(result.albumId) ?? trackAlbum ?? album;
      trackFields = cloneFields(result.fields);
      trackOriginalFields = cloneFields(result.fields);
      trackChangedKeys = new Set();
      trackCoverInitial = result.artwork.mode === "inherit" ? { mode: "inherit" } : { mode: "keep" };
      trackCoverDraft = cloneCover(trackCoverInitial);
      renderTrackFields();
      renderFileProperties(result.file);
      updateTrackCoverPreview();
      trackCoverInfo.textContent = result.artwork.canEmbed
        ? trUi("此文件支持写入嵌入封面。")
        : trUi("嵌入封面能力有限，保存时由本机服务选择可用方式。");
      const canEdit = result.writable;
      readOnlyNotice.hidden = canEdit;
      readOnlyNotice.textContent = result.readOnlyReason || trUi("此文件当前为只读，标签无法保存。");
      trackCurrentLabel.textContent = "";
      updateCurrentTrackLabel();
      setTrackStatus("");
      setTrackTab(trackTab);
      updateTrackRowSelection();
      trackSaveButton.disabled = !canEdit || !trackDirty();
    } catch (error) {
      if (trackController.signal.aborted || epoch !== trackLoadEpoch) return;
      setTrackStatus((error as Error).message || trUi("无法读取歌曲标签。"), true);
    }
  }

  function requestTrackChange(nextTrackId: string): void {
    if (!nextTrackId || nextTrackId === trackId) return;
    requestTrackTransition(() => { void loadTrackDocument(nextTrackId); });
  }

  function requestTrackTransition(continuation: () => void): void {
    if (trackSaving) return;
    if (!trackDirty()) {
      continuation();
      return;
    }
    trackDirtyPrompt.hidden = false;
    trackDiscardButton.onclick = () => {
      trackDirtyPrompt.hidden = true;
      continuation();
    };
    trackContinueButton.onclick = () => {
      trackDirtyPrompt.hidden = true;
    };
    trackContinueButton.focus({ preventScroll: true });
  }

  function hideTrackDialog(): void {
    if (!trackOpen) return;
    trackOpen = false;
    trackLoadEpoch += 1;
    trackController?.abort();
    trackController = undefined;
    revokeTrackCoverObjectUrl();
    trackDirtyPrompt.hidden = true;
    trackDocument = null;
    trackFields = {};
    trackOriginalFields = {};
    if (albumOpen) setEditorMode("album");
  }

  function requestCloseTrack(continuation?: () => void): void {
    if (trackSaving) return;
    if (!trackOpen) {
      continuation?.();
      return;
    }
    if (trackDirty()) setEditorMode("tracks");
    requestTrackTransition(() => {
      hideTrackDialog();
      continuation?.();
    });
  }

  function requestCloseAlbum(continuation?: () => void): void {
    if (albumSaving) return;
    if (!albumOpen) {
      continuation?.();
      return;
    }
    if (albumDirty()) {
      setEditorMode("album");
      albumDirtyPrompt.hidden = false;
      albumDiscardButton.onclick = () => {
        albumDirtyPrompt.hidden = true;
        hideAlbumDialog();
        continuation?.();
      };
      albumContinueButton.onclick = () => { albumDirtyPrompt.hidden = true; };
      albumContinueButton.focus({ preventScroll: true });
      return;
    }
    hideAlbumDialog();
    continuation?.();
  }

  function requestCloseAll(continuation?: () => void): void {
    if (albumSaving || trackSaving) return;
    if (trackOpen) requestCloseTrack(() => requestCloseAlbum(continuation));
    else requestCloseAlbum(continuation);
  }

  function hideAlbumDialog(): void {
    if (!albumOpen) return;
    albumOpen = false;
    albumLoadEpoch += 1;
    searchEpoch += 1;
    candidateEpoch += 1;
    albumLoadController?.abort();
    sourcesController?.abort();
    searchController?.abort();
    candidateController?.abort();
    albumLoadController = undefined;
    searchController = undefined;
    candidateController = undefined;
    revokeAlbumCoverObjectUrl();
    setHidden(albumBackdrop, true);
    albumDirtyPrompt.hidden = true;
    const opener = albumOpener;
    albumOpener = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }

  async function saveTrack(): Promise<void> {
    if (trackSaving || !trackDocument || !trackId || !trackRevision || !trackDocument.writable || !trackDirty()) return;
    trackSaving = true;
    const savedTrackId = trackId;
    const saveEpoch = trackLoadEpoch;
    const payload: TrackInfoSave = {
      trackId: savedTrackId,
      revision: trackRevision,
      fields: cleanChangedFields(trackFields, trackChangedKeys),
      cover: equalCover(trackCoverDraft, trackCoverInitial) ? { mode: "keep" } : cloneCover(trackCoverDraft),
    };
    albumDialog.inert = true;
    setTrackFooterStatus(trUi("正在保存歌曲标签…"));
    try {
      const library = await callbacks.request<MusicLibrary>("/api/track-info/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (disposed || !trackOpen || saveEpoch !== trackLoadEpoch || trackId !== savedTrackId) return;
      await callbacks.onLibrary(library);
      if (disposed || !trackOpen || trackId !== savedTrackId) return;
      const movedAlbum = library.albums.find((candidate) => candidate.tracks.some((track) => track.id === savedTrackId));
      if (movedAlbum) trackAlbum = callbacks.getAlbum(movedAlbum.id) ?? movedAlbum;
      setTrackFooterStatus(trUi("歌曲标签已保存。"));
      callbacks.notify(trUi("歌曲标签已保存。"));
      await loadTrackDocument(savedTrackId);
      setTrackFooterStatus(trUi("歌曲标签已保存。"));
    } catch (error) {
      if (!disposed && trackOpen && trackId === savedTrackId) setTrackFooterStatus((error as Error).message || trUi("保存歌曲标签失败。"), true);
    } finally {
      if (!disposed && trackOpen && trackId === savedTrackId) {
        trackSaving = false;
        albumDialog.inert = false;
        trackSaveButton.disabled = !trackDocument?.writable || !trackDirty();
      }
    }
  }

  function openTrackSection(): void {
    if (trackOpen) {
      setEditorMode("tracks");
      return;
    }
    trackOpen = true;
    setEditorMode("tracks");
    trackTab = "basic";
    setTrackTab("basic");
    trackFields = {};
    trackDocument = null;
    trackId = "";
    trackAlbum = album;
    readOnlyNotice.hidden = true;
    renderTrackList();
    const firstId = trackAlbum?.tracks[0]?.id;
    if (firstId) void loadTrackDocument(firstId);
    else setTrackStatus(trUi("这个专辑没有歌曲。"));
  }

  function topDialog(): { panel: HTMLElement } | null {
    if (albumOpen) return { panel: albumDialog };
    return null;
  }

  function focusables(panel: HTMLElement): HTMLElement[] {
    return [...panel.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    )].filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true" && node.getClientRects().length > 0);
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    const top = topDialog();
    if (!top) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      requestCloseAll();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(top.panel);
    if (!items.length) {
      event.preventDefault();
      top.panel.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !top.panel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (document.activeElement === last || !top.panel.contains(document.activeElement))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function stopDialogBubbling(dialog: HTMLElement): void {
    dialog.addEventListener("click", (event) => event.stopPropagation());
    dialog.addEventListener("keydown", (event) => event.stopPropagation());
  }
  stopDialogBubbling(albumDialog);

  function onAlbumTabKeyDown(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next: AlbumTab = event.key === "Home" ? "online" : event.key === "End" ? "manual" : albumTab === "online" ? "manual" : "online";
    setAlbumTab(next);
    (next === "online" ? onlineTabButton : manualTabButton).focus({ preventScroll: true });
  }

  function onTrackTabKeyDown(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const tabs = trackTabLabels.map(([tab]) => tab);
    const index = tabs.indexOf(trackTab);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setTrackTab(tabs[nextIndex], true);
  }

  onlineTabButton.addEventListener("click", () => setAlbumTab("online"));
  manualTabButton.addEventListener("click", () => setAlbumTab("manual"));
  searchSource.addEventListener("change", () => {
    sourcePreferenceDraft = searchSource.value || "auto";
    resetToGlobalDraft = false;
    if (!albumDocument?.manualInformation) selectionModeDraft = "auto";
    updateSourcePreferenceStatus();
    onAlbumDraftChanged();
  });
  restoreGlobalSource.addEventListener("click", () => {
    sourcePreferenceDraft = "auto";
    selectionModeDraft = "auto";
    resetToGlobalDraft = true;
    searchSource.value = "auto";
    selectControls.sync();
    updateSourcePreferenceStatus();
    onAlbumDraftChanged();
    void searchAlbumInfo();
  });
  albumSectionButton.addEventListener("click", () => setEditorMode("album"));
  trackSectionButton.addEventListener("click", openTrackSection);
  sectionTabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: EditorMode = event.key === "Home" ? "album" : event.key === "End" ? "tracks" : editorMode === "album" ? "tracks" : "album";
    if (next === "tracks") openTrackSection();
    else setEditorMode("album");
    (next === "tracks" ? trackSectionButton : albumSectionButton).focus({ preventScroll: true });
  });
  albumTabs.addEventListener("keydown", onAlbumTabKeyDown);
  trackTabs.addEventListener("keydown", onTrackTabKeyDown);
  searchButton.addEventListener("click", () => { void searchAlbumInfo(); });
  searchTitle.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void searchAlbumInfo(); } });
  searchArtist.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void searchAlbumInfo(); } });
  candidateList.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const candidates = [...candidateList.querySelectorAll<HTMLButtonElement>(".metadata-editor-candidate")];
    if (!candidates.length) return;
    event.preventDefault();
    const current = candidates.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    candidates[(current + delta + candidates.length) % candidates.length].focus();
  });
  descriptionInput.addEventListener("input", () => {
    if (albumDescriptionSourceCandidateId && descriptionInput.value !== albumSourceCandidateText) {
      albumDescriptionSourceCandidateId = undefined;
    }
    descriptionUserEdited = true;
    selectionModeDraft = "manual";
    resetToGlobalDraft = false;
    updateSourcePreferenceStatus();
    onAlbumDraftChanged();
  });
  albumCoverInherit.addEventListener("click", () => {
    revokeAlbumCoverObjectUrl();
    albumCoverCandidateUrl = undefined;
    albumCoverDraft = { mode: "inherit" };
    updateAlbumCoverPreview();
    onAlbumDraftChanged();
  });
  albumCoverFile.addEventListener("change", () => { void chooseAlbumCover(albumCoverFile.files?.[0]); });
  albumSaveButton.addEventListener("click", () => { void saveAlbum(); });
  albumCloseButton.addEventListener("click", () => requestCloseAll());
  albumBackdrop.addEventListener("click", (event) => { if (event.target === albumBackdrop) requestCloseAll(); });
  albumContinueButton.addEventListener("click", () => { albumDirtyPrompt.hidden = true; });
  trackContinueButton.addEventListener("click", () => { trackDirtyPrompt.hidden = true; });
  trackDiscardButton.addEventListener("click", () => { trackDirtyPrompt.hidden = true; });
  trackCoverInherit.addEventListener("click", () => {
    revokeTrackCoverObjectUrl();
    trackCoverDraft = { mode: "inherit" };
    updateTrackCoverPreview();
    onTrackDraftChanged();
  });
  trackCoverFile.addEventListener("change", async () => {
    const file = trackCoverFile.files?.[0];
    if (!file) return;
    if (file.size > MAX_COVER_BYTES) {
      callbacks.notify(trUi("封面文件超过 8 MiB，未加入草稿。"));
      trackCoverFile.value = "";
      return;
    }
    const mime = fileMime(file);
    if (!mime) {
      callbacks.notify(trUi("封面仅支持 JPEG、PNG 或 WebP。"));
      trackCoverFile.value = "";
      return;
    }
    const expectedTrackId = trackId;
    const expectedEpoch = trackLoadEpoch;
    try {
      const dataUrl = await fileAsDataUrl(file, mime);
      if (!trackOpen || disposed || !expectedTrackId || trackId !== expectedTrackId || trackLoadEpoch !== expectedEpoch) return;
      revokeTrackCoverObjectUrl();
      trackCoverObjectUrl = URL.createObjectURL(file);
      trackCoverDraft = { mode: "upload", dataUrl };
      updateTrackCoverPreview();
      onTrackDraftChanged();
    } catch (error) {
      callbacks.notify((error as Error).message || trUi("无法读取封面文件。"));
    } finally {
      trackCoverFile.value = "";
    }
  });
  trackSaveButton.addEventListener("click", () => { void saveTrack(); });
  addTagButton.addEventListener("click", () => {
    const key = addTagKey.value.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]*$/u.test(key)) {
      setTrackStatus(trUi("标签名称只能包含英文字母、数字、下划线和连字符。"), true);
      addTagKey.focus();
      return;
    }
    if (Object.keys(trackFields).some((existing) => existing.toUpperCase() === key)) {
      setTrackStatus(trUi("这个标签已存在。"), true);
      addTagKey.focus();
      return;
    }
    trackFields[key] = [""];
    trackChangedKeys.add(key);
    addTagKey.value = "";
    setTrackStatus("");
    renderMoreFields();
    onTrackDraftChanged();
    moreFieldsHost.querySelector<HTMLTextAreaElement>(`.metadata-editor-extra-field textarea[data-editor-extra-key="${CSS.escape(key)}"]`)?.focus();
  });
  addTagKey.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addTagButton.click(); } });
  trackTabButtons.forEach((tabButton, tab) => tabButton.addEventListener("click", () => setTrackTab(tab)));
  window?.addEventListener("keydown", onWindowKeyDown, true);

  function open(targetAlbum: MusicAlbum): void {
    if (disposed) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const doOpen = () => beginAlbumOpen(targetAlbum, opener);
    if (albumOpen || trackOpen) requestCloseAll(doOpen);
    else doOpen();
  }

  function close(): void {
    requestCloseAll();
  }

  function refreshSources(): void {
    if (albumOpen) void loadAlbumSources(albumLoadEpoch);
    refreshMountedSources?.();
  }

  function destroy(): void {
    if (disposed) return;
    disposed = true;
    albumLoadEpoch += 1;
    searchEpoch += 1;
    candidateEpoch += 1;
    trackLoadEpoch += 1;
    albumLoadController?.abort();
    sourcesController?.abort();
    searchController?.abort();
    candidateController?.abort();
    trackController?.abort();
    revokeAlbumCoverObjectUrl();
    revokeTrackCoverObjectUrl();
    sourcesMountCleanup?.();
    selectControls.destroy();
    window?.removeEventListener("keydown", onWindowKeyDown, true);
    albumBackdrop.remove();
    if (albumOpener?.isConnected) albumOpener.focus({ preventScroll: true });
    albumOpen = false;
    trackOpen = false;
  }

  function mountSources(host: HTMLElement, options?: { connectionHost?: HTMLElement }): () => void {
    sourcesMountCleanup?.();
    const section = element(document, "section", "metadata-editor-sources-settings");
    section.append(element(document, "h2", "metadata-editor-section-title", trUi("资料来源管理")));
    const status = element(document, "p", "metadata-editor-status");
    status.setAttribute("role", "status");
    const applyStatus = element(document, "p", "metadata-editor-status metadata-editor-source-apply-status");
    applyStatus.setAttribute("role", "status");
    applyStatus.setAttribute("aria-live", "polite");
    applyStatus.setAttribute("data-album-source-apply-status", "true");
    const content = element(document, "div", "metadata-editor-sources-content");
    const actions = element(document, "div", "metadata-editor-source-actions");
    const addSource = button(document, "metadata-editor-secondary", trUi("新增自定义来源"));
    const applyKeepManual = button(document, "metadata-editor-primary", trUi("应用全局并保留手工项"));
    const expandOverwrite = button(document, "metadata-editor-danger", trUi("完全覆盖并应用全局…"));
    const confirmId = `${prefix}-source-overwrite-confirm`;
    expandOverwrite.setAttribute("aria-expanded", "false");
    expandOverwrite.setAttribute("aria-controls", confirmId);
    addSource.disabled = true;
    applyKeepManual.disabled = true;
    expandOverwrite.disabled = true;
    actions.append(applyKeepManual, expandOverwrite);
    const overwriteConfirm = element(document, "div", "metadata-editor-source-overwrite-confirm");
    overwriteConfirm.id = confirmId;
    overwriteConfirm.hidden = true;
    overwriteConfirm.setAttribute("role", "group");
    overwriteConfirm.append(element(document, "p", "metadata-editor-help", trUi("完全覆盖会忽视专辑的来源指定和手写介绍，并按当前全局来源顺序重新查询。不会改动封面、曲目标签或本地分类；查询失败时保留已有介绍。")));
    const confirmOverwrite = button(document, "metadata-editor-danger", trUi("确认完全覆盖并应用"));
    const cancelOverwrite = button(document, "metadata-editor-secondary", trUi("取消"));
    overwriteConfirm.append(confirmOverwrite, cancelOverwrite);
    const applyNote = element(document, "p", "metadata-editor-help metadata-editor-source-apply-note", trUi("应用会先保存当前来源配置，再启动统一的全局查询任务；只有点击下方按钮时才会开始。"));
    const heading = section.querySelector("h2")!;
    const header = element(document, "div", "metadata-editor-sources-header");
    header.append(heading, addSource);
    section.append(header, status, content, applyNote, actions, overwriteConfirm, applyStatus);
    host.append(section);
    let sourceState: AlbumInfoSources = { sources: [], defaultSourceId: "auto", sourceOrder: [] };
    let localDisposed = false;
    let sourceEpoch = 0;
    let sourceDraftRevision = 0;
    let sourceDraftDirty = false;
    let sourceStateLoaded = false;
    let sourceOperationBusy = false;
    let selectedSourceId = "";
    let draggingSourceId = "";
    const controller = new AbortController();
    const mappingDraftValues = new Map<string, string>();
    const connectionHost = options?.connectionHost;
    const originalConnectionParent = connectionHost?.parentNode ?? null;
    const originalConnectionNext = connectionHost?.nextSibling ?? null;
    const connectionMarker = originalConnectionParent
      ? document.createComment("album-info-connection-host")
      : null;
    if (connectionHost && originalConnectionParent && connectionMarker) {
      originalConnectionParent.insertBefore(connectionMarker, connectionHost);
    }
    const setStatus = (message: string, error = false) => {
      status.textContent = message;
      status.classList.toggle("is-error", error);
    };
    const setApplyStatus = (message: string, error = false) => {
      applyStatus.textContent = message;
      applyStatus.classList.toggle("is-error", error);
    };
    const markSourceDraftDirty = () => {
      sourceDraftRevision += 1;
      sourceDraftDirty = true;
      section.dataset.dirty = "true";
      setStatus(trUi("来源设置有未保存的更改。"));
      setOperationBusy(sourceOperationBusy);
    };
    const visibleSourceIds = () => {
      const present = new Set(sourceState.sources.map((source) => source.id));
      const inOrder = (sourceState.sourceOrder ?? []).filter((id) => present.has(id));
      for (const source of sourceState.sources) if (!inOrder.includes(source.id)) inOrder.push(source.id);
      return inOrder;
    };
    const mergeVisibleOrder = (previous: string[], nextVisible: string[], visibleIds: Set<string>) => {
      let nextIndex = 0;
      const merged = previous.map((id) => visibleIds.has(id) ? (nextVisible[nextIndex++] ?? id) : id);
      while (nextIndex < nextVisible.length) merged.push(nextVisible[nextIndex++]);
      return merged;
    };
    const currentSettings = () => {
      const sources = sourceState.sources.map((source) => ({
        ...source,
        mapping: source.mapping ? { ...source.mapping } : undefined,
      }));
      const sourceOrder = mergeVisibleOrder(
        sourceState.sourceOrder ?? [],
        visibleSourceIds(),
        new Set(sourceState.sources.map((source) => source.id)),
      );
      return { sources, sourceOrder };
    };
    const setOperationBusy = (busy: boolean) => {
      sourceOperationBusy = busy;
      addSource.disabled = busy || !sourceStateLoaded;
      applyKeepManual.disabled = busy || !sourceStateLoaded;
      expandOverwrite.disabled = busy || !sourceStateLoaded;
      confirmOverwrite.disabled = busy || !sourceStateLoaded;
      cancelOverwrite.disabled = busy;
    };
    const moveSource = (sourceId: string, targetId: string) => {
      const order = visibleSourceIds();
      const from = order.indexOf(sourceId);
      const to = order.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return;
      order.splice(from, 1);
      order.splice(to, 0, sourceId);
      sourceState.sourceOrder = mergeVisibleOrder(
        sourceState.sourceOrder ?? [],
        order,
        new Set(sourceState.sources.map((source) => source.id)),
      );
      markSourceDraftDirty();
      render();
    };
    const render = () => {
      content.replaceChildren();
      const note = element(document, "p", "metadata-editor-help metadata-editor-source-order-note", trUi("默认顺序为 MusicBrainz → Wikipedia → 网易云 → QQ。按左侧当前顺序逐项查询并回退；MusicBrainz 仅在配置有效联系邮箱时参与。同一来源有多个候选时会自动采用一个，也可在专辑编辑里逐张改选。"));
      const board = element(document, "div", "metadata-editor-source-board");
      const queuePanel = element(document, "section", "metadata-editor-source-queue-panel");
      queuePanel.append(element(document, "h3", "metadata-editor-source-pane-title", trUi("全局优先顺序")));
      const queue = element(document, "div", "metadata-editor-source-queue");
      queue.setAttribute("role", "list");
      const detailsPanel = element(document, "section", "metadata-editor-source-details-panel");
      detailsPanel.append(element(document, "h3", "metadata-editor-source-pane-title", trUi("来源配置")));
      const connectionSlot = element(document, "div", "metadata-editor-source-connection-slot");
      if (connectionHost) connectionSlot.append(connectionHost);
      const detailContent = element(document, "div", "metadata-editor-source-detail-content");
      detailsPanel.append(detailContent, connectionSlot);
      const sourceIds = visibleSourceIds();
      if (!selectedSourceId || !sourceIds.includes(selectedSourceId)) selectedSourceId = sourceIds[0] ?? "";
      if (!sourceIds.length) queue.append(element(document, "p", "metadata-editor-empty", trUi("没有可用资料来源。")));
      sourceIds.forEach((sourceId, index) => {
        const source = sourceState.sources.find((item) => item.id === sourceId);
        if (!source) return;
        const row = element(document, "div", "metadata-editor-source-row");
        row.dataset.sourceId = source.id;
        row.setAttribute("role", "listitem");
        row.classList.toggle("is-selected", source.id === selectedSourceId);
        const orderNumber = element(document, "span", "metadata-editor-source-order-number", String(index + 1).padStart(2, "0"));
        const dragHandle = button(document, "metadata-editor-source-drag", "⠿");
        dragHandle.draggable = true;
        dragHandle.setAttribute("aria-label", ui`${trUi("拖动调整顺序")} ${source.name}`);
        dragHandle.title = trUi("拖动调整顺序");
        const selectSource = button(document, "metadata-editor-source-select", source.name || trUi("未命名来源"));
        selectSource.setAttribute("aria-pressed", String(source.id === selectedSourceId));
        selectSource.setAttribute("aria-label", ui`${trUi("编辑来源")} ${source.name}`);
        const enableLabel = element(document, "label", "metadata-editor-source-enabled");
        const enabled = element(document, "input");
        enabled.type = "checkbox";
        enabled.checked = source.enabled;
        enabled.setAttribute("aria-label", ui`${trUi("启用来源")} ${source.name}`);
        const enabledText = element(document, "span", "", source.enabled ? trUi("已启用") : trUi("已停用"));
        enableLabel.append(enabled, enabledText);
        enabled.addEventListener("change", () => {
          source.enabled = enabled.checked;
          enabledText.textContent = enabled.checked ? trUi("已启用") : trUi("已停用");
          markSourceDraftDirty();
        });
        const moveControls = element(document, "div", "metadata-editor-source-move-controls");
        const up = button(document, "metadata-editor-icon-button", "↑");
        up.setAttribute("aria-label", ui`${trUi("上移来源")} ${source.name}`);
        up.disabled = index === 0;
        up.addEventListener("click", () => moveSource(source.id, sourceIds[index - 1] ?? source.id));
        const down = button(document, "metadata-editor-icon-button", "↓");
        down.setAttribute("aria-label", ui`${trUi("下移来源")} ${source.name}`);
        down.disabled = index === sourceIds.length - 1;
        down.addEventListener("click", () => moveSource(source.id, sourceIds[index + 1] ?? source.id));
        moveControls.append(up, down);
        row.append(orderNumber, dragHandle, selectSource, enableLabel, moveControls);
        selectSource.addEventListener("click", () => {
          selectedSourceId = source.id;
          render();
        });
        dragHandle.addEventListener("dragstart", (event) => {
          draggingSourceId = source.id;
          event.dataTransfer?.setData("text/plain", source.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          row.classList.add("is-dragging");
        });
        dragHandle.addEventListener("dragend", () => {
          draggingSourceId = "";
          row.classList.remove("is-dragging");
        });
        row.addEventListener("dragover", (event) => {
          if (!draggingSourceId) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });
        row.addEventListener("drop", (event) => {
          event.preventDefault();
          const sourceId = draggingSourceId || event.dataTransfer?.getData("text/plain") || "";
          if (sourceId) moveSource(sourceId, source.id);
          draggingSourceId = "";
        });
        queue.append(row);
      });
      queuePanel.append(queue);

      const selectedSource = sourceState.sources.find((source) => source.id === selectedSourceId);
      if (selectedSource) {
        const card = element(document, "article", "metadata-editor-source-card");
        const sourceHeading = element(document, "div", "metadata-editor-source-card-heading");
        sourceHeading.append(element(document, "strong", "", selectedSource.name || trUi("未命名来源")));
        card.append(sourceHeading);
        const updateQueueName = (name: string) => {
          sourceHeading.querySelector("strong")!.textContent = name || trUi("未命名来源");
          for (const row of Array.from(queue.querySelectorAll<HTMLElement>(".metadata-editor-source-row"))) {
            if (row.dataset.sourceId !== selectedSource.id) continue;
            const selectButton = row.querySelector<HTMLButtonElement>(".metadata-editor-source-select");
            if (selectButton) {
              selectButton.textContent = name || trUi("未命名来源");
              selectButton.setAttribute("aria-label", ui`${trUi("编辑来源")} ${name}`);
            }
            row.querySelector<HTMLButtonElement>(".metadata-editor-source-drag")?.setAttribute("aria-label", ui`${trUi("拖动调整顺序")} ${name}`);
            row.querySelector<HTMLInputElement>(".metadata-editor-source-enabled input")?.setAttribute("aria-label", ui`${trUi("启用来源")} ${name}`);
            row.querySelector<HTMLButtonElement>(".metadata-editor-source-move-controls button:first-child")?.setAttribute("aria-label", ui`${trUi("上移来源")} ${name}`);
            row.querySelector<HTMLButtonElement>(".metadata-editor-source-move-controls button:last-child")?.setAttribute("aria-label", ui`${trUi("下移来源")} ${name}`);
          }
        };
        if (selectedSource.builtin) {
          card.append(element(document, "p", "metadata-editor-help", trUi("内置来源的名称、ID 和地址由应用管理。")));
          if (selectedSource.searchUrl) card.append(element(document, "code", "metadata-editor-source-url", `${trUi("搜索")} · ${selectedSource.searchUrl}`));
          if (selectedSource.detailUrl) card.append(element(document, "code", "metadata-editor-source-url", `${trUi("详情")} · ${selectedSource.detailUrl}`));
        } else {
          const nameLabel = element(document, "label", "metadata-editor-label", trUi("来源名称"));
          const nameInput = element(document, "input", "metadata-editor-input");
          nameInput.value = selectedSource.name;
          nameInput.addEventListener("input", () => {
            selectedSource.name = nameInput.value;
            updateQueueName(nameInput.value);
            markSourceDraftDirty();
          });
          nameLabel.append(nameInput);
          const searchLabel = element(document, "label", "metadata-editor-label", trUi("搜索地址模板"));
          const searchUrlInput = element(document, "input", "metadata-editor-input");
          searchUrlInput.type = "url";
          searchUrlInput.value = selectedSource.searchUrl ?? "";
          searchUrlInput.placeholder = "https://example.org/search?q={query}";
          searchUrlInput.addEventListener("input", () => {
            selectedSource.searchUrl = searchUrlInput.value;
            markSourceDraftDirty();
          });
          searchLabel.append(searchUrlInput);
          const detailLabel = element(document, "label", "metadata-editor-label", trUi("详情地址模板"));
          const detailUrlInput = element(document, "input", "metadata-editor-input");
          detailUrlInput.type = "url";
          detailUrlInput.value = selectedSource.detailUrl ?? "";
          detailUrlInput.placeholder = "https://example.org/release/{id}";
          detailUrlInput.addEventListener("input", () => {
            selectedSource.detailUrl = detailUrlInput.value;
            markSourceDraftDirty();
          });
          detailLabel.append(detailUrlInput);
          const advanced = element(document, "details", "metadata-editor-source-advanced");
          advanced.append(element(document, "summary", "", trUi("高级字段映射 JSON")));
          const mappingLabel = element(document, "label", "metadata-editor-label", trUi("字段映射"));
          const mapping = element(document, "textarea", "metadata-editor-textarea metadata-editor-mapping-input");
          mapping.rows = 5;
          mapping.spellcheck = false;
          mapping.value = mappingDraftValues.get(selectedSource.id) ?? JSON.stringify(selectedSource.mapping ?? {}, null, 2);
          mapping.setAttribute("aria-label", trUi("来源字段映射 JSON"));
          mapping.addEventListener("input", () => {
            mappingDraftValues.set(selectedSource.id, mapping.value);
            markSourceDraftDirty();
          });
          mappingLabel.append(mapping);
          advanced.append(mappingLabel, element(document, "p", "metadata-editor-help", trUi("映射字段：results、id、title、artist、year、description、cover、url。")));
          const remove = button(document, "metadata-editor-danger", trUi("删除来源"));
          remove.addEventListener("click", () => {
            sourceState.sources = sourceState.sources.filter((item) => item.id !== selectedSource.id);
            sourceState.sourceOrder = (sourceState.sourceOrder ?? []).filter((id) => id !== selectedSource.id);
            mappingDraftValues.delete(selectedSource.id);
            selectedSourceId = visibleSourceIds()[0] ?? "";
            markSourceDraftDirty();
            render();
          });
          card.append(nameLabel, searchLabel, detailLabel, advanced, remove);
        }
        detailContent.append(card);
      }
      board.append(queuePanel, detailsPanel);
      content.append(
        note,
        board,
        element(document, "p", "metadata-editor-help metadata-editor-source-template-hint", trUi("模板变量：{query}、{title}、{artist}、{id}。仅支持 HTTP(S) 地址模板，不运行脚本。")),
      );
    };
    const validateSourceDraft = (): boolean => {
      if (!sourceState.sources.some((source) => source.enabled)) {
        setStatus(trUi("请至少启用一个来源。"), true);
        return false;
      }
      for (const source of sourceState.sources) {
        if (source.builtin) continue;
        if (!source.name.trim()) {
          setStatus(trUi("请填写自定义来源名称。"), true);
          return false;
        }
        if (!validHttpTemplate(source.searchUrl ?? "") || !validHttpTemplate(source.detailUrl ?? "")) {
          setStatus(trUi("来源地址必须是有效的 HTTP(S) 地址模板。"), true);
          return false;
        }
        const mappingText = mappingDraftValues.get(source.id) ?? JSON.stringify(source.mapping ?? {});
        try {
          const parsed: unknown = JSON.parse(mappingText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
            throw new TypeError("mapping must be a string map");
          }
          source.mapping = parsed as Record<string, string>;
        } catch {
          setStatus(ui`来源 ${source.name} 的字段映射必须是键和值均为字符串的 JSON 对象。`, true);
          if (selectedSourceId === source.id) content.querySelector<HTMLTextAreaElement>(".metadata-editor-mapping-input")?.focus();
          return false;
        }
      }
      return true;
    };
    const load = async () => {
      const epoch = ++sourceEpoch;
      setStatus(trUi("正在读取资料来源…"));
      try {
        const result = await callbacks.request<AlbumInfoSources>("/api/album-info/sources", { signal: controller.signal });
        if (localDisposed || epoch !== sourceEpoch) return;
        if (sourceDraftDirty) {
          setStatus(trUi("来源设置有未应用的更改，请先应用当前设置或重新打开页面后再刷新。"), true);
          return;
        }
        sourceState = {
          sources: Array.isArray(result.sources) ? result.sources.map((source) => ({ ...source, mapping: source.mapping ? { ...source.mapping } : undefined })) : [],
          defaultSourceId: "auto",
          sourceOrder: result.sourceOrder ?? result.sources.map((source) => source.id),
        };
        if (!sourceState.sources.some((source) => source.id === selectedSourceId)) selectedSourceId = visibleSourceIds()[0] ?? "";
        sourceStateLoaded = true;
        setOperationBusy(false);
        mappingDraftValues.clear();
        render();
        setStatus("");
      } catch (error) {
        if (controller.signal.aborted || epoch !== sourceEpoch) return;
        setStatus((error as Error).message || trUi("无法读取资料来源。"), true);
      }
    };
    addSource.addEventListener("click", () => {
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const source: AlbumInfoSource = { id, name: trUi("新来源"), builtin: false, enabled: true, searchUrl: "", detailUrl: "", mapping: {} };
      sourceState.sources.push(source);
      sourceState.sourceOrder = mergeVisibleOrder(
        sourceState.sourceOrder ?? [],
        visibleSourceIds(),
        new Set(sourceState.sources.map((item) => item.id)),
      );
      selectedSourceId = id;
      markSourceDraftDirty();
      render();
      content.querySelector<HTMLInputElement>(".metadata-editor-source-detail-content input")?.focus();
    });
    const applyGlobal = async (overwriteManual: boolean) => {
      if (sourceOperationBusy || !sourceStateLoaded) return;
      if (!validateSourceDraft()) return;
      const epoch = sourceEpoch;
      const draftRevision = sourceDraftRevision;
      const snapshot = currentSettings();
      setOperationBusy(true);
      setApplyStatus(trUi("正在保存设置并启动全局查询…"));
      try {
        const library = await callbacks.request<MusicLibrary>("/api/album-info/apply-global", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: snapshot, overwriteManual }),
          signal: controller.signal,
        });
        if (localDisposed || epoch !== sourceEpoch) return;
        await callbacks.onLibrary(library);
        if (localDisposed || epoch !== sourceEpoch) return;
        if (draftRevision === sourceDraftRevision) {
          sourceState.sourceOrder = snapshot.sourceOrder;
          sourceState.defaultSourceId = "auto";
          sourceDraftDirty = false;
          delete section.dataset.dirty;
          setStatus(trUi("全局来源顺序和配置已保存。"));
        } else {
          setStatus(trUi("已应用点击时的来源设置；期间的新编辑仍未应用。"), true);
        }
        setApplyStatus(trUi("全局查询任务已启动；可在专辑资料状态中查看进度。"));
        overwriteConfirm.hidden = true;
        expandOverwrite.setAttribute("aria-expanded", "false");
        if (draftRevision === sourceDraftRevision) { render(); void load(); }
      } catch (error) {
        if (controller.signal.aborted || localDisposed || epoch !== sourceEpoch) return;
        setApplyStatus((error as Error).message || trUi("应用全局来源失败。"), true);
      } finally {
        if (!localDisposed) setOperationBusy(false);
      }
    };
    applyKeepManual.addEventListener("click", () => { void applyGlobal(false); });
    expandOverwrite.addEventListener("click", () => {
      overwriteConfirm.hidden = false;
      expandOverwrite.setAttribute("aria-expanded", "true");
      confirmOverwrite.focus({ preventScroll: true });
    });
    confirmOverwrite.addEventListener("click", () => { void applyGlobal(true); });
    cancelOverwrite.addEventListener("click", () => {
      if (sourceOperationBusy) return;
      overwriteConfirm.hidden = true;
      expandOverwrite.setAttribute("aria-expanded", "false");
    });
    const refresh = () => {
      if (sourceDraftDirty) {
        setStatus(trUi("来源设置有未应用的更改，请先应用当前设置或重新打开页面后再刷新。"), true);
        return;
      }
      void load();
    };
    const cleanup = () => {
      if (localDisposed) return;
      localDisposed = true;
      sourceEpoch += 1;
      controller.abort();
      if (connectionHost && connectionMarker?.parentNode?.isConnected) {
        connectionMarker.parentNode.insertBefore(connectionHost, connectionMarker.nextSibling);
        connectionMarker.remove();
      } else if (connectionHost && originalConnectionParent && originalConnectionParent.isConnected) {
        originalConnectionParent.insertBefore(
          connectionHost,
          originalConnectionNext?.parentNode === originalConnectionParent ? originalConnectionNext : null,
        );
        connectionMarker?.remove();
      }
      section.remove();
      if (refreshMountedSources === refresh) refreshMountedSources = undefined;
      if (sourcesMountCleanup === cleanup) sourcesMountCleanup = undefined;
    };
    sourcesMountCleanup = cleanup;
    refreshMountedSources = refresh;
    void load();
    return cleanup;
  }

  return { open, close, destroy, mountSources, refreshSources };
}
