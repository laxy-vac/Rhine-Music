import { trUi, ui, uiLanguage, saveUiLanguage } from "./i18n";
import { pcmConsistencyCode } from "./audio-info";
import "@kitlangton/rolling-number/styles.css";
import "./style.css";
import "./quality-settings.css";
import "./document-decryption.css";
import "./decryption.css";
import "./music.css";
import "./music-settings-page.css";
import "./settings-select-controls.css";
import "./music-library-page.css";
import "./music-eq-page.css";
import "./lyrics-page.css";
import "./signal-page.css";
import "./lyrics-settings.css";
import "./music-navigation-motion.css";
import "./music-navigation-ruler.css";
import "./music-transport-title.css";
import "./music-theme.css";
import "./music-theme-switch.css";
import "./music-style-page.css";
import { defaultMusicStyle, normalizeMusicStyle, normalizeDesignProfiles, applyStylePalette, stylePalette, musicStyleMarkup, syncMusicStyleAppearance, setupStylePreview, type MusicStyle, type DesignProfiles } from "./music-style";
import { handleFutureAppearanceKey } from "./future-appearance-picker";
import { getMusicCatalogShelves, getMusicRecordLocation, navigateMusicEntry } from "./music-catalog-shelves";
import { configureMusicCatalog, getMusicCatalogOptions, getMusicCatalogRecords, getMusicCatalogGroups, getMusicEntry, getMusicEntryByKey, getMusicFocusedEntry, focusMusicEntry } from "./music-catalog";
import { musicBrowseControlsMarkup, syncMusicViewControls } from "./music-view-controls";
import { setupMusicCatalogGrid } from "./music-catalog-grid";
import "./music-view-controls.css";
import "./music-catalog-grid.css";
import { setupFoobarShell } from "./foobar-shell";
import "./music-touch.css";
import "./sony-tech-indicators.css";
import "./hi-res.css";
import "./music-playback.css";
import "./audio-info.css";
import "./eq-controls.css";
import "./editable-range-controls.css";
import "./music-design-fonts.css";
import "./music-design.css";
import "./foobar-pages.css";
import "./foobar-style.css";
import "./foobar-shell.css";
import "./punk-archive.css";
import "./punk-eq.css";
import "./punk-lyrics.css";
import "./punk-signal.css";
import { syncPunkEqInstruments } from "./punk-eq-instruments";
import "./album-panel.css";
import "./window-aspect.css";
import "./future-design.css";
import "./future-lyrics.css";
import "./future-eq.css";
import "./future-signal.css";
import "./future-transitions.css";
import "./case-editor.css";
import "./terminal-lighting.css";
import { normalizeCaseProfiles, normalizeCaseSettings, type CaseProfiles } from "./case-settings";
import { setupCaseEditor } from "./case-editor";
import { normalizeCaseUserPresets, type CaseUserPreset } from "./case-user-presets";
import { setupTerminalLighting } from "./terminal-lighting";
import { setupAlbumPanel } from "./album-panel";
import { setupAlbumInfoEditor } from "./album-info-editor";
import { setupAlbumInteraction } from "./album-interaction";
import { setupAlbumQueue } from "./album-queue";
import { playbackMarkup, setupMusicPlayback } from "./music-playback";
import { setupAudioInfoPopup, audioSourceSummary, audioSignalSummary, audioSonySummary, audioProcessingText, isPlaybackBufferUnavailable, audioPrecisionMarkup, pcmConsistencyStatus } from "./audio-info";
import { enhanceSettingsSelectControls } from "./settings-select-controls";
import { renderEqControls, renderToneControls, setupEqControls } from "./eq-controls";
import { createStandardEqPresetState, standardEqPresetMarkup, setupStandardEqPresets, type StandardEqFileRequest, type StandardEqFileResult } from "./standard-eq-presets";
import { setupEditableRanges } from "./editable-range-controls";
import { setupLyricsPage } from "./lyrics-page";
import { setupSignalPage } from "./signal-page";
import { setupLyricsSettings } from "./lyrics-settings";
import { getKnownIssuesText } from "./known-issues.mjs";
import { importPowerampPreset, importRhineProcessingBackup, normalizeProcessing, processingDefault, serializeRhineProcessingBackup, type ImportedPowerampPreset, type ProcessingSettings, type RhineProcessingBackup } from "./audio-processing-model.mjs";
import { dsdBadgeMarkup, hiResBadgeMarkup, isDsdAlbum, isDsdTrack, isHiResAlbum, isHiResTrack } from "./hi-res";
import { SurfaceTransition, PageScanTransition } from "./ui-transitions";
import { syncQualityUI } from "./quality-settings";
import { displaySettingsMarkup, motionSettingsMarkup } from "./graphics-settings";
import { mountGpuSettings, type GpuReport } from "./gpu-settings";
import { ArchiveScene } from "./scene";
import { FutureEntry, futureEntryEndFor, futureEntryShot } from "./future-entry";
import { ENTRY_TEXT_MAX_LENGTH, defaultEntryWelcome, defaultEntryIdentity, normalizeEntryText } from "./entry-preferences.mjs";
import { setupEntryTextControls } from "./entry-text-controls";
import { mountQualityDetection } from "./quality-detection";
import {
  records,
  setMusicAlbums,
  orderMusicAlbums,
  type MusicSortMode,
} from "./data";
import { wrap, type ArchiveNavigation } from "./archive-loop";
import {
  normalizeQuality,
  withQualityField,
  qualityPresets,
  type QualityPreset,
  type RenderQuality,
} from "./render-quality";
import { MusicPlayer, type MusicPlayerState } from "./music-player";
import { ModelViewer } from "./model-viewer";
import { TerminalAudio } from "./audio";
import { InterfaceAudioClient } from "./interface-audio";
import type {
  MusicAlbum,
  MusicGenre,
  MusicLibrary,
  GenreRules,
  MusicTrack,
} from "./music-types";
import { demoAlbums, demoGenres } from "./demo-library";
import { escapeHtml as esc, containsCjk } from "./html";
import { setupMusicTitleLayout } from "./music-title";
import { setupMusicTextMotion } from "./music-text-motion";
import { setupTransportTitle } from "./music-transport-title";
import { setupMusicTicks } from "./music-ticks";
import { setupMusicRuler } from "./music-ruler";
import { MusicPresentation, type AlbumSelection } from "./music-presentation";
import { MusicTrackFocus } from "./music-track-focus";
import { musicApplication } from "./music-application-state";
import { legacyCatalogOptions, migrateMusicViewSettings, musicGridPageSizes, type MusicGridPageSize, type LegacyCatalogOptions, type MusicViewSettings } from "./music-view-settings";
import { getMusicGridPage, paginateMusicGridGroups } from "./music-grid-page";
import { musicInterfaceLabels } from "./music-interface-labels";
import { setupMusicThemeFollow } from "./music-theme-follow";
import { setupAlbumCasePreview } from "./album-case-preview";
import type { ArchiveRecord } from "./data";
import "./music-theme-choice.css";
import "./future-controls.css";
import "./future-panels.css";
import "./future-day-palette.css";
import "./future-appearance-picker.css";
import "./future-settings.css";
import { enhanceFutureSettings } from "./future-settings-layout";
import { viewportLayout } from "./viewport-layout";
import { applyWindowAspect } from "./window-aspect";
import { normalizeWindowAspect, type WindowAspectId as WindowAspect } from "./window-aspect-model.mjs";
import { normalizeSony, sonyOff, type SonySettings, type SonyStatus } from "./sony-audio";
import { setupTouchRuler } from "./music-touch";
import { sonyTechMarkup, updateSonyTechIndicators } from "./sony-tech-indicators";
import { normalizeOutput, outputDefault, recoverNativeSession, discardNativeSession, type OutputSettings, type NativeStatus, type NativePlaybackSession } from "./native-audio";
declare global { interface Window { rhineDesktop?: { native: boolean; frontendReady?(): void; frontendFailed?(message: string): void; audioPresetPersistenceError?: string; audioPresetStoreExists?: boolean; savePreferences(value: unknown): void; showKnownIssues?(language?: string): Promise<void>; saveAudioProcessingPresets?(value: unknown): Promise<{ ok: boolean; error?: string }>; standardEqPresets?(request: StandardEqFileRequest): Promise<StandardEqFileResult>; chooseMusicFolders(options?: { multiple?: boolean; language?: string }): Promise<string[]>; chooseLyricsCacheFolder?(language?: string): Promise<string | null>; fullscreen?(action: "get" | "toggle" | "exit"): Promise<boolean>; onFullscreenChange?(callback: (fullscreen: boolean) => void): () => void; gpuInfo?(): Promise<GpuReport>; selectGpu?(id: string): Promise<GpuReport> } } }

let windowFullscreen = Boolean(document.fullscreenElement);
let cleanupGpuSettings: (() => void) | undefined;
let fullscreenPending = false;
function syncFullscreenUI() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action="fullscreen"]')) {
    button.textContent = trUi(windowFullscreen ? "退出全屏 ↙" : "进入全屏 ↗");
    button.setAttribute("aria-pressed", String(windowFullscreen));
    button.disabled = fullscreenPending;
  }
}
async function changeFullscreen(action: "toggle" | "exit" = "toggle") {
  if (fullscreenPending) return;
  fullscreenPending = true;
  syncFullscreenUI();
  try {
    if (window.rhineDesktop?.fullscreen) windowFullscreen = await window.rhineDesktop.fullscreen(action);
    else {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (action === "toggle") await document.documentElement.requestFullscreen();
      windowFullscreen = Boolean(document.fullscreenElement);
    }
  } catch {
    notify(trUi("无法切换全屏，请重试。"));
  } finally {
    fullscreenPending = false;
    syncFullscreenUI();
  }
}
window.rhineDesktop?.onFullscreenChange?.(fullscreen => {
  windowFullscreen = fullscreen;
  syncFullscreenUI();
});
if (window.rhineDesktop?.fullscreen) {
  void window.rhineDesktop.fullscreen("get").then(fullscreen => {
    windowFullscreen = fullscreen;
    syncFullscreenUI();
  }).catch(() => {});
}
document.addEventListener("fullscreenchange", () => {
  if (!window.rhineDesktop?.fullscreen) windowFullscreen = Boolean(document.fullscreenElement);
  syncFullscreenUI();
});

type Theme = "day" | "night";
type Panel = "search" | "online" | null;
type SettingsCategory = "appearance" | "interface" | "audio" | "lyrics" | "library" | "sources" | "about";
const settingsCategories: { id: SettingsCategory; title: string; intro: string; sections: string[] }[] = [
  { id: "interface", title: trUi("界面与交互"), intro: trUi("管理界面语言、动态效果、入场与操作反馈。"), sections: ["#interface-settings", "#motion-settings", "#entry-settings", "#interface-sound-settings"] },
  // Retain the old route key for saved in-window settings links.
  { id: "appearance", title: trUi("显示与性能"), intro: trUi("设置窗口显示、渲染画质、优先显卡与性能检测。"), sections: ["#graphics-display-settings"] },
  { id: "lyrics", title: trUi("歌词"), intro: trUi("管理默认来源、共享服务器与本地缓存。"), sections: ["#lyrics-global-settings"] },
  { id: "audio", title: trUi("音频"), intro: trUi("调整音乐处理、歌曲音量与输出设备。"), sections: ["#current-audio-settings", "#decoder-settings", "#dsd-route-settings", "#sony-settings", "#replaygain-settings", "#sound-settings", "#transition-settings", "#resampling-settings", "#precision-settings", "#buffer-settings", "#output-settings"] },
  { id: "library", title: trUi("音乐库"), intro: trUi("选择音乐文件夹、导入与扫描，管理专辑分类和介绍资料。"), sections: ["#library-management-settings", "#library-sort-settings", "#introduction-settings"] },
  { id: "sources", title: trUi("音乐来源"), intro: trUi("连接 FTP 远程音乐库。"), sections: ["#ftp-settings"] },
  { id: "about", title: trUi("关于"), intro: trUi("查看项目来源和使用许可。"), sections: ["#about-settings"] },
];
type AudioSettingsSection = "source" | "decoder" | "dsp" | "replaygain" | "volume" | "transition" | "resampling" | "precision" | "buffer" | "output";
const audioSettingsSections: { id: AudioSettingsSection; title: string; sections: string[] }[] = [
  { id: "source", title: trUi("当前音源"), sections: ["#current-audio-settings"] },
  { id: "decoder", title: trUi("解码与转换"), sections: ["#decoder-settings", "#dsd-route-settings"] },
  { id: "dsp", title: trUi("信号处理 DSP"), sections: ["#sony-settings"] },
  { id: "replaygain", title: trUi("播放增益"), sections: ["#replaygain-settings"] },
  { id: "volume", title: trUi("音量与过渡"), sections: ["#sound-settings"] },
  { id: "transition", title: trUi("切歌与淡变"), sections: ["#transition-settings"] },
  { id: "resampling", title: trUi("输出采样率"), sections: ["#resampling-settings"] },
  { id: "precision", title: trUi("输出位深与精度"), sections: ["#precision-settings"] },
  { id: "buffer", title: trUi("缓冲"), sections: ["#buffer-settings"] },
  { id: "output", title: trUi("输出与设备"), sections: ["#output-settings"] },
];
function settingsNavigationMarkup() {
  return settingsCategories.map((category, index) => {
    const button = `<button data-action="settings-category" data-settings-category-target="${category.id}"${category.id === "audio" ? ' aria-expanded="false" aria-controls="audio-settings-subnav"' : ""}><small>${String(index + 1).padStart(2, "0")}</small><span>${category.title}</span>${category.id === "audio" ? '<i class="settings-nav-chevron" aria-hidden="true">⌄</i>' : ""}</button>`;
    if (category.id !== "audio") return button;
    return ui`<div class="settings-nav-group">${button}<div id="audio-settings-subnav" class="settings-subnav" role="group" aria-label="音频快速跳转" hidden>${audioSettingsSections.map((section, index) => `<button data-action="audio-settings-jump" data-audio-settings-target="${section.id}" aria-controls="audio-settings-${section.id}"><small>${String(index + 1).padStart(2, "0")}</small><span>${section.title}</span></button>`).join("")}</div></div>`;
  }).join("");
}
type Shelf = "local" | "online";
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const icons = {
  play: svg('<path d="m8 4.5 12 7.5-12 7.5Z" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1"/>'),
  search: svg(
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  ),
  settings: svg(
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="var(--surface)"/><circle cx="15" cy="17" r="2.5" fill="var(--surface)"/>',
  ),
  folder: svg('<path d="M3 7V5h6l2 2h10v13H3Z"/>'),
  eq: svg('<path d="M5 3v18M12 3v18M19 3v18"/><path d="M3 8h4M10 16h4M17 10h4" stroke-width="4"/>'),
  lyrics: svg('<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5s1.3-6.1 3.9-8.5Z"/>'),
};
const read = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if(key==='rhine-music-preferences')window.rhineDesktop?.savePreferences(value);
  } catch {}
};
type ProcessingPresetRecord = {
  id: string;
  name: string;
  kind: "saved" | "imported";
  format?: "poweramp" | "rhine";
  eq?: ProcessingSettings["eq"];
  imported?: ImportedPowerampPreset;
  backup?: RhineProcessingBackup;
  sourceText?: string;
  updatedAt: number;
};
type EqModeBanks = Partial<Record<ProcessingSettings["eq"]["mode"], ProcessingSettings["eq"]>>;
type ProcessingUndoSnapshot = { settings: ProcessingSettings; eqBanks: EqModeBanks };
type ProcessingPresetStore = { schemaVersion: 1; activeId: string | null; presets: ProcessingPresetRecord[]; eqBanks: EqModeBanks };
function parseProcessingImport(sourceText: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(sourceText); }
  catch { return { format: "poweramp" as const, imported: importPowerampPreset(sourceText) }; }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && (Object.hasOwn(parsed, "schemaVersion") || Object.hasOwn(parsed, "settings") || Object.hasOwn(parsed, "eqModes"))) {
    return { format: "rhine" as const, backup: importRhineProcessingBackup(sourceText) };
  }
  return { format: "poweramp" as const, imported: importPowerampPreset(sourceText) };
}
const processingPresetKey = "rhine-audio-processing-presets-v1";
let processingPresetPersistenceError = window.rhineDesktop?.audioPresetPersistenceError || "";
let processingPresetWriteRevision = 0;
let processingPresetWritePending = false;
let pendingProcessingPresetStatus: { message: string; error: boolean } | null = null;
let canMigrateProcessingPresetStore = false;
const processingPresetStore = (() => {
  const raw = read<Partial<ProcessingPresetStore>>(processingPresetKey, {});
  const presets: ProcessingPresetRecord[] = [];
  const eqBanks: EqModeBanks = {};
  canMigrateProcessingPresetStore = raw.schemaVersion === 1 && Array.isArray(raw.presets)
    && (raw.activeId == null || typeof raw.activeId === "string")
    && (raw.eqBanks == null || (typeof raw.eqBanks === "object" && !Array.isArray(raw.eqBanks)));
  if (raw.eqBanks && Object.keys(raw.eqBanks).some((mode) => mode !== "graphic" && mode !== "parametric")) canMigrateProcessingPresetStore = false;
  if (raw.schemaVersion === 1 && Array.isArray(raw.presets)) {
    for (const item of raw.presets) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.name !== "string") { canMigrateProcessingPresetStore = false; continue; }
      try {
        if (item.kind === "saved" && (item.eq || (item as ProcessingPresetRecord & { processing?: ProcessingSettings }).processing?.eq)) {
          const eq = item.eq || (item as ProcessingPresetRecord & { processing?: ProcessingSettings }).processing?.eq;
          presets.push({ ...item, eq: normalizeProcessing({ ...processingDefault, eq }, { clamp: true }).eq });
        } else if (item.kind === "imported" && typeof item.sourceText === "string") {
          presets.push({ ...item, ...parseProcessingImport(item.sourceText) });
        } else canMigrateProcessingPresetStore = false;
      } catch {
        canMigrateProcessingPresetStore = false;
        // Keep malformed original text untouched in storage, but don't offer it as an applicable preset.
      }
    }
  }
  if (raw.eqBanks && typeof raw.eqBanks === "object") {
    for (const mode of ["graphic", "parametric"] as const) {
      const eq = raw.eqBanks[mode];
      if (!eq) continue;
      try { eqBanks[mode] = normalizeProcessing({ ...processingDefault, eq: { ...eq, mode } }, { clamp: true }).eq; } catch { canMigrateProcessingPresetStore = false; }
    }
  }
  return { schemaVersion: 1 as const, activeId: typeof raw.activeId === "string" ? raw.activeId : null, presets, eqBanks };
})();
const preferences = {
  ...{
    language: uiLanguage(),
    theme: "day" as Theme,
    followSystemTheme: false,
    windowAspect: "16:9" as WindowAspect,
    style: { ...defaultMusicStyle },
    styleProfiles: undefined as DesignProfiles | undefined,
    caseProfiles: undefined as CaseProfiles | undefined,
    futurePunkPresets: [] as CaseUserPreset[],
    archivePunkPresets: [] as CaseUserPreset[],
    themeLayoutVersion: 0,
    view: undefined as MusicViewSettings | undefined,
    foobarArchive: undefined as LegacyCatalogOptions | undefined,
    sortMode: "genre" as MusicSortMode,
    quality: "original" as QualityPreset,
    reduced: false,
    entryOnOpen: true,
    entryWelcome: defaultEntryWelcome,
    entryIdentity: defaultEntryIdentity,
    volume: 0.65,
    songFade: true,
    sony: { ...sonyOff },
    sonyParallel: true,
    sonyStreaming: true,
    output: normalizeOutput({...outputDefault,backend:window.rhineDesktop?.native?'wasapi':'browser'}),
    bgm: true,
    bgmVolume: 0.18,
    sound: true,
    soundVolume: 0.22,
    renderQuality: undefined as RenderQuality | undefined,
  },
  ...read<
    Partial<{
      language: "zh-CN" | "en";
      theme: Theme;
      followSystemTheme: boolean;
      windowAspect: WindowAspect;
      style: MusicStyle;
      styleProfiles: DesignProfiles;
      caseProfiles: CaseProfiles;
      futurePunkPresets: CaseUserPreset[];
      archivePunkPresets: CaseUserPreset[];
      themeLayoutVersion: number;
      view: MusicViewSettings;
      foobarArchive: LegacyCatalogOptions;
      sortMode: MusicSortMode;
      quality: QualityPreset;
      reduced: boolean;
      entryOnOpen: boolean;
      entryWelcome: string;
      entryIdentity: string;
      volume: number;
      songFade: boolean;
      sony: SonySettings;
      sonyParallel: boolean;
      sonyStreaming: boolean;
      output: OutputSettings;
      bgm: boolean;
      bgmVolume: number;
      sound: boolean;
      soundVolume: number;
      renderQuality: RenderQuality;
    }>
  >("rhine-music-preferences", {}),
};
preferences.language = uiLanguage();
preferences.followSystemTheme = preferences.followSystemTheme === true;
preferences.entryOnOpen = preferences.entryOnOpen !== false;
preferences.entryWelcome = normalizeEntryText(preferences.entryWelcome, defaultEntryWelcome);
preferences.entryIdentity = normalizeEntryText(preferences.entryIdentity, defaultEntryIdentity);
preferences.futurePunkPresets = normalizeCaseUserPresets(preferences.futurePunkPresets);
preferences.archivePunkPresets = normalizeCaseUserPresets(preferences.archivePunkPresets);
preferences.windowAspect = normalizeWindowAspect(preferences.windowAspect);
preferences.style = normalizeMusicStyle(preferences.style);
// The rejected mixed layout must not reopen over the restored glass player.
// Keep the foobar bank for an explicit future switch, without carrying its
// case, camera, colour or size overrides into the ordinary player.
const restoreGlassPlayer = preferences.themeLayoutVersion !== 2;
if (restoreGlassPlayer) {
  preferences.style = { ...defaultMusicStyle };
  preferences.themeLayoutVersion = 2;
}
let renderQuality = normalizeQuality(
  preferences.renderQuality || qualityPresets[preferences.quality],
);
if (!["day", "night"].includes(preferences.theme)) {
  preferences.theme = "day";
}
const savedView = preferences.view;
preferences.view = migrateMusicViewSettings(savedView, preferences.foobarArchive,
  preferences.style.design === "archive" ? "shelf" : "array");
musicApplication.configureView({ ...preferences.view, layout: preferences.view.layout === "grid" ? "array" : preferences.view.layout });
musicApplication.configureView(preferences.view);
preferences.foobarArchive = legacyCatalogOptions(musicApplication.view);
const designProfiles = normalizeDesignProfiles(preferences.styleProfiles, preferences.style, preferences.theme);
preferences.styleProfiles = designProfiles;
const caseProfiles = normalizeCaseProfiles(preferences.caseProfiles);
preferences.caseProfiles = caseProfiles;
if (!Object.hasOwn(qualityPresets, preferences.quality))
  preferences.quality = "original";
if (!["genre", "artist", "album"].includes(preferences.sortMode))
  preferences.sortMode = "genre";
if (restoreGlassPlayer || JSON.stringify(savedView) !== JSON.stringify(preferences.view))
  save("rhine-music-preferences", preferences);
const sortLabels: Record<MusicSortMode, { name: string; column: string; code: string }> = {
  genre: { name: trUi("按流派"), column: trUi("流派"), code: "GENRE" },
  artist: { name: trUi("按歌手名字"), column: trUi("歌手"), code: "ARTIST" },
  album: { name: trUi("按专辑名字"), column: trUi("分组"), code: "ALBUMS" },
};
const sortLabel = sortLabels[preferences.sortMode];
preferences.sony = normalizeSony(preferences.sony);
preferences.sonyParallel = preferences.sonyParallel !== false;
preferences.sonyStreaming = preferences.sonyStreaming !== false;
let processingRestoreError = "";
try { preferences.output=normalizeOutput(preferences.output); }
catch (error) {
  processingRestoreError = (error as Error).message;
  preferences.output = normalizeOutput({ ...preferences.output, processing: processingDefault });
}
type OutputWithProcessing = OutputSettings & { processing?: ProcessingSettings };
let processingSettings = normalizeProcessing((preferences.output as OutputWithProcessing).processing ?? processingDefault, { clamp: true });
;(preferences.output as OutputWithProcessing).processing = processingSettings;
processingPresetStore.eqBanks[processingSettings.eq.mode] = cloneProcessing(processingSettings).eq;
if (window.rhineDesktop?.native && !window.rhineDesktop.audioPresetStoreExists && !processingPresetPersistenceError && canMigrateProcessingPresetStore) saveProcessingPresetStore();
let sonyStatus: SonyStatus | undefined;
let nativeStatus: NativeStatus | undefined;
let libraryReceived = false,
  scanSubmitting = false;
let scanRefreshTimer: ReturnType<typeof setTimeout> | undefined;
// ---- Online shelf: a second, separate album shelf and list (never merged with the local library) ----
interface OnlineHit {
  ref: string;
  title: string;
  artist: string;
  year?: number;
  license?: string;
  url?: string;
  added: boolean;
}
interface OnlineSourceInfo {
  sources: { id: string; name: string; configured: boolean }[];
  subsonic?: { baseUrl: string; username: string; passwordSet: boolean };
  error?: string;
}
const onlineSearch = {
  source: "internetarchive",
  q: "",
  collection: "",
  page: 1,
  hasMore: false,
  items: [] as OnlineHit[],
  busy: false,
  error: "",
};
let onlineSources: OnlineSourceInfo | undefined;
let onlineSnapshot: MusicLibrary | undefined;
const onlineCollections: [string, string][] = [
  ["", trUi("全部音频")],
  ["opensource_audio", trUi("社区上传音频")],
  ["netlabels", trUi("网络厂牌（多为 CC 授权）")],
  ["etree", trUi("现场录音")],
  ["78rpm", trUi("78 转老唱片")],
];
const onlineEmptyHtml =
  trUi('<small>YOUR ONLINE SHELF</small><h1>在线专辑架还是空的。</h1><p>从 Internet Archive 或你自己的音乐服务搜索专辑，加入后它们会出现在这座独立的专辑架上。</p><button data-action="online">搜索在线专辑 ↗</button><button data-action="shelf-local" class="subtle">返回本地专辑架</button>');
let shelf: Shelf = "local";
let library: MusicLibrary = {
  version: 1,
  albums: [],
  genres: [],
  roots: [],
  scan: { running: false },
  onlineEnabled: false,
};
let albums: MusicAlbum[] = [],
  genres: MusicGenre[] = [],
  demo = false;
let panel: Panel = null;
let page: "music" | "settings" | "eq" | "lyrics" | "signal" | "theme" = "music";
let settingsCategory: SettingsCategory = "interface";
let themePageScrollTop = 0;
let foobarShell: ReturnType<typeof setupFoobarShell> | undefined;
let catalogGrid: ReturnType<typeof setupMusicCatalogGrid> | undefined;
let cleanupStylePreview: (() => void) | undefined;
let cleanupQualityDetection: (() => void) | undefined;
let caseEditor: ReturnType<typeof setupCaseEditor> | undefined;
let audioSettingsSection: AudioSettingsSection = "source";
const settingsScrollPositions = new Map<SettingsCategory, number>();
let settingsSelectControls: ReturnType<typeof enhanceSettingsSelectControls> | undefined;
let panelSelectControls: ReturnType<typeof enhanceSettingsSelectControls> | undefined;
let eqControls: ReturnType<typeof setupEqControls> | undefined;
const standardEqPresetState = createStandardEqPresetState();
let standardEqPresets: ReturnType<typeof setupStandardEqPresets> | undefined;
let lyricsSettings: ReturnType<typeof setupLyricsSettings> | undefined;
let cleanupAlbumInfoSources: (() => void) | undefined;
let processingPresetElement: HTMLElement | undefined;
let processingApplyMessage = "";
let eqPageScrollTop = 0, eqPresetsExpanded = false;
let editableRanges: ReturnType<typeof setupEditableRanges> | undefined;
let processingApplyTimer: ReturnType<typeof setTimeout> | undefined;
let processingApplyPending = false;
let processingApplyRevision = 0;
let processingEditStart: ProcessingUndoSnapshot | undefined;
let lastProcessingError = "";
const processingUndoStack: ProcessingUndoSnapshot[] = [];
let pageFocus: HTMLElement | null = null;
let libraryDraftRoots: string[] = [], selectedLibraryRoot = -1;
let libraryDraftDirty = false, choosingLibraryFolder = false;
let scene: ArchiveScene | undefined,
  ready = false,
  apiAvailable = true,
  refreshing = false;
let futureEntry: FutureEntry | undefined;
let introductionsStarting = false,
  libraryStateVersion = 0,
  introductionRequestError = "";
let viewer: ModelViewer | undefined;
const effects = new TerminalAudio();
let interfaceAudioError = '', interfaceErrorKey = '', interfaceEffectsKey = '', interfaceNative: boolean | undefined;
const interfaceAudio = new InterfaceAudioClient(error => {
  if (interfaceAudioError !== error.message) { interfaceAudioError = error.message; notify(error.message) }
  updateInterfaceSoundControls();
});
document.addEventListener("pointerdown", () => void effects.unlock(), {
  once: true,
});
document.addEventListener("keydown", () => void effects.unlock(), {
  once: true,
});
let toastTimer: ReturnType<typeof setTimeout>,
  pollTimer: ReturnType<typeof setTimeout> | undefined;
let playerState: MusicPlayerState;
const player = new MusicPlayer({
  volume: preferences.volume,
  songFadeEnabled: preferences.songFade,
  bgmEnabled: preferences.bgm,
  bgmVolume: preferences.bgmVolume,
  sonySettings: preferences.sony,
  sonyExecution: { parallel: preferences.sonyParallel, streaming: preferences.sonyStreaming },
  outputSettings: preferences.output,
});
syncInterfaceAudio();
function syncInterfaceAudio() {
  const output = preferences.output, native = output.backend !== 'browser';
  const musicBusy = playerState?.transport === 'loading' || playerState?.transport === 'playing' || playerState?.playing === true;
  const future = preferences.style.design === 'rhine';
  const errorKey = JSON.stringify([future,preferences.sound,output.backend,output.device,output.channel,output.wasapiDevice]);
  if (errorKey !== interfaceErrorKey) { interfaceErrorKey = errorKey; interfaceAudioError = '' }
  if (interfaceNative !== native) {
    interfaceAudioError = '';
    effects.setEffectSink(native ? interfaceAudio : undefined);
    interfaceNative = native;
  }
  interfaceAudio.configure({
    design: preferences.style.design, enabled: preferences.sound && future, musicBusy,
    output: { backend: output.backend, device: output.device, channel: output.channel, wasapiDevice: output.wasapiDevice },
  });
  const effectSettings = { sound: preferences.sound && future && !musicBusy, music: false, soundVolume: preferences.soundVolume, musicVolume: 0 };
  const effectKey = JSON.stringify(effectSettings);
  if (effectKey !== interfaceEffectsKey) { interfaceEffectsKey = effectKey; effects.configure(effectSettings) }
  updateInterfaceSoundControls();
}
function updateInterfaceSoundControls() {
  const future = preferences.style.design === 'rhine';
  const busy = playerState?.transport === 'loading' || playerState?.transport === 'playing' || playerState?.playing === true;
  const native = preferences.output.backend !== 'browser';
  const status = document.querySelector<HTMLElement>('#interface-sound-status');
  if (status) status.textContent = !future ? trUi('Punk 界面音效尚待设计。') : interfaceAudioError ? `${trUi('界面音效输出失败：')}${interfaceAudioError}` : busy ? trUi('音乐播放期间暂停界面音效；暂停或停止后恢复。') : trUi('Future 界面音效跟随播放器输出设备；WASAPI 使用共享模式。');
  for (const id of ['sound-setting','sound-volume']) {
    const control = document.querySelector<HTMLInputElement>(`#${id}`);
    if (control) control.disabled = !future;
  }
  const preview = document.querySelector<HTMLButtonElement>('[data-action="sound-preview"]');
  if (preview) { preview.disabled = !future || busy || !preferences.sound; preview.title = !future ? trUi('Punk 界面音效尚待设计。') : busy ? trUi('音乐播放期间暂停界面音效；暂停或停止后恢复。') : !preferences.sound ? trUi('请先开启界面音效。') : '' }
  const bgmStatus = document.querySelector<HTMLElement>('#interface-bgm-status');
  if (bgmStatus) { bgmStatus.hidden = !native; bgmStatus.textContent = native ? trUi('氛围 BGM 目前仅支持浏览器兼容输出。') : '' }
}
const themeNames: Record<Theme, string> = {
  day: trUi("暖昼"),
  night: trUi("深夜"),
};
const stage = $("#stage");
stage.className = "music-app";
stage.dataset.mode = "archive";
stage.dataset.page = "music";
stage.dataset.theme = preferences.theme;
applyStylePalette(stage, preferences.style, preferences.theme);
stage.dataset.reducedMotion = String(preferences.reduced);
stage.innerHTML = ui`
  <div id="three-scene" class="three-scene"></div>
  <div class="music-vignette" aria-hidden="true"></div>
  <header class="music-header">
    <div class="music-identity"><a class="music-brand" href="/" aria-label="Rhine Music 音乐库"><strong>RHINE LAB</strong><span>MUSIC ARCHIVE <i>／</i> Terminal</span></a></div>
    <nav class="music-topnav" aria-label="音乐终端导航">
      <button data-action="library" aria-label="唱片主页" aria-pressed="true" aria-controls="music-browse">${icons.folder}<span>${musicInterfaceLabels.navigation.archive}</span></button>
      <button data-action="eq" aria-label="EQ 均衡器" title="均衡器" aria-pressed="false" aria-controls="music-eq-page">${icons.eq}<span>EQ</span></button>
      <button data-action="lyrics" aria-label="歌词" title="歌词" aria-pressed="false" aria-controls="music-lyrics-page">${icons.lyrics}<span>${musicInterfaceLabels.navigation.lyrics}</span></button>
      <button data-action="signal" aria-label="信号" title="信号" aria-pressed="false" aria-controls="music-signal-page">${svg('<path d="M2 12h3l3-7 4 14 4-14 3 7h3"/>')}<span>${musicInterfaceLabels.navigation.signal}</span></button>
      <button data-action="theme" aria-label="图形设置" title="图形设置" aria-pressed="false" aria-controls="music-theme-page">${svg('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="6" height="7" rx="1"/><rect x="4" y="14" width="7" height="6" rx="1"/><circle cx="17" cy="17" r="3"/>')}<span>${musicInterfaceLabels.navigation.style}</span></button>
      <button data-action="search" aria-label="搜索">${icons.search}<span>${musicInterfaceLabels.navigation.search}</span></button>
      <button data-action="online" aria-label="在线曲库" aria-pressed="false">${icons.globe}<span>${musicInterfaceLabels.navigation.online}</span></button>
      <button data-action="settings" class="icon-button" aria-label="设置" title="设置" aria-pressed="false" aria-controls="music-settings">${icons.settings}<span>${musicInterfaceLabels.navigation.settings}</span></button>
      <div class="minimal-transport" role="group" aria-label="当前歌曲"><button type="button" data-action="locate-playing" id="transport-track" class="transport-track" aria-label="定位当前歌曲" aria-hidden="true" disabled><span id="transport-track-label"></span></button></div>
    </nav>
  </header>
  <div id="library-status" class="library-status"><i></i><span>正在读取本地音乐索引</span></div>
  <section id="music-browse" class="music-browse" aria-label="专辑浏览">
    <div class="music-browse-veil" aria-hidden="true"></div>
    <div class="album-callout"><p class="music-eyebrow">MUSIC ARCHIVE <span>／</span> <span id="selection-genre"></span></p>
      <div class="selection-rule"><span id="selection-code">ALBUM <span id="selection-code-number">001</span></span><span id="selection-format"></span></div>
      <h1 id="selection-title"></h1><p id="selection-artist" class="selection-artist"></p>
      <div class="selection-meta" id="selection-meta"></div>
      <div id="selection-profile" class="selection-profile" hidden></div>
      <div class="album-actions" role="group" aria-label="专辑操作">
        <button type="button" class="browse-play-album" data-action="play-album" aria-label="播放专辑" data-cjk="${containsCjk(trUi("播放专辑"))}"><span class="play-album-label">播放专辑</span><span class="play-album-access-label" aria-hidden="true">PLAY ALBUM</span><span class="play-album-icon" aria-hidden="true">${icons.play}</span></button>
        <button type="button" class="open-album" data-action="open" aria-label="打开专辑" data-cjk="${containsCjk(trUi("打开专辑"))}"><span class="open-album-label">打开专辑</span><span class="open-album-access-label" aria-hidden="true">ACCESS ALBUM</span><span class="open-album-arrow" aria-hidden="true">→</span><span class="open-album-punk-arrow" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="m4 14 10-10M5 4h9v9"/></svg></span></button>
      </div>
    </div>
    <div class="music-navigation">
      <div class="music-counter"><span class="music-eyebrow">ALBUM / SELECT</span><div><b id="selection-number">01</b><span>/ <i id="selection-total">00</i></span></div></div>
      <div class="album-stepper"><button data-action="prev" aria-label="上一个专辑">↑</button><div id="album-ticks"></div><button data-action="next" aria-label="下一个专辑">↓</button></div>
      <div class="genre-stepper"><button data-action="genre-prev" aria-label="上一个${sortLabel.column}">←</button><div><small id="genre-position">${sortLabel.code} <span id="genre-index">01</span> / <span id="genre-total">00</span></small><button data-action="genres" id="genre-name"></button></div><button data-action="genre-next" aria-label="下一个${sortLabel.column}">→</button></div>
    </div>
    <div class="music-keyhint">← → ${sortLabel.column} <span>／</span> ↑ ↓ 专辑 <span>／</span> ENTER 打开专辑</div>
  </section>
  <section id="music-detail" class="music-detail" aria-label="专辑详情" hidden>
    <button class="music-back" data-action="back">← 返回专辑架 <kbd>ESC</kbd></button>
    <div class="card-caption"><span id="detail-card-id"></span><small>拖动卡片，查看完整封面</small></div>
    <article id="album-detail-content" tabindex="-1"></article>
  </section>
  <div id="music-empty" class="music-empty" hidden><small>YOUR PRIVATE COLLECTION</small><h1>让音乐进入这座档案馆。</h1><p>在设置中选择本地音乐文件夹，专辑封面会出现在每一张卡片上。</p><button data-action="library-settings">打开音乐库设置 ↗</button><button data-action="demo" class="subtle">先查看演示封面</button></div>
  <section id="music-settings" class="music-settings-page" aria-labelledby="settings-page-title" hidden>
    <div class="settings-page-heading"><div><small>SYSTEM / SETTINGS</small><h1 id="settings-page-title" tabindex="-1">设置</h1><p>管理界面与交互、显示与性能、歌词、音频、音乐库、音乐来源与关于设置。</p></div></div>
    <div class="settings-page-layout"><nav class="settings-page-nav" aria-label="设置分类">${settingsNavigationMarkup()}</nav><div id="settings-page-content" class="settings-page-content" role="region" aria-label="设置内容"></div></div>
  </section>
  <section id="music-eq-page" class="music-settings-page music-eq-page" aria-labelledby="eq-page-title" hidden>
    <div class="settings-page-heading"><div><small>AUDIO / EQUALIZER</small><h1 id="eq-page-title" tabindex="-1">均衡器</h1><p>调整频段，预览声音的变化</p></div></div>
    <div class="settings-page-layout eq-page-layout"><div id="eq-page-content" class="settings-page-content" role="region" aria-label="均衡器内容"></div></div>
  </section>
  <section id="music-lyrics-page" class="music-settings-page music-lyrics-page" aria-labelledby="lyrics-page-title" hidden>
    <div class="settings-page-heading"><div><small>LYRICS / LISTENING</small><h1 id="lyrics-page-title" tabindex="-1">歌词</h1><p>跟随音乐，阅读歌词</p></div></div>
    <div id="lyrics-page-content" class="settings-page-content" role="region" aria-label="歌词与歌曲信息"></div>
  </section>
  <section id="music-signal-page" class="music-settings-page music-signal-page" aria-labelledby="signal-page-title" hidden>
    <div class="settings-page-heading"><div><small>SIGNAL / MONITOR</small><h1 id="signal-page-title" tabindex="-1">信号</h1><p>音乐的轮廓</p></div></div>
    <div id="signal-page-content" role="region" aria-label="信号监视"></div>
  </section>
  <div class="music-page-scan" aria-hidden="true" hidden><div class="music-page-scan-head"></div></div>
  <section id="music-theme-page" class="music-settings-page music-theme-page" aria-labelledby="theme-page-title" hidden>
    <div class="settings-page-heading"><div><small>STYLE</small><h1 id="theme-page-title" tabindex="-1">主题与外观</h1><p>主题、配色与唱片盒外观在 STYLE 中调整。</p></div></div>
    <div id="theme-page-content" class="settings-page-content" role="region" aria-label="主题与外观"></div>
  </section>
  ${playbackMarkup()}
  <div class="music-bottomline"><span id="collection-line">LOCAL COLLECTION <i>·</i> <span id="library-count">0 ALBUMS</span></span><span id="runtime-info">THREE.JS / LOCAL</span></div>
  <div id="music-panel-root"></div><div id="music-toast" role="status" aria-live="polite"></div>
  <div id="music-startup-error" role="alert" hidden></div>
`;
editableRanges = setupEditableRanges(stage);
const entryTextControls = setupEntryTextControls(stage, {
  read: key => preferences[key],
  write: (key, value) => { preferences[key] = value; savePrefs(); },
  enabled: () => preferences.style.design === "rhine",
});
syncDesignIdentity();
stage.addEventListener("eq-controls-rerender", () => {
  if (page !== "eq") return;
  const content = $("#eq-page-content");
  settingsSelectControls?.destroy();
  settingsSelectControls = enhanceSettingsSelectControls(content);
  editableRanges?.sync();
  syncEqModePanels();
  syncPunkEqTypography();
});
const localEmptyHtml = $("#music-empty").innerHTML;
const lyricsPage = setupLyricsPage($("#lyrics-page-content"), {
  seek: position => player.seek(position), spectrum: () => player.readSpectrum(), notify, openSettings: openLyricsSettings,
  albumOrdinal: album => {
    if (!album) return undefined;
    const index = records.findIndex(record => record.album?.id === album?.id);
    return index < 0 ? undefined : index + 1;
  },
  createCasePreview: host => setupAlbumCasePreview(host, {
    getSettings: () => caseProfiles[preferences.style.design],
    getQuality: () => renderQuality,
    getTheme: () => preferences.theme,
    getDesign: () => preferences.style.design,
    getAlbum: () => {
      const album = currentLyricsAlbum(player.state);
      const index = album ? records.findIndex(record => record.album?.id === album.id) : -1;
      return {
        coverUrl: album?.coverUrl, title: album?.title,
        record: index >= 0 ? records[index] : album ? { id: album.id, album } as ArchiveRecord : undefined,
        index: index >= 0 ? index : undefined, reduced: preferences.reduced,
      };
    },
  }),
});
const signalPage = setupSignalPage($("#signal-page-content"), { seek: position => player.seek(position), spectrum: () => player.readSpectrum(), reduced: () => preferences.reduced || matchMedia("(prefers-reduced-motion: reduce)").matches });
const albumInfoEditor = setupAlbumInfoEditor(stage, {
  request: async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || `本地服务请求失败 (${response.status})`);
    return data as T;
  },
  onLibrary: next => receiveLibrary(next),
  getAlbum: id => library.albums.find(album => album.id === id),
  notify,
});
const pageScan = new PageScanTransition($(".music-page-scan"));
const terminalLighting = setupTerminalLighting(stage);
terminalLighting.setQuality(renderQuality);
const themeFollowing = setupMusicThemeFollow(
  window.matchMedia("(prefers-color-scheme: dark)"), preferences.followSystemTheme,
  { getTheme: () => preferences.theme, applyTheme: setTheme },
);
stage.addEventListener("lyrics-settings-updated", () => {
  if (page !== "settings") return;
  settingsSelectControls?.destroy();
  settingsSelectControls = enhanceSettingsSelectControls($("#settings-page-content"));
});
$("#music-browse").insertAdjacentHTML("afterbegin", musicBrowseControlsMarkup(musicApplication.view));
$(".open-album").setAttribute("aria-label", uiLanguage() === "en" ? "Open album" : "打开专辑");
$(".browse-play-album").setAttribute("aria-label", uiLanguage() === "en" ? "Play album" : "播放专辑");
$(".album-actions").setAttribute("aria-label", uiLanguage() === "en" ? "Album actions" : "专辑操作");
const titleMotion = setupMusicTitleLayout(stage);
const albumPanel = setupAlbumPanel(stage, () => preferences.reduced);
albumPanel.setActive(true);
stage.addEventListener("album-panel-layout", () => syncTabIndicator(false));
$("#selection-title").insertAdjacentHTML("beforeend", `<span class="source-audio-badges">${hiResBadgeMarkup("album", "selection-hi-res", true)}${dsdBadgeMarkup("album", "selection-dsd", true)}</span>`);
const textMotion = setupMusicTextMotion(stage);
// Keep the previous navigation available while the ruler version is on trial.
const tickMotion = new URLSearchParams(location.search).get("nav") === "previous"
  ? setupMusicTicks($("#album-ticks"))
  : setupMusicRuler($("#album-ticks"));
setupTouchRuler($("#album-ticks"), (steps) => stepAlbum(steps));
let selectionInitialized = false;
const selectionMotionEnabled = () =>
  ready &&
  page === "music" &&
  musicApplication.mode === "archive" &&
  !$("#music-browse").hidden &&
  !preferences.reduced;
function syncSelectionMotion() {
  // Build static reels during the hidden camera movement, before the text fades in.
  const enabled = page === "music" && (selectionMotionEnabled() ||
    (musicApplication.mode === "archive" && !!albums.length && !preferences.reduced));
  textMotion.setEnabled(enabled);
  if (!enabled) titleMotion.finish();
  else {
    const album = currentAlbum();
    if (album) titleMotion.update(getMusicFocusedEntry(musicApplication.selectedIndex)?.record.title ?? album.title, true);
  }
}

function notify(message: string) {
  $("#music-toast").textContent = message;
  $("#music-toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => $("#music-toast").classList.remove("visible"),
    5500,
  );
}
function time(value: number) {
  const n = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
function genreName(id: string) {
  return genres.find((g) => g.id === id)?.name || trUi("未分类");
}
function currentAlbum() {
  return albums.find((a) => a.id === records[musicApplication.selectedIndex]?.id);
}
function formatList(a: MusicAlbum) {
  return (
    [
      ...new Set(
        a.tracks.map((t) => (t.codec ? `${t.format} / ${t.codec}` : t.format)),
      ),
    ].join(" · ") || (demo ? trUi("封面演示") : trUi("未提供"))
  );
}
function albumDuration(a: MusicAlbum) {
  return a.tracks.reduce((sum, t) => sum + t.duration, 0);
}
function valueRange(
  values: (number | undefined)[],
  format: (n: number) => string,
) {
  const n = [
    ...new Set(values.filter((v): v is number => !!v && Number.isFinite(v))),
  ].sort((a, b) => a - b);
  return n.length
    ? n.length === 1
      ? format(n[0])
      : `${format(n[0])}–${format(n[n.length - 1])}`
    : trUi("未提供");
}
function albumFormatSummary(a: MusicAlbum, compact: boolean) {
  const formats = [...new Set(a.tracks.map(track => track.format.trim()).filter(Boolean))].join(" / ");
  const bits = a.tracks.filter(track => track.lossless !== false).map(track => track.bitsPerSample)
    .filter((value): value is number => !!value && Number.isFinite(value) && value > 0);
  const rates = a.tracks.map(track => track.sampleRate)
    .filter((value): value is number => !!value && Number.isFinite(value) && value > 0);
  const depth = bits.length ? valueRange(bits, String) : "";
  const rate = rates.length ? valueRange(rates, value => String(Number((value / 1000).toFixed(1)))) : "";
  const resolution = compact && depth && rate
    ? `${depth}/${rate}`
    : [depth ? `${depth} bit` : "", rate ? `${rate} kHz` : ""].filter(Boolean).join(" / ");
  return [formats, resolution].filter(Boolean).join(compact ? " " : " · ");
}
function cover(a: MusicAlbum, className = "") {
  return a.coverUrl
    ? ui`<img class="${className}" src="${esc(a.coverUrl)}" alt="${esc(a.title)}专辑封面" loading="lazy">`
    : `<span class="cover-placeholder">♪</span>`;
}
const detailTransition = new SurfaceTransition(
  $("#music-detail"),
  undefined,
  360,
  240,
  "right",
);
const browseTransition = new SurfaceTransition(
  $("#music-browse"),
  undefined,
  // Keep the existing reveal timing, but fade each overlay in its own layer.
  // Fading the parent traps its text below the night vignette until opacity=1.
  720,
  140,
  "up",
  "cubic-bezier(0.45, 0, 0.25, 1)",
  [$(".music-browse-veil"), $(".music-browse-tools"), $(".music-navigation"), $(".music-keyhint")],
);
let detailIdentity = "";
const trackFocus = new MusicTrackFocus();
let pendingTrackReveal: { albumId: string; trackId: string } | undefined;
function cancelTrackReveal() {
  pendingTrackReveal = undefined;
  trackFocus.cancel();
}
// The pane is interactive while its entrance is finishing. Cancel a queued
// reveal too, so a click/scroll in that interval is never pulled back later.
for (const event of ["wheel", "pointerdown", "touchstart", "keydown"] as const) {
  $("#album-detail-content").addEventListener(event, () => {
    if (pendingTrackReveal) cancelTrackReveal();
  }, { passive: true });
}
let libraryRebuilding = false;
let pendingArchiveVisual: { index: number; entryKey?: string; navigation?: ArchiveNavigation } | undefined;
type LibraryIntent = AlbumSelection & { openAfter: boolean } |
  { mode: "archive" | "detail" };
let libraryIntent: LibraryIntent | undefined;
const presentation = new MusicPresentation({
  presentationReady: () => scene?.musicPresentationReady ?? false,
  archiveReady: () => { flushArchiveVisual(); return scene?.musicArchiveReady ?? false; },
  archiveInteractive: () => scene?.musicArchiveInteractive ?? false,
  enterCamera: () => {
    scene?.setMode("detail");
    effects.setScene("detail");
    effects.play("open");
  },
  returnCamera: () => {
    scene?.setMode("archive");
    effects.setScene("archive");
    effects.play("back");
  },
  select: ({ index, navigation, entryKey }) => commitSelection(index, navigation, false, entryKey),
  switchDetail: ({ index, navigation, entryKey }) => commitSelection(index, navigation, true, entryKey),
  mode: (next) => {
    flushArchiveVisual();
    musicApplication.mode = next;
    stage.dataset.mode = next;
    albumPanel.setOpen(next === "detail");
    syncMusicCatalogView();
    syncSelectionMotion();
  },
  prepareMenu: () => {
    detailTransition.hide(true);
    renderDetail();
    $("#music-detail").inert = true;
    $("#music-detail").setAttribute("aria-hidden", "true");
  },
  showMenu: () => {
    const detail = $("#music-detail");
    detailTransition.show(preferences.reduced);
    detail.inert = !!panel;
    detail.setAttribute("aria-hidden", "false");
  },
  hideMenu: (done) => {
    trackFocus.cancel();
    $("#music-detail").inert = true;
    $("#music-detail").setAttribute("aria-hidden", "true");
    detailTransition.hide(true, done);
  },
  hideBrowse: (done) => {
    $("#music-browse").inert = true;
    $("#music-browse").setAttribute("aria-hidden", "true");
    browseTransition.hide(preferences.reduced, done);
  },
  showBrowse: showBrowseSurface,
});
const albumInteraction = setupAlbumInteraction(stage, {
  enabled: () => ready && !futureEntry?.active && page === "music" && !!albums.length && !panel && !viewer?.isOpen,
  stepAlbum, stepShelf: stepGenre,
  scrollTarget: () => albumPanel.scrollTarget(),
  tab: direction => { setTab(direction < 0 ? "tracks" : "about");$("#tab-" + musicApplication.activeTab).focus({ preventScroll: true }); },
});
function showBrowseSurface(immediate = false) {
  if (!albums.length) return;
  browseTransition.show(immediate || preferences.reduced);
  albumPanel.setVisible(true, !!panel);
  $("#music-browse").inert = !!panel;
  $("#music-browse").setAttribute("aria-hidden", "false");
  syncSelectionMotion();
  if (!panel && stage.dataset.operationFocus !== "right") $("#three-scene").focus({ preventScroll: true });
}

function entryPlaybackUnavailable(): string {
  if (!ready || !scene) return trUi("终端正在准备，请稍后重播。");
  if (preferences.style.design !== "rhine" || !["array", "shelf"].includes(musicApplication.view.layout) ||
    musicApplication.view.show !== "albums") return trUi("当前入场适用于 Future 的 ALBUMS / MATRIX 或 ARRAY 视图。");
  if (!albums.length) return trUi("添加专辑后可播放终端入场。");
  if (preferences.reduced) return trUi("关闭“减少动态效果”后可重播入场。");
  if (libraryRebuilding) return trUi("曲库正在更新，请稍后重播。");
  return "";
}

function syncEntrySettings() {
  const button = document.querySelector<HTMLButtonElement>('[data-action="entry-replay"]');
  const note = document.querySelector<HTMLElement>("#entry-replay-note");
  const reason = entryPlaybackUnavailable();
  if (button) button.disabled = !!reason;
  if (note) note.textContent = reason || trUi("重播会回到专辑总览，不影响音乐播放。");
  const future = preferences.style.design === "rhine";
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#entry-settings [data-entry-text], #entry-on-open, [data-action="entry-text-reset"]').forEach(control => { control.disabled = !future; });
}

function startFutureEntry() {
  if (futureEntry?.active || entryPlaybackUnavailable()) return false;
  const entryLayout = musicApplication.view.layout === "shelf" ? "shelf" : "array";
  if (entryLayout === "shelf") scene?.showMusicArchiveImmediately(performance.now() / 1000);
  effects.setScene("boot");
  effects.restartBoot();
  // Native cues use offline synthesis; the desktop entry needs no browser
  // autoplay grant. Browser output still follows its normal gesture policy.
  if (window.rhineDesktop?.native) void effects.unlock();
  futureEntry = new FutureEntry(stage, (skipped, ms) => {
    effects.setScene("archive");
    if (skipped) effects.play("confirm");
    const now = ms / 1000;
    if (skipped) scene?.showMusicArchiveImmediately(now);
    else {
      scene?.update(now, futureEntryShot(futureEntryEndFor(entryLayout), entryLayout));
      scene?.finishMusicIntro(now);
    }
    syncSelectionMotion();
  }, { welcome: preferences.entryWelcome, identity: preferences.entryIdentity }, entryLayout);
  // Prepare the real rack/material variants beneath the opaque shared prelude.
  // Compilation must not consume the first visible seconds of the new act.
  if (entryLayout === "shelf") scene?.update(performance.now() / 1000, futureEntryShot(27, entryLayout));
  return true;
}

function replayFutureEntry() {
  flushArchiveVisual();
  if (futureEntry?.active) return;
  const reason = entryPlaybackUnavailable();
  if (reason) { notify(reason); return; }
  pageScan.cancelPending();
  closeManagementPage(false);
  cancelTrackReveal();
  presentation.reset();
  albumPanel.finish();
  detailTransition.hide(true);
  $("#music-detail").inert = true;
  $("#music-detail").setAttribute("aria-hidden", "true");
  scene?.showMusicArchiveImmediately(performance.now() / 1000);
  showBrowseSurface(true);
  effects.setScene("archive");
  if (startFutureEntry()) { futureEntry?.arm(); effects.play("ui-tick"); }
}
function savePrefs() {
  preferences.view = musicApplication.view;
  preferences.foobarArchive = legacyCatalogOptions(musicApplication.view);
  designProfiles[preferences.style.design] = { style: { ...preferences.style }, mode: preferences.theme };
  for (const profile of Object.values(designProfiles)) profile.mode = preferences.theme;
  preferences.styleProfiles = designProfiles;
  preferences.caseProfiles = caseProfiles;
  (preferences.output as OutputWithProcessing).processing = processingSettings;
  save("rhine-music-preferences", preferences);
}
function setTheme(theme: Theme) {
  if (theme !== "day" && theme !== "night") theme = "day";
  if (theme === preferences.theme) return;
  preferences.theme = theme;
  stage.dataset.theme = theme;
  applyStylePalette(stage, preferences.style, theme);
  applyWindowAspect(stage, preferences.windowAspect, stylePalette(preferences.style, preferences.theme).bg);
  scene?.setTheme(theme, !preferences.reduced);
  scene?.setMusicStyle(preferences.style, !preferences.reduced);
  viewer?.setTheme(theme);
  lyricsPage.refreshCasePreview();
  syncThemeButtons();
  savePrefs();
  if (page === "theme") {
    if (preferences.style.design === "rhine") {
      syncMusicStyleAppearance($("#theme-page-content"), preferences.style, preferences.theme, preferences.followSystemTheme);
      caseEditor?.refresh();
    } else renderThemePage();
  }
}
function setFutureDayPalette(value: string) {
  if (preferences.style.design !== "rhine" || (value !== "soft" && value !== "original") || value === preferences.style.dayPalette) return;
  preferences.style = normalizeMusicStyle({ ...preferences.style, dayPalette: value });
  applyStylePalette(stage, preferences.style, preferences.theme);
  scene?.setMusicStyle(preferences.style, !preferences.reduced);
  syncThemeButtons();
  terminalLighting.refresh();
  savePrefs();
}
function syncThemeButtons() {
  const theme = preferences.theme;
  document
    .querySelectorAll<HTMLButtonElement>("button[data-theme]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.theme === theme)),
    );
  document.querySelectorAll<HTMLInputElement>("[data-follow-system-theme]").forEach(control => {
    control.checked = preferences.followSystemTheme;
  });
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", preferences.style.design === "rhine" && theme === "night" ? "#0a1220" : stylePalette(preferences.style, theme).bg);
  if (page === "theme" && preferences.style.design === "rhine")
    syncMusicStyleAppearance($("#theme-page-content"), preferences.style, theme, preferences.followSystemTheme);
}
function setFollowSystemTheme(following: boolean) {
  if (following === preferences.followSystemTheme) return;
  const previousTheme = preferences.theme;
  preferences.followSystemTheme = following;
  themeFollowing.setFollowing(following);
  // A changed mode has already saved both fields through setTheme.
  if (preferences.theme === previousTheme) savePrefs();
  syncThemeButtons();
}
function syncDesignIdentity() {
  const archive = preferences.style.design === "archive";
  $("#selection-code").firstChild!.textContent = archive ? "ALBUM NO. " : "ALBUM ";
  $(".music-brand strong").textContent = archive ? "AUDIO ARCHIVE" : "RHINE LAB";
  $(".music-brand > span").innerHTML = archive ? ui`RHINE / LISTENING TERMINAL` : ui`MUSIC ARCHIVE <i>／</i> Terminal`;
  const shelfLabel = $("#genre-position").firstChild;
  if (shelfLabel?.nodeType === Node.TEXT_NODE) shelfLabel.textContent = `${archive ? "SHELF" : sortLabel.code} `;
  themeNames.day = "LIGHT";
  themeNames.night = "DARK";
  stage.querySelectorAll<HTMLButtonElement>(".theme-switch button[data-theme]").forEach(button => {
    const name = themeNames[button.dataset.theme as Theme];
    button.querySelector("span")!.textContent = name;
    button.setAttribute("aria-label", name);
  });
  if (foobarShell) {
    detailTransition.dispose();browseTransition.dispose();
    albumPanel.setActive(true);
  }
  foobarShell?.setActive(archive);
  catalogGrid?.setDesign(preferences.style.design);
  if (foobarShell) albumPanel.setOpen(musicApplication.mode === "detail");
  if (foobarShell) textMotion.refresh();
  if (foobarShell && playerState) playbackControls.update(playerState);
  syncThemeButtons();
  fit();
}
function setMusicStyle(next: MusicStyle) {
  if (preferences.style.design !== "archive") return;
  preferences.style = normalizeMusicStyle(next);
  applyStylePalette(stage, preferences.style, preferences.theme);
  applyWindowAspect(stage, preferences.windowAspect, stylePalette(preferences.style, preferences.theme).bg);
  scene?.setMusicStyle(preferences.style);
  lyricsPage.refreshCasePreview();
  void scene?.setCaseSettings(caseProfiles[preferences.style.design]).catch(error => notify((error as Error).message));
  savePrefs();
  updateSelection();
  if (page === "theme") renderThemePage();
}
async function switchDesign(design: MusicStyle["design"]) {
  if (design === preferences.style.design) return;
  playbackControls.closeMenu();
  // Let in-flight camera/menu gates receive their completion callbacks before
  // disposing either theme's surfaces and moving their DOM nodes.
  detailTransition.finish();browseTransition.finish();albumPanel.finish();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  designProfiles[preferences.style.design] = { style: { ...preferences.style }, mode: preferences.theme };
  const next = designProfiles[design];
  preferences.style = normalizeMusicStyle({ ...next.style, design });
  syncInterfaceAudio();
  if (design === "archive") {
    await Promise.all([400, 500, 600, 700].map(weight => document.fonts.load(`${weight} 17px "Archive Mono"`)));
    if (preferences.style.design !== design) return;
  }
  stage.dataset.theme = preferences.theme;
  applyStylePalette(stage, preferences.style, preferences.theme);
  scene?.setTheme(preferences.theme, !preferences.reduced);
  scene?.setMusicStyle(preferences.style);
  void scene?.setCaseSettings(caseProfiles[design]).catch(error => notify((error as Error).message));
  viewer?.setTheme(preferences.theme);
  lyricsPage.refreshCasePreview();
  syncDesignIdentity();
  savePrefs();
  updateSelection();
  if (page === "theme") renderThemePage();
}
function fit() {
  applyWindowAspect(stage, preferences.windowAspect, stylePalette(preferences.style, preferences.theme).bg);
  // Use the same stage dimensions and aspect boundary as the scene framing.
  stage.dataset.layout = viewportLayout(stage.clientWidth, stage.clientHeight, false).kind;
  scene?.resize();
  viewer?.resize();
  if (musicApplication.mode === "detail") {
    syncTabIndicator(false);
  }
}
window.addEventListener("resize", fit);
document.addEventListener("fullscreenchange", fit);

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new Error(data?.error || `本地服务请求失败 (${response.status})`);
  return data as T;
}
async function loadLibrary(force = false) {
  if (refreshing) return;
  refreshing = true;
  const stateVersion = libraryStateVersion;
  try {
    const next = await request<MusicLibrary>(
      shelf === "online" ? "/api/online/library" : "/api/library",
    );
    apiAvailable = true;
    if (stateVersion === libraryStateVersion) await receiveLibrary(next, force);
  } catch (error) {
    apiAvailable = false;
    updateStatus();
    updateIntroductionStatus();
    if (force)
      notify(
        ui`${(error as Error).message}。请使用 npm run music 启动本地音乐服务。`,
      );
  } finally {
    refreshing = false;
  }
  clearTimeout(pollTimer);
  pollTimer = setTimeout(
    () => void loadLibrary(),
    library.scan.running ||
      library.enrich?.running ||
      library.introductions?.running
      ? 1400
      : 12000,
  );
}
async function receiveLibrary(next: MusicLibrary, force = false) {
  const previousScan = library.scan;
  const scanCompleted = libraryReceived && !next.scan.running && !next.scan.error &&
    !!next.scan.finishedAt && next.scan.finishedAt !== previousScan.finishedAt;
  const scanFailed = libraryReceived && previousScan.running && !next.scan.running && !!next.scan.error;
  libraryReceived = true;
  const previousIntroductionRun = library.introductions;
  const changed =
    JSON.stringify(next.albums) !== JSON.stringify(library.albums) ||
    JSON.stringify(next.genres) !== JSON.stringify(library.genres);
  library = next;
  if (library.introductions?.running) introductionRequestError = "";
  if (changed || force) await applyLibrary();
  updateStatus();
  if (isLibrarySettings()) {
    updateScanStatus();
    if (!libraryDraftDirty && !scanSubmitting && !choosingLibraryFolder && !library.scan.running) {
      libraryDraftRoots = library.roots.map((entry) => entry.path);
      selectedLibraryRoot = Math.min(selectedLibraryRoot, libraryDraftRoots.length - 1);
      renderLibraryPaths();
    }
  }
  updateIntroductionStatus();
  if (
    previousIntroductionRun?.running &&
    library.introductions &&
    !library.introductions.running
  ) {
    const result = library.introductions;
    notify(
      result.error ||
        `专辑介绍查询完成：更新 ${result.updated} 张，未找到可靠资料 ${result.notFound} 张，查询失败 ${result.failed} 张。`,
    );
  }
  if (scanFailed) notify(ui`音乐库扫描失败：${next.scan.error}`);
  if (scanCompleted && !scanRefreshTimer) {
    notify(trUi("音乐库扫描完成，2 秒后自动刷新页面。"));
    scanRefreshTimer = setTimeout(() => location.reload(), 2000);
  }
}
async function applyLibrary() {
  flushArchiveVisual();
  const hadAlbums = albums.length > 0;
  const previousDetail = JSON.stringify(currentAlbum());
  const visualKey = (items: MusicAlbum[], groups: MusicGenre[]) =>
    JSON.stringify([
      items.map((a) => [a.id, a.title, a.artist, a.genreId, a.coverUrl]),
      groups.map((g) => [g.id, g.name]),
    ]);
  const oldVisual = visualKey(albums, genres);
  if (library.albums.length) demo = false;
  albums = orderMusicAlbums(demo ? demoAlbums : library.albums, preferences.sortMode);
  player.updateTrackMetadata(albums.flatMap(album=>album.tracks));
  genres = demo ? demoGenres : library.genres;
  setMusicAlbums(albums, genres, preferences.sortMode);
  scene?.refreshHiRes();
  musicApplication.reconcileAlbums(records.map(record => record.id),
    (albumId, trackId) => albums.some(album => album.id === albumId && album.tracks.some(track => track.id === trackId)));
  const focusedEntry = getMusicFocusedEntry(musicApplication.selectedIndex);
  if (focusedEntry) focusMusicEntry(focusedEntry.key);
  if (scene && ready && oldVisual !== visualKey(albums, genres)) {
    const reopen = presentation.openingOrDetail;
    cancelTrackReveal();
    libraryRebuilding = true;
    libraryIntent = undefined;
    presentation.reset();
    detailTransition.hide(true);
    browseTransition.hide(true);
    try { await scene.refreshLibrary(musicApplication.selectedIndex); }
    finally { libraryRebuilding = false; }
    const intent = libraryIntent as LibraryIntent | undefined;
    libraryIntent = undefined;
    scene.setMode("archive");
    if (intent && "index" in intent)
      select(intent.index, intent.navigation, intent.openAfter, intent.route, intent.entryKey);
    else if ((intent ? intent.mode === "detail" : reopen) && albums.length)
      presentation.open();
    else showBrowseSurface();
  }
  if (!albums.length) {
    cancelTrackReveal();
    presentation.reset();
  }
  stage.dataset.mode = musicApplication.mode;
  $("#music-empty").hidden = albums.length > 0;
  // Ordinary index refreshes must not reveal a page while its peer is exiting.
  if (!ready || !hadAlbums || !albums.length) {
    if (albums.length && musicApplication.mode === "archive") browseTransition.show(true);
    else browseTransition.hide(true);
    // Detail is revealed exclusively by the camera completion gate.
    if (presentation.phase !== "detail") detailTransition.hide(true);
    $("#music-browse").inert = !albums.length || musicApplication.mode !== "archive" || !!panel;
    $("#music-detail").inert = !albums.length || musicApplication.mode !== "detail" || !!panel;
    $("#music-browse").setAttribute(
      "aria-hidden",
      String(!albums.length || musicApplication.mode !== "archive"),
    );
    $("#music-detail").setAttribute(
      "aria-hidden",
      String(!albums.length || musicApplication.mode !== "detail"),
    );
  }
  updateSelection();
  if (musicApplication.mode === "detail" && previousDetail !== JSON.stringify(currentAlbum()))
    renderDetail();
  updateStatus();
}
function updateStatus() {
  updateShelfChrome();
  const n = library.albums.length,
    tracks = library.albums.reduce((sum, a) => sum + a.tracks.length, 0);
  const label = !apiAvailable
    ? trUi("本地音乐服务尚未连接")
    : library.scan.running
      ? trUi("正在扫描音乐库…")
      : library.enrich?.running
        ? ui`补充在线资料 ${library.enrich.completed}/${library.enrich.total}`
        : library.introductions?.running
          ? ui`查询专辑介绍 ${library.introductions.completed}/${library.introductions.total}`
          : demo
            ? trUi("演示专辑 · 加入音乐后显示真实封面")
            : "";
  $("#library-status span").textContent = label;
  $("#library-status").hidden = !label;
  $("#library-status").classList.toggle(
    "working",
    !!library.scan.running ||
      !!library.enrich?.running ||
      !!library.introductions?.running,
  );
  $("#library-count").textContent = demo
    ? "DEMONSTRATION"
    : `${n} ALBUMS / ${tracks} TRACKS`;
}
let selectedProfileMarkup = "";
function updateSelection(navigation?: ArchiveNavigation) {
  if (page === "settings") syncEntrySettings();
  const a = currentAlbum();
  $<HTMLButtonElement>(".browse-play-album").disabled = !a?.tracks.length || !!a.offline;
  if (!a) {
    albumPanel.setVisible(false);
    selectionInitialized = false;
    textMotion.finish();
    titleMotion.finish();
    return;
  }
  const foobar = preferences.style.design === "archive";
  const entry=getMusicFocusedEntry(musicApplication.selectedIndex);
  const track=entry?.track;
  const sourceAlbum=track?{...a,artist:track.artist||a.artist,tracks:[track]}:a;
  const formatLabel = demo ? "DEMO" : albumFormatSummary(sourceAlbum, foobar);
  $("#selection-format").hidden = !formatLabel;
  const shelves = getMusicCatalogShelves();
  const shelfLocation = getMusicRecordLocation(musicApplication.selectedIndex);
  const files = shelfLocation ? shelves[shelfLocation.shelf].entryKeys.flatMap(key => {
    const item = getMusicEntryByKey(key); return item ? [item.index] : [];
  }) : [];
  const idx = files.indexOf(entry?.index ?? -1);
  const animated = selectionInitialized && (selectionMotionEnabled() || (foobar && ready && page === "music" && !preferences.reduced));
  selectionInitialized = true;
  textMotion.update(
    {
      number: idx + 1,
      total: files.length,
      genresTotal: shelves.length,
      code: musicApplication.selectedIndex + 1,
      genreIndex: shelfLocation ? shelfLocation.shelf + 1 : 0,
      genre: shelfLocation ? shelves[shelfLocation.shelf].name : "NO MATCHES",
      genreName: shelfLocation ? shelves[shelfLocation.shelf].name : "NO MATCHES",
      format: formatLabel,
      artist: sourceAlbum.artist,
      meta: (track?[a.title,a.year?String(a.year):trUi("年份未提供"),time(track.duration)]:[
        a.year ? String(a.year) : trUi("年份未提供"),
        demo ? trUi("演示封面") : ui`${a.tracks.length} 首曲目`,
        a.tracks.length ? time(albumDuration(a)) : "",
      ])
        .filter(Boolean)
        .join("  /  "),
    },
    animated,
    navigation,
  );
  $("#selection-title").dataset.hiRes = String(isHiResAlbum(sourceAlbum));
  $("#selection-hi-res").hidden = !isHiResAlbum(sourceAlbum);
  $("#selection-title").dataset.dsd = String(isDsdAlbum(sourceAlbum));
  $("#selection-dsd").hidden = !isDsdAlbum(sourceAlbum);
  titleMotion.update(track?entry!.record.title:a.title, animated);
  $("#selection-title").title = track?entry!.record.title:a.title;
  const profile = $("#selection-profile");
  profile.hidden = false;
  const profileMarkup = `<div class="selection-profile-heading"><span>PROFILE</span><span>ARC-${String(musicApplication.selectedIndex + 1).padStart(4, "0")}</span></div><dl>${albumProfileFields(sourceAlbum).map(([label, value]) => `<div><dt>${esc(foobar ? label.split(" / ")[0] : label)}</dt><dd data-cjk="${containsCjk(value)}">${esc(value)}</dd></div>`).join("")}</dl>`;
  if (profileMarkup !== selectedProfileMarkup) {
    selectedProfileMarkup = profileMarkup;
    profile.innerHTML = profileMarkup;
  }
  tickMotion.update(
    files.map((index) => ({ index, id: getMusicEntry(index)?.key ?? String(index), title: getMusicEntry(index)?.record.title ?? "" })),
    entry?.index ?? -1,
    preferences.reduced,
    navigation,
  );
  foobarShell?.updateSelection(musicApplication.selectedIndex);
  syncMusicCatalogView();
  $("#detail-card-id").textContent =
    `ALBUM / ${String(musicApplication.selectedIndex + 1).padStart(3, "0")}`;
  $(".card-caption small").hidden = preferences.style.caseStyle !== "rhine";
  // prepareMenu builds the latest detail before it becomes visible.
  if (musicApplication.mode === "detail") renderDetail();
  albumPanel.setVisible(page === "music" && ready, !!panel);
  // Hidden archive content can prepare its static reels before the reveal.
  if (!animated) syncSelectionMotion();
}
function commitSelection(index: number, navigation?: ArchiveNavigation, keepDetail = false, entryKey?: string) {
  const deferVisual = !keepDetail && !!navigation && "axis" in navigation && ready && page === "music" &&
    !libraryRebuilding && !panel && !viewer?.isOpen && !futureEntry?.active &&
    musicApplication.mode === "archive" && presentation.phase === "archive" && !presentation.openingOrDetail &&
    scene?.musicDisplayLayout.effective === "shelf" && scene.musicArchiveInteractive;
  const previousAxis = pendingArchiveVisual?.navigation;
  if (!deferVisual || (previousAxis && "axis" in previousAxis && navigation && "axis" in navigation &&
    previousAxis.axis !== navigation.axis)) flushArchiveVisual();
  musicApplication.selectAlbum(wrap(index, records.length), records[wrap(index, records.length)]?.id);
  const requested = entryKey ? getMusicEntryByKey(entryKey) : undefined;
  if (requested?.recordIndex === musicApplication.selectedIndex) focusMusicEntry(requested.key);
  // Re-resolve visibility after SHOW/filter changes; stale requests use the current catalog fallback.
  const entry = getMusicFocusedEntry(musicApplication.selectedIndex);
  if (entry) focusMusicEntry(entry.key);
  if (deferVisual) {
    // Every input advances the authoritative cursor. Only the final target of
    // this display frame needs a scene snapshot and derived browse DOM.
    const previous = pendingArchiveVisual?.navigation;
    const combined = previous && navigation && "axis" in previous && "axis" in navigation && previous.axis === navigation.axis
      ? { axis: navigation.axis, direction: previous.direction + navigation.direction } : navigation;
    pendingArchiveVisual = { index: musicApplication.selectedIndex, entryKey: entry?.key, navigation: combined };
  } else {
    if (keepDetail) scene?.switchMusicAlbum(musicApplication.selectedIndex, navigation);
    else scene?.select(musicApplication.selectedIndex, navigation);
    updateSelection(navigation);
  }
  effects.play(
    navigation && "axis" in navigation && navigation.axis === "lane"
      ? "column"
      : "tick",
    navigation && "axis" in navigation && navigation.axis === "lane" ? navigation.direction * .45 : 0,
  );
}
function flushArchiveVisual() {
  const pending = pendingArchiveVisual;
  if (!pending) return;
  pendingArchiveVisual = undefined;
  if (pending.entryKey && getMusicEntryByKey(pending.entryKey)?.recordIndex === pending.index)
    focusMusicEntry(pending.entryKey);
  scene?.select(pending.index, pending.navigation);
  updateSelection(pending.navigation);
  textMotion.flushPending();
  titleMotion.flushPending();
}
function select(index: number, navigation?: ArchiveNavigation, openAfter = presentation.openingOrDetail, route?: AlbumSelection["route"], entryKey?: string) {
  if (!records.length || !ready || index < 0) return;
  if (route !== "archive") cancelTrackReveal();
  const pending = libraryRebuilding && libraryIntent && "index" in libraryIntent
    ? libraryIntent : presentation.pendingSelection;
  const previous = pending?.navigation;
  if (pending) {
    // Coalesced key presses still reach the matching physical loop cell.
    navigation = previous && navigation && "axis" in previous && "axis" in navigation && previous.axis === navigation.axis
      ? { axis: navigation.axis, direction: previous.direction + navigation.direction }
      : undefined;
  }
  const request = { index: wrap(index, records.length), navigation, route,
    entryKey: entryKey ?? getMusicFocusedEntry(wrap(index, records.length))?.key };
  if (libraryRebuilding) {
    libraryIntent = { ...request, openAfter };
    return;
  }
  presentation.select(request, openAfter);
}
/** Playback can reuse its open album; other targets take the archive route. */
function revealAlbum(albumId: string, trackId?: string, options: { reuseOpenAlbum?: boolean } = {}) {
  closePanel(() => {
    cancelTrackReveal();
    if (!ready) return;
    const index = records.findIndex((record) => record.id === albumId);
    const album = albums.find((item) => item.id === albumId);
    if (index < 0 || !album || (trackId && !album.tracks.some((track) => track.id === trackId))) {
      notify(trUi("这张专辑或歌曲已不在当前音乐库中，请刷新音乐库后重试。"));
      return;
    }
    if (options.reuseOpenAlbum && trackId && !libraryRebuilding &&
      currentAlbum()?.id === albumId && presentation.openingOrDetail &&
      !presentation.pendingSelection &&
      ["detail", "opening", "switching"].includes(presentation.phase)) {
      // Preserve the camera and current scroll position. If the album is still
      // entering, the usual detail gate below will wait before revealing it.
      setTab("tracks");
      pendingTrackReveal = { albumId, trackId };
      return;
    }
    if (trackId) pendingTrackReveal = { albumId, trackId };
    select(index, undefined, true, "archive");
  });
}
function navigationSelection() {
  if (libraryRebuilding && libraryIntent && "index" in libraryIntent) return libraryIntent.index;
  return presentation.pendingSelection?.index ?? musicApplication.selectedIndex;
}
function stepAlbum(direction: number) {
  if (!records.length) return;
  const next = navigateMusicEntry(navigationSelection(), "row", direction);
  if (!next) return;
  focusMusicEntry(next.key);
  select(next.recordIndex, { axis: "row", direction });
}
function stepGenre(direction: number) {
  const next = navigateMusicEntry(navigationSelection(), "lane", direction);
  if (!next) return;
  focusMusicEntry(next.key);
  select(next.recordIndex, { axis: "lane", direction });
}
function setMode(next: "archive" | "detail") {
  flushArchiveVisual();
  if (next === "archive") cancelTrackReveal();
  if (libraryRebuilding) { libraryIntent = { mode: next }; return; }
  if (next === "detail") {
    if (currentAlbum()) presentation.open();
  } else presentation.back();
}
function syncTabIndicator(animate = true) {
  const button = document.querySelector<HTMLElement>(`#tab-${musicApplication.activeTab}`);
  const indicator = document.querySelector<HTMLElement>(".music-tab-indicator");
  if (!button || !indicator) return;
  indicator.style.transition = animate && !preferences.reduced ? "" : "none";
  indicator.style.transform = `translateX(${button.offsetLeft}px) scaleX(${button.offsetWidth})`;
}
function setTab(tab: "tracks" | "about") {
  if (musicApplication.activeTab === tab) return;
  cancelTrackReveal();
  const previous = musicApplication.activeTab;
  musicApplication.activeTab = tab;
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  syncTabIndicator();
  const a = currentAlbum();
  if (!a) return;
  const content = $("#album-tab-content");
  detailContentKey = JSON.stringify([a, musicApplication.activeTab, demo]);
  content.innerHTML =
    tab === "tracks" ? trackList(a, a.discCount || 1) : albumAbout(a);
  content.setAttribute("aria-labelledby", `tab-${tab}`);
  albumPanel.contentChanged(a.id);
  albumPanel.scanTab(previous, tab);
  updatePlayingRows();
  updateOutputUI();
  effects.play("ui-tick");
}
function albumProfileFields(a: MusicAlbum): [string, string][] {
  const discs =
    a.discCount || Math.max(1, ...a.tracks.map((t) => t.discNumber || 1));
  const bits =
    a.tracks.length && a.tracks.every((t) => t.lossless === false)
      ? trUi("有损编码")
      : valueRange(
          a.tracks.map((t) => t.bitsPerSample),
          (n) => `${n} bit`,
        );
  const rate = valueRange(
    a.tracks.map((t) => t.sampleRate),
    (n) => `${Number((n / 1000).toFixed(1))} kHz`,
  );
  const bitrate = valueRange(
    a.tracks.map((t) => t.bitrate),
    (n) => `${Math.round(n / 1000)} kbps`,
  );
  return [
    [musicInterfaceLabels.profile.fields.release, String(a.year || trUi("未提供"))],
    [musicInterfaceLabels.profile.fields.artist, a.artist],
    [musicInterfaceLabels.profile.fields.genre, genreName(a.genreId)],
    [musicInterfaceLabels.profile.fields.volumes, demo ? "—" : ui`${discs} CD · ${a.tracks.length} 首`],
    [musicInterfaceLabels.profile.fields.format, formatList(a)],
    [musicInterfaceLabels.profile.fields.resolution, `${bits} / ${rate}`],
    [musicInterfaceLabels.profile.fields.bitrate, bitrate],
    [musicInterfaceLabels.profile.fields.duration, time(albumDuration(a))],
  ];
}
let detailContentKey = "";
function renderDetail() {
  const a = currentAlbum();
  if (!a) return;
  const key = JSON.stringify([a, musicApplication.activeTab, demo]);
  if (key === detailContentKey) return;
  detailContentKey = key;
  trackFocus.cancel();
  const article = $("#album-detail-content");
  const restorePanelFocus = article.contains(document.activeElement) && stage.dataset.operationFocus === "right";
  const sameAlbum = detailIdentity === a.id;
  const existing = document.querySelector<HTMLElement>("#album-tab-content");
  const scroll = sameAlbum ? existing?.scrollTop ?? 0 : 0;
  detailIdentity = a.id;
  const discs = a.discCount || Math.max(1, ...a.tracks.map(t => t.discNumber || 1));
  article.innerHTML = ui`${sonyTechMarkup}<div class="music-tabs" role="tablist" aria-label="专辑信息"><button role="tab" id="tab-tracks" data-cjk="${containsCjk(trUi("歌单"))}" data-tab="tracks" tabindex="${musicApplication.activeTab === "tracks" ? 0 : -1}" aria-selected="${musicApplication.activeTab === "tracks"}" aria-controls="album-tab-content"><span>01</span> 歌单</button><button role="tab" id="tab-about" data-cjk="${containsCjk(trUi("专辑介绍"))}" data-tab="about" tabindex="${musicApplication.activeTab === "about" ? 0 : -1}" aria-selected="${musicApplication.activeTab === "about"}" aria-controls="album-tab-content"><span>02</span> 专辑介绍</button><i class="music-tab-indicator" aria-hidden="true"></i></div>
    <div id="album-tab-content" role="tabpanel" aria-labelledby="tab-${musicApplication.activeTab}">${musicApplication.activeTab === "tracks" ? trackList(a, discs) : albumAbout(a)}</div>`;
  $("#album-tab-content").scrollTop = scroll;
  albumPanel.contentChanged(a.id);
  syncTabIndicator(false);
  if (restorePanelFocus) albumPanel.element.focus({ preventScroll: true });
  updatePlayingRows();
  updateSonyTechIndicators(document.querySelector("#sony-tech-indicators"), playerState, a.id);
}
function trackList(a: MusicAlbum, discs: number) {
  if (!a.tracks.length)
    return ui`<div class="empty-tracks"><strong>${demo ? trUi("这是一张封面演示卡片") : trUi("这个专辑还没有可播放曲目")}</strong><p>${demo ? trUi("用于检查封面原始比例与卡片材质。扫描本地音乐库后，这里会显示真实曲目。") : trUi("请检查音乐文件是否完整，并重新扫描音乐库。")}</p><button data-action="library-settings">打开音乐库设置 ↗</button></div>`;
  let disc = -1;
  return ui`<div class="track-list" aria-label="专辑歌曲列表">${a.tracks
    .map((t, index) => {
      const discNo = t.discNumber || 1;
      const head =
        discs > 1 && discNo !== disc
          ? `<div class="disc-heading">DISC ${String(discNo).padStart(2, "0")}</div>`
          : "";
      disc = discNo;
      return ui`${head}<button class="track-row" data-track="${esc(t.id)}" data-dsd="${isDsdTrack(t)}" ${a.offline ? "disabled" : ""} aria-label="播放 ${esc(t.title)}"><span class="track-number">${String(t.trackNumber || index + 1).padStart(2, "0")}</span><span class="track-name"><strong data-cjk="${containsCjk(t.title)}">${esc(t.title)}</strong><small data-cjk="${containsCjk(t.artist)}">${esc(t.artist)}</small></span><span class="track-format">${isHiResTrack(t) ? hiResBadgeMarkup("track") : ""}${isDsdTrack(t) ? dsdBadgeMarkup("track") : ""}<span class="track-format-name">${esc(t.format)}${!t.browserPlayable ? trUi('<i title="需要兼容的播放内核"> ↗</i>') : ""}</span></span><span class="track-duration">${time(t.duration)}</span></button>`;
    })
    .join("")}</div>${producerBlock(a)}`;
}
function albumAbout(a: MusicAlbum) {
  return `<section class="album-about"><small>ABOUT THIS ALBUM</small>
    ${a.description ? `<p style="white-space:pre-line" data-cjk="${containsCjk(a.description)}">${esc(a.description)}</p>${a.descriptionSource?.url ? ui`<a class="text-button" href="${esc(a.descriptionSource.url)}" target="_blank" rel="noopener">来源：${esc(a.descriptionSource.name)} ↗</a>${a.descriptionSource.license ? `<small class="introduction-license">${esc(a.descriptionSource.license)}</small>` : ""}` : a.descriptionSource ? `<small>${esc(a.descriptionSource.name)}</small>` : ""}` : shelf === "online" ? onlineNote(a) : trUi(`<h3>专辑介绍待补充</h3><p>从公开百科核对专辑与歌手后读取介绍，附上来源并保存在本机。无法确认对应专辑时保留空白。</p>`)}
    ${!demo && shelf === "local" && a.tracks.some(track => track.audioUrl.startsWith('/api/audio/')) ? ui`<button data-action="edit-album-info" class="text-button">编辑专辑信息 ↗</button><p class="introduction-feedback" data-introduction-feedback="${esc(a.id)}" role="status">${esc(introductionAlbumStatus(a))}</p>` : ""}
    <div class="source-note"><span>${shelf === "online" ? trUi("来源") : trUi("本地目录")}</span><code>${esc(a.folder)}</code></div><div class="genre-tags">${a.rawGenres.map((g) => `<span>${esc(g)}</span>`).join("")}</div></section>${producerBlock(a)}`;
}
function introductionAlbumStatus(a: MusicAlbum) {
  const lookup = a.introduction;
  if (lookup?.status === "error")
    return ui`介绍查询失败：${lookup.error || trUi("资料来源暂时无法访问，请稍后重试。")}${a.description ? trUi(" 已有介绍仍然保留。") : ""}`;
  if (lookup?.status === "uncertain")
    return ui`找到可能的同名专辑，尚无法可靠确认，暂未采用介绍。${a.description ? trUi(" 已保留原有介绍。") : ""}`;
  if (lookup?.status === "not-found")
    return a.description
      ? trUi("本次未找到可靠更新，已保留原有介绍。")
      : trUi("未找到可核实的专辑介绍，可以稍后重试。");
  if (a.description) return trUi("介绍已保存在本机，可离线阅读。");
  return trUi("尚未查询专辑介绍。");
}
function updateIntroductionStatus() {
  const job = library.introductions;
  const running = introductionsStarting || !!job?.running;
  const button = document.querySelector<HTMLButtonElement>(
    "#introduction-refresh",
  );
  if (button) {
    button.disabled = running || !apiAvailable || !library.albums.length;
    button.textContent = running
      ? trUi("正在查询专辑介绍…")
      : trUi("查询 / 更新专辑介绍 ↗");
  }
  for (const control of document.querySelectorAll<HTMLButtonElement>(
    '[data-action="introduction-album"]',
  ))
    control.disabled = running || !apiAvailable;
  for (const feedback of document.querySelectorAll<HTMLElement>(
    "[data-introduction-feedback]",
  )) {
    const album = albums.find(
      (a) => a.id === feedback.dataset.introductionFeedback,
    );
    if (album)
      feedback.textContent = running
        ? trUi("正在查询专辑介绍，已有资料仍可阅读。")
        : introductionAlbumStatus(album);
  }
  const progress = document.querySelector<HTMLProgressElement>(
    "#introduction-progress",
  );
  if (progress) {
    progress.hidden = !running;
    progress.max = Math.max(1, job?.total || 0);
    progress.value = job?.completed || 0;
    if (introductionsStarting && !job?.running)
      progress.removeAttribute("value");
  }
  const missing = library.albums.filter((album) => !album.description?.trim());
  const coverage = document.querySelector<HTMLElement>(
    "#introduction-coverage",
  );
  if (coverage)
    coverage.textContent = ui`已有介绍 ${library.albums.length - missing.length} / ${library.albums.length} 张 · 尚缺 ${missing.length} 张`;
  const status = document.querySelector<HTMLElement>("#introduction-status");
  if (status)
    status.textContent = !apiAvailable
      ? trUi("本地音乐服务尚未连接，连接后可查询介绍。")
      : introductionRequestError
        ? ui`无法开始查询：${introductionRequestError}`
        : !library.albums.length
          ? trUi("扫描本地音乐文件夹后，即可查询专辑介绍。")
          : introductionsStarting
            ? trUi("正在提交专辑介绍查询…")
            : job?.running
              ? ui`已处理 ${job.completed} / ${job.total} 张 · 更新 ${job.updated} 张${job.currentAlbum ? ui`\n正在查询：${job.currentAlbum}` : ""}`
              : job?.error
                ? ui`查询未完成：${job.error}`
                : job && job.total > 0
                  ? ui`上次查询：处理 ${job.completed} / ${job.total} 张 · 更新 ${job.updated} 张 · 未找到可靠资料 ${job.notFound} 张 · 查询失败 ${job.failed} 张`
                  : trUi("查询会核对专辑、歌手与年份；无法确认的结果不会覆盖已有介绍。");
  const details = document.querySelector<HTMLDetailsElement>(
    "#introduction-missing",
  );
  if (details) {
    details.hidden = !missing.length;
    details.querySelector("summary")!.textContent =
      ui`查看尚缺介绍的 ${missing.length} 张专辑`;
    details.querySelector("ul")!.innerHTML = missing
      .map(
        (album) =>
          `<li><strong>${esc(album.title)}</strong><span>${esc(album.artist)} · ${esc(introductionAlbumStatus(album))}</span></li>`,
      )
      .join("");
  }
}
function producerBlock(a: MusicAlbum) {
  return ui`<section class="producer-section"><div><small>ALBUM CREDITS / 制作人员</small>${!demo && shelf === "local" ? trUi('<button data-action="enrich-album">补充在线资料 ↗</button>') : ""}</div>${a.producers.length ? `<dl>${a.producers.map((p) => `<div><dt>${esc(p.role)}${p.trackTitle ? ` · ${esc(p.trackTitle)}` : ""}</dt><dd>${esc(p.name)}</dd></div>`).join("")}</dl>` : trUi("<p>暂无制作资料。本地标签优先，MusicBrainz 资料可查询并缓存在本机。</p>")}${a.online?.status === "uncertain" ? trUi("<p>找到多个可能的发行版本，暂未自动采用资料。</p>") : ""}${a.online?.error ? `<p>${esc(a.online.error)}</p>` : ""}</section>`;
}
function updatePlayingRows() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-track]")
    .forEach((row) => {
      const active = row.dataset.track === playerState?.currentTrack?.id;
      row.classList.toggle("playing", active);
      row.setAttribute("aria-current", String(active));
    });
}
let lastPlayerError = "";
const transportTitleMotion = setupTransportTitle(
  $<HTMLButtonElement>("#transport-track"),
  $("#transport-track-label"),
);
transportTitleMotion.setReduced(preferences.reduced);
let ftpMetadataTrack = "";
let nativeBookmark = "";
const playbackControls = setupMusicPlayback($("#music-playback"), {
  seek: position => player.seek(position),
  cover: track => track.coverUrl || library.albums.find(album => album.id === track.albumId)?.coverUrl,
  order: value => setFoobarOrder(value),
  currentLyric: () => lyricsPage.currentLine(),
  volume: volume => {
    player.setVolume(volume);preferences.volume=player.state.volume;savePrefs();updateOutputUI();
  },
});
stage.addEventListener("lyrics-content-changed", () => playbackControls.refreshLyric());
foobarShell = setupFoobarShell(stage, {
  search: query => {
    applyMusicView({}, query);
  },
});
catalogGrid = setupMusicCatalogGrid(stage, stage.querySelector<HTMLElement>(".foobar-grid-host")!);
syncDesignIdentity();
let audioSettingsHighlight: ReturnType<typeof setTimeout> | undefined;
const audioInfoPopup = setupAudioInfoPopup(stage, {
  refresh: () => { void refreshNativeStatus(); },
  navigate: function navigate(category, target) {
    if (pageScan.change(() => navigate(category, target), preferences.reduced)) return;
    if (target === "#tone-settings" || target === "#audio-settings-tone") {
      if (panel) return closePanel(() => navigate(category, target));
      openEqPage();
      const tone = $("#tone-settings");
      tone.scrollIntoView({ block: "start", behavior: preferences.reduced ? "instant" : "smooth" });
      tone.querySelector<HTMLInputElement>('[data-processing-field="tone.enabled"]')?.focus({ preventScroll: true });
      return;
    }
    if (target === "#music-eq-page" || target === "#audio-settings-eq" || target === "#equalizer-settings") { openEqPage(); return; }
    openSettingsPage();
    selectSettingsCategory(category);
    const originalField = document.querySelector<HTMLElement>(target);
    if (!originalField) return;
    const field = originalField instanceof HTMLSelectElement && originalField.nextElementSibling?.matches(".settings-select-trigger")
      ? originalField.nextElementSibling as HTMLElement : originalField;
    const audioSection = field.closest<HTMLElement>("[data-audio-settings-section]");
    if (audioSection) markAudioSettingsSection(audioSection.dataset.audioSettingsSection as AudioSettingsSection);
    scrollSettingsTo(field);
    if (field.matches("input, select, button")) field.focus({ preventScroll: true });
    document.querySelectorAll(".audio-settings-target").forEach(node => node.classList.remove("audio-settings-target"));
    field.classList.add("audio-settings-target");
    clearTimeout(audioSettingsHighlight);
    audioSettingsHighlight = setTimeout(() => field.classList.remove("audio-settings-target"), 1800);
  },
});
let playingAlbumCover: { album: MusicAlbum; cover: string; view: MusicAlbum } | undefined;
function currentLyricsAlbum(state: MusicPlayerState) {
  const id = state.currentTrack?.albumId;
  const album = library.albums.find(album => album.id === id) ?? onlineSnapshot?.albums.find(album => album.id === id) ?? albums.find(album => album.id === id);
  const cover = state.currentTrack?.coverUrl;
  if (!album || !cover || cover === album.coverUrl) return album;
  if (playingAlbumCover?.album !== album || playingAlbumCover.cover !== cover) playingAlbumCover = { album, cover, view: { ...album, coverUrl: cover } };
  return playingAlbumCover.view;
}
const albumQueue = setupAlbumQueue(stage, {
  albumFor: id => library.albums.find(album => album.id === id) ?? onlineSnapshot?.albums.find(album => album.id === id) ?? albums.find(album => album.id === id),
  play: (id, tracks) => { void player.play(id, tracks); },
  closeOther: () => audioInfoPopup.close(false),
});
player.subscribe((state) => {
  playerState = state;
  syncInterfaceAudio();
  albumQueue.update(state);
  lyricsPage.update(state, currentLyricsAlbum(state));
  signalPage.update(state, currentLyricsAlbum(state));
  if (page === "lyrics") settingsSelectControls?.sync();
  const stateProcessing = (state.outputSettings as OutputWithProcessing).processing;
  if (stateProcessing && !processingEditStart && !processingApplyPending && !sameProcessing(processingSettings, stateProcessing)) {
    processingSettings = normalizeProcessing(stateProcessing, { clamp: true });
    (preferences.output as OutputWithProcessing).processing = processingSettings;
    processingPresetStore.eqBanks[processingSettings.eq.mode] = cloneEq(processingSettings.eq);
    savePrefs();
    saveProcessingPresetStore();
    updateProcessingControlValues();
  }
  audioInfoPopup.update(state, nativeStatus);
  updateProcessingSupportStatus();
  eqControls?.sync();
  updateCurrentAudioSummary();
  playbackControls.update(state);
  foobarShell?.updatePlayer(state);
  const bookmark=state.nativeSessionId?`${state.nativeSessionId}:${state.queue.map(track=>track.id).join(',')}`:'';
  if(bookmark&&bookmark!==nativeBookmark){
    nativeBookmark=bookmark;
    try{sessionStorage.setItem('rhine-native-queue',JSON.stringify({session:state.nativeSessionId,queue:state.queue.map(track=>track.id)}))}catch{}
  }
  const titleVisible = !!state.currentTrack &&
    (state.transport === "playing" || state.transport === "paused" || state.transport === "loading");
  transportTitleMotion.update(state.currentTrack?.title ?? "", titleVisible);
  editableRanges?.sync();
  $("#playback-toggle").title = state.currentTrack
    ? `${state.playing ? trUi("暂停") : trUi("播放")}：${state.currentTrack.title}`
    : trUi("播放当前专辑");
  if (state.error && state.error !== lastPlayerError) notify(state.error);
  lastPlayerError = state.error || "";
  updatePlayingRows();
  updateSonyUI();
  if(state.currentTrack?.id.startsWith('ftp-')&&!state.loading&&!state.error&&state.currentTrack.id!==ftpMetadataTrack){
    ftpMetadataTrack=state.currentTrack.id;void loadLibrary();
  }
});

function selectSettingsCategory(next: SettingsCategory, focus = false) {
  if (!settingsCategories.some((category) => category.id === next)) return;
  settingsSelectControls?.close();
  const content = $("#settings-page-content");
  if (next !== settingsCategory) settingsScrollPositions.set(settingsCategory, content.scrollTop);
  const changed = next !== settingsCategory;
  if (changed && focus) effects.play("ui-tick");
  settingsCategory = next;
  document.querySelectorAll<HTMLElement>("[data-settings-category]").forEach((node) => {
    node.hidden = node.dataset.settingsCategory !== next;
  });
  document.querySelectorAll<HTMLElement>("[data-settings-category-target]").forEach((node) => {
    if (node.dataset.settingsCategoryTarget === next) node.setAttribute("aria-current", "page");
    else node.removeAttribute("aria-current");
  });
  const audioButton = $('[data-settings-category-target="audio"]');
  audioButton.setAttribute("aria-expanded", String(next === "audio"));
  $("#audio-settings-subnav").hidden = next !== "audio";
  if (changed) content.scrollTop = settingsScrollPositions.get(next) ?? 0;
  syncAudioSettingsLocation();
  if (next === "interface") syncEntrySettings();
  if (next === "appearance") mountDisplaySettings();
  if (next === "lyrics") void lyricsSettings?.refresh();
  if (next === "library") {
    const body = $("#library-page-body");
    if (!body.childElementCount) {
      libraryDraftRoots = library.roots.map(entry => entry.path);
      libraryDraftDirty = false;
      selectedLibraryRoot = libraryDraftRoots.length ? 0 : -1;
      renderLibraryPage();
    } else {
      if (!libraryDraftDirty && !choosingLibraryFolder && !scanSubmitting && !library.scan.running) {
        libraryDraftRoots = library.roots.map(entry => entry.path);
        selectedLibraryRoot = Math.min(selectedLibraryRoot, libraryDraftRoots.length - 1);
      }
      renderLibraryPaths();
      updateScanStatus();
    }
  }
  enhanceFutureSettings($("#music-settings"));
  if (focus) $(`#settings-category-${next}`).focus({ preventScroll: true });
}
function markAudioSettingsSection(next: AudioSettingsSection) {
  if (!audioSettingsSections.some(section => section.id === next)) return;
  audioSettingsSection = next;
  document.querySelectorAll<HTMLElement>("[data-audio-settings-target]").forEach(node => {
    if (node.dataset.audioSettingsTarget === next) node.setAttribute("aria-current", "location");
    else node.removeAttribute("aria-current");
  });
}
function scrollSettingsTo(field: HTMLElement) {
  const content = $("#settings-page-content");
  const box = field.getBoundingClientRect();
  content.scrollTo({ top: content.scrollTop + box.top - content.getBoundingClientRect().top - 12, behavior: preferences.reduced ? "instant" : "smooth" });
}
function jumpToAudioSettingsSection(next: AudioSettingsSection) {
  if (!audioSettingsSections.some(section => section.id === next)) return;
  selectSettingsCategory("audio");
  const section = $(`#audio-settings-${next}`);
  markAudioSettingsSection(next);
  scrollSettingsTo(section);
  section.querySelector<HTMLElement>(".audio-settings-section-heading")?.focus({ preventScroll: true });
}
function syncAudioSettingsLocation() {
  if (page !== "settings" || settingsCategory !== "audio") return;
  const content = $("#settings-page-content");
  const threshold = content.getBoundingClientRect().top + 56;
  let active: AudioSettingsSection = "source";
  for (const section of audioSettingsSections) {
    const node = document.getElementById(`audio-settings-${section.id}`);
    if (node && node.getBoundingClientRect().top <= threshold) active = section.id;
  }
  if (content.scrollHeight > content.clientHeight && content.scrollTop + content.clientHeight >= content.scrollHeight - 2) active = audioSettingsSections.at(-1)!.id;
  markAudioSettingsSection(active);
}
let settingsScrollFrame = 0;
$("#settings-page-content").addEventListener("scroll", () => {
  if (settingsScrollFrame || page !== "settings") return;
  settingsScrollFrame = requestAnimationFrame(() => {
    settingsScrollFrame = 0;
    if (page !== "settings") return;
    settingsScrollPositions.set(settingsCategory, $("#settings-page-content").scrollTop);
    syncAudioSettingsLocation();
  });
}, { passive: true });
function syncArchiveTab() {
  $(".music-topnav [data-action=library]").setAttribute("aria-pressed", String(page === "music"));
}
function closeManagementPage(restoreFocus = true) {
  cleanupAlbumInfoSources?.();
  cleanupAlbumInfoSources = undefined;
  albumQueue.close(false);
  if (page === "music") {
    musicApplication.infoScrollTop = albumPanel.scrollTarget()?.scrollTop ?? 0;
    catalogGrid?.rememberPosition();
    return;
  }
  if (restoreFocus && pageScan.change(() => closeManagementPage(restoreFocus), preferences.reduced)) return;
  if (restoreFocus) effects.play("page-close");
  if (page === "theme") themePageScrollTop = $("#theme-page-content").scrollTop;
  cleanupStylePreview?.();
  cleanupStylePreview = undefined;
  cleanupQualityDetection?.();
  cleanupQualityDetection = undefined;
  cleanupGpuSettings?.();
  cleanupGpuSettings = undefined;
  caseEditor?.destroy();
  caseEditor = undefined;
  settingsSelectControls?.close();
  finishProcessingEdit();
  settingsSelectControls?.destroy();
  settingsSelectControls = undefined;
  void eqControls?.destroy().catch((error: Error) => notify(error.message));
  eqControls = undefined;
  standardEqPresets?.destroy();
  standardEqPresets = undefined;
  lyricsSettings?.destroy();
  lyricsSettings = undefined;
  lyricsPage.setVisible(false);
  signalPage.setVisible(false);
  if (page === "settings") settingsScrollPositions.set(settingsCategory, $("#settings-page-content").scrollTop);
  if (page === "eq") {
    eqPageScrollTop = $("#eq-page-content").scrollTop;
    eqPresetsExpanded = $("#eq-page-content").querySelector<HTMLDetailsElement>(".eq-preset-disclosure")?.open ?? false;
  }
  page = "music";
  stage.dataset.page = page;
  syncArchiveTab();
  $("#music-settings").hidden = true;
  $("#music-settings").inert = true;
  $("#music-eq-page").hidden = true;
  $("#music-eq-page").inert = true;
  $("#music-lyrics-page").hidden = true;
  $("#music-lyrics-page").inert = true;
  $("#music-signal-page").hidden = true;
  $("#music-signal-page").inert = true;
  $("#music-theme-page").hidden = true;
  $("#music-theme-page").inert = true;
  $("#music-browse").inert = presentation.phase !== "archive";
  $("#music-detail").inert = presentation.phase !== "detail";
  $("#music-empty").inert = false;
  $("#three-scene").inert = false;
  $("[data-action=settings]").setAttribute("aria-pressed", "false");
  $(".music-topnav [data-action=library]").setAttribute("aria-pressed", "true");
  $(".music-topnav [data-action=eq]").setAttribute("aria-pressed", "false");
  $(".music-topnav [data-action=lyrics]").setAttribute("aria-pressed", "false");
  $(".music-topnav [data-action=signal]").setAttribute("aria-pressed", "false");
  $(".music-topnav [data-action=theme]").setAttribute("aria-pressed", "false");
  albumPanel.setVisible(ready && !!albums.length, false);
  const infoScroll = albumPanel.scrollTarget();
  if (infoScroll) infoScroll.scrollTop = musicApplication.infoScrollTop;
  catalogGrid?.restorePosition();
  syncSelectionMotion();
  if (restoreFocus) pageScan.reveal(preferences.reduced);
  if (restoreFocus) pageFocus?.focus({ preventScroll: true });
}
function openSettingsPage() {
  flushArchiveVisual();
  audioInfoPopup.close(false);
  if (page === "settings") { pageScan.cancelPending(); return; }
  if (panel) return closePanel(() => openSettingsPage());
  if (pageScan.change(openSettingsPage, preferences.reduced)) return;
  closeManagementPage(false);
  cancelTrackReveal();
  pageFocus = document.activeElement as HTMLElement;
  page = "settings";
  stage.dataset.page = page;
  syncArchiveTab();
  $("#music-settings").hidden = false;
  $("#music-settings").inert = false;
  for (const node of [$("#music-browse"), $("#music-detail"), $("#music-empty"), $("#three-scene")]) node.inert = true;
  $("[data-action=settings]").setAttribute("aria-pressed", "true");
  renderSettingsPage();
  syncSelectionMotion();
  effects.play("page-open");
  $("#settings-page-title").focus({ preventScroll: true });
  pageScan.reveal(preferences.reduced);
}

function isLibrarySettings() {
  return page === "settings" && settingsCategory === "library";
}
function openLibrarySettings() {
  if (panel) return closePanel(() => openLibrarySettings());
  if (pageScan.change(openLibrarySettings, preferences.reduced)) return;
  openSettingsPage();
  selectSettingsCategory("library", true);
}
function openArchivePage() {
  flushArchiveVisual();
  if (panel) return closePanel(() => openArchivePage());
  const returningToMusic = page !== "music";
  if (page === "music") pageScan.cancelPending();
  if (page !== "music" && pageScan.change(openArchivePage, preferences.reduced)) return;
  audioInfoPopup.close(false);
  closeManagementPage(false);
  // The navigation tab returns to the saved music context from peer pages.
  // An explicit home action within the music page still returns to the shelf.
  if (!returningToMusic) setMode("archive");
  $(".music-topnav [data-action=library]").setAttribute("aria-pressed", "true");
  if (musicApplication.mode === "archive" && presentation.phase === "archive") showBrowseSurface();
}
function openEqPage() {
  flushArchiveVisual();
  audioInfoPopup.close(false);
  if (page === "eq") { pageScan.cancelPending(); return; }
  if (panel) return closePanel(() => openEqPage());
  if (pageScan.change(openEqPage, preferences.reduced)) return;
  closeManagementPage(false);
  cancelTrackReveal();
  pageFocus = $(".music-topnav [data-action=eq]");
  page = "eq";
  stage.dataset.page = page;
  syncArchiveTab();
  $("#music-eq-page").hidden = false;
  $("#music-eq-page").inert = false;
  for (const node of [$("#music-browse"), $("#music-detail"), $("#music-empty"), $("#three-scene")]) node.inert = true;
  $(".music-topnav [data-action=eq]").setAttribute("aria-pressed", "true");
  renderEqPage();
  syncSelectionMotion();
  effects.play("page-open");
  $("#eq-page-title").focus({ preventScroll: true });
  pageScan.reveal(preferences.reduced);
}

function openLyricsPage() {
  flushArchiveVisual();
  audioInfoPopup.close(false);
  if (page === "lyrics") { pageScan.cancelPending(); return; }
  if (panel) return closePanel(() => openLyricsPage());
  if (pageScan.change(openLyricsPage, preferences.reduced)) return;
  closeManagementPage(false);
  cancelTrackReveal();
  pageFocus = $(".music-topnav [data-action=lyrics]");
  page = "lyrics";
  stage.dataset.page = page;
  syncArchiveTab();
  $("#music-lyrics-page").hidden = false;
  $("#music-lyrics-page").inert = false;
  for (const node of [$("#music-browse"), $("#music-detail"), $("#music-empty"), $("#three-scene")]) node.inert = true;
  $(".music-topnav [data-action=lyrics]").setAttribute("aria-pressed", "true");
  lyricsPage.update(player.state, currentLyricsAlbum(player.state));
  lyricsPage.setVisible(true);
  settingsSelectControls = enhanceSettingsSelectControls($("#lyrics-page-content"));
  syncSelectionMotion();
  effects.play("page-open");
  $("#lyrics-page-title").focus({ preventScroll: true });
  pageScan.reveal(preferences.reduced);
}

function openSignalPage() {
  flushArchiveVisual();
  audioInfoPopup.close(false);
  if (page === "signal") { pageScan.cancelPending(); return; }
  if (panel) return closePanel(() => openSignalPage());
  if (pageScan.change(openSignalPage, preferences.reduced)) return;
  closeManagementPage(false);
  cancelTrackReveal();
  pageFocus = $(".music-topnav [data-action=signal]");
  page = "signal";
  stage.dataset.page = page;
  syncArchiveTab();
  $("#music-signal-page").hidden = false;
  $("#music-signal-page").inert = false;
  for (const node of [$("#music-browse"), $("#music-detail"), $("#music-empty"), $("#three-scene")]) node.inert = true;
  $(".music-topnav [data-action=signal]").setAttribute("aria-pressed", "true");
  signalPage.update(player.state, currentLyricsAlbum(player.state));
  signalPage.setVisible(true);
  syncSelectionMotion();
  effects.play("page-open");
  $("#signal-page-title").focus({ preventScroll: true });
  pageScan.reveal(preferences.reduced);
}

function openLyricsSettings() {
  if (pageScan.change(openLyricsSettings, preferences.reduced)) return;
  openSettingsPage();
  selectSettingsCategory("lyrics", true);
}

function openThemePage() {
  flushArchiveVisual();
  audioInfoPopup.close(false);
  if (page === "theme") { pageScan.cancelPending(); return; }
  if (panel) return closePanel(() => openThemePage());
  if (pageScan.change(openThemePage, preferences.reduced)) return;
  closeManagementPage(false);
  cancelTrackReveal();
  pageFocus = $(".music-topnav [data-action=theme]");
  page = "theme";
  stage.dataset.page = page;
  syncArchiveTab();
  $("#music-theme-page").hidden = false;
  $("#music-theme-page").inert = false;
  for (const node of [$("#music-browse"), $("#music-detail"), $("#music-empty"), $("#three-scene")]) node.inert = true;
  $(".music-topnav [data-action=theme]").setAttribute("aria-pressed", "true");
  renderThemePage();
  syncSelectionMotion();
  effects.play("page-open");
  $("#theme-page-title").focus({ preventScroll: true });
  pageScan.reveal(preferences.reduced);
}

function renderThemePage() {
  const content = $("#theme-page-content");
  const scroll = page === "theme" && content.children.length ? content.scrollTop : themePageScrollTop;
  const focused = document.activeElement as HTMLElement | null;
  const focusField = focused?.dataset.styleField;
  const focusScheme = focused?.dataset.styleScheme;
  const focusDesign = focused?.dataset.styleDesign;
  const focusTheme = focused && content.contains(focused) ? focused.dataset.theme : undefined;
  const focusFollowing = focused && content.contains(focused) && focused.hasAttribute("data-follow-system-theme");
  settingsSelectControls?.destroy();
  cleanupStylePreview?.();
  caseEditor?.destroy();
  caseEditor = undefined;
  content.innerHTML = musicStyleMarkup(preferences.style, preferences.theme, preferences.followSystemTheme);
  const editorHost = document.createElement("section");
  editorHost.id = "theme-case-editor";
  content.querySelector("#theme-quality-slot")?.before(editorHost);
  const userPresetKey = preferences.style.design === "rhine" ? "futurePunkPresets" : "archivePunkPresets";
  caseEditor = setupCaseEditor(editorHost, {
    getSettings: () => caseProfiles[preferences.style.design], getQuality: () => renderQuality,
    getTheme: () => preferences.theme === "night" ? "night" : "day", getDesign: () => preferences.style.design,
    getCover: () => ({ url: albums[musicApplication.selectedIndex]?.coverUrl, title: albums[musicApplication.selectedIndex]?.title }),
    getAlbumInfo: () => ({ record: records[musicApplication.selectedIndex], index: records[musicApplication.selectedIndex] ? musicApplication.selectedIndex : undefined, reduced: preferences.reduced }),
    getUserPresets: () => preferences[userPresetKey],
    onUserPresetsChange: (next: CaseUserPreset[]) => {
      const previous = preferences[userPresetKey];
      preferences[userPresetKey] = normalizeCaseUserPresets(next);
      try {
        const text = JSON.stringify(preferences);
        if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024)
          throw new Error(trUi("本地设置空间不足，预设未保存。"));
        localStorage.setItem("rhine-music-preferences", text);
        window.rhineDesktop?.savePreferences(preferences);
      } catch (error) {
        preferences[userPresetKey] = previous;
        throw error;
      }
    },
    onChange: next => {
      caseProfiles[preferences.style.design] = normalizeCaseSettings(next, preferences.style.design);
      lyricsPage.refreshCasePreview();
      void scene?.setCaseSettings(caseProfiles[preferences.style.design]).catch(error => notify((error as Error).message));
      settingsSelectControls?.sync();
      terminalLighting.refresh();
      savePrefs();
    },
  });
  settingsSelectControls = enhanceSettingsSelectControls(content);
  cleanupStylePreview = setupStylePreview(content, preferences.style, preferences.theme);
  editableRanges?.sync();
  content.scrollTop = scroll;
  syncFullscreenUI();
  const restored = focusField ? content.querySelector<HTMLElement>(`[data-style-field="${focusField}"]`) : focusScheme ? content.querySelector<HTMLElement>(`[data-style-scheme="${focusScheme}"]`) : focusDesign ? content.querySelector<HTMLElement>(`[data-style-design="${focusDesign}"]`) : focusFollowing ? content.querySelector<HTMLElement>("[data-follow-system-theme]") : focusTheme ? content.querySelector<HTMLElement>(`button[data-theme="${focusTheme}"]`) : null;
  restored?.focus({ preventScroll: true });
}

function mountDisplaySettings() {
  if (cleanupQualityDetection || page !== "settings" || settingsCategory !== "appearance") return;
  const host = document.querySelector<HTMLElement>("#graphics-display-settings");
  if (!host) return;
  const gpuBridge = window.rhineDesktop;
  cleanupGpuSettings = mountGpuSettings(host.querySelector<HTMLElement>("[data-gpu-settings]")!, gpuBridge?.gpuInfo && gpuBridge.selectGpu ? { gpuInfo: gpuBridge.gpuInfo, selectGpu: gpuBridge.selectGpu } : undefined);
  cleanupQualityDetection = mountQualityDetection(host.querySelector<HTMLElement>(".quality-settings")!, {
    getStyle: () => preferences.style,
    getTheme: () => preferences.theme === "night" ? "night" : "day",
    getCaseSettings: () => caseProfiles[preferences.style.design],
    getSize: () => { const rect = stage.getBoundingClientRect(); return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) }; },
    apply: quality => { renderQuality = normalizeQuality({ ...quality, wave: renderQuality.wave }); updateQuality(); },
  });
  syncFullscreenUI();
}

let panelFocus: HTMLElement | null = null;
let panelTransition: SurfaceTransition | undefined,
  panelClosing = false,
  pendingPanelAfter: (() => void) | undefined;
function closePanel(after?: () => void) {
  if (!panel) {
    after?.();
    return;
  }
  pendingPanelAfter = after;
  if (panelClosing) return;
  panelClosing = true;
  effects.play("page-close");
  panelSelectControls?.close();
  panelTransition?.hide(preferences.reduced, () => {
    panel = null;
    panelClosing = false;
    panelTransition?.dispose();
    panelTransition = undefined;
    panelSelectControls?.destroy();
    panelSelectControls = undefined;
    $("#music-panel-root").innerHTML = "";
    for (const node of [
      $("#music-browse"),
      $("#music-detail"),
      albumPanel.element,
      $(".music-header"),
      $("#music-playback"),
      $("#three-scene"),
    ])
      node.inert = false;
    foobarShell?.setModalOpen(false);
    $("#music-browse").inert = presentation.phase !== "archive";
    $("#music-detail").inert = presentation.phase !== "detail";
    panelFocus?.focus({ preventScroll: true });
    const next = pendingPanelAfter;
    pendingPanelAfter = undefined;
    next?.();
  });
}
function openPanel(next: Panel) {
  albumQueue.close(false);
  audioInfoPopup.close(false);
  if (!next) return closePanel();
  closeManagementPage(false);
  cancelTrackReveal();
  panelTransition?.dispose();
  panelSelectControls?.destroy();
  panelSelectControls = undefined;
  pendingPanelAfter = undefined;
  panelClosing = false;
  if (!panel) panelFocus = document.activeElement as HTMLElement;
  panel = next;
  const titles = {
    search: ["FIND MUSIC", trUi("搜索专辑与歌曲")],
    online: ["ONLINE LIBRARY", trUi("在线曲库")],
  };
  $("#music-panel-root").innerHTML =
    ui`<div class="music-panel-scrim" data-action="dismiss-panel"><section class="music-panel" data-panel="${next}" role="dialog" aria-modal="true" aria-labelledby="music-panel-title"><div class="panel-heading"><div><small>${titles[next][0]}</small><h2 id="music-panel-title">${titles[next][1]}</h2></div><button type="button" data-action="close-panel" aria-label="关闭">${svg('<path d="m6 6 12 12M18 6 6 18"/>')}</button></div><div id="panel-body"></div></section></div>`;
  for (const node of [
    $("#music-browse"),
    $("#music-detail"),
    albumPanel.element,
    $(".music-header"),
    $("#music-playback"),
    $("#three-scene"),
  ])
    node.inert = true;
  foobarShell?.setModalOpen(true);
  const scrim = $(".music-panel-scrim");
  scrim.hidden = true;
  panelTransition = new SurfaceTransition(scrim, $(".music-panel"));
  panelTransition.show(preferences.reduced);
  effects.play("page-open");
  if (next === "search") renderSearchPanel();
  if (next === "online") void renderOnlinePanel();
  (
    document.querySelector<HTMLElement>("#album-search") ||
    $("#music-panel-root button")
  )?.focus({ preventScroll: true });
}
const libraryPathKey = (value: string) => value.replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
function renderLibraryPaths() {
  const list = document.querySelector("#library-path-list");
  if (!list) return;
  const busy = choosingLibraryFolder || scanSubmitting || library.scan.running;
  const selected = selectedLibraryRoot >= 0 && selectedLibraryRoot < libraryDraftRoots.length;
  list.innerHTML = libraryDraftRoots.length ? libraryDraftRoots.map((root, index) => {
    const status = library.roots.find((entry) => libraryPathKey(entry.path) === libraryPathKey(root))?.status;
    return `<button class="library-path-row" data-action="library-select-root" data-root-index="${index}" role="option" aria-selected="${index === selectedLibraryRoot}" tabindex="${index === selectedLibraryRoot ? 0 : -1}"><small>${String(index + 1).padStart(2, "0")}</small><span title="${esc(root)}">${esc(root)}</span><em>${status === "offline" ? trUi("离线") : status === "online" ? trUi("已索引") : trUi("待扫描")}</em></button>`;
  }).join("") : trUi('<p class="library-path-empty">尚未添加音乐文件夹。点击右侧“添加文件夹”。</p>');
  $("#library-path-count").textContent = ui`${libraryDraftRoots.length} 个目录`;
  $("#library-path-draft").textContent = choosingLibraryFolder ? trUi("正在选择文件夹…") : libraryDraftDirty ? trUi("目录已调整，尚未保存。") : trUi("目录调整后点击“保存并扫描”。");
  document.querySelectorAll<HTMLButtonElement>("#library-path-actions button").forEach((button) => {
    const action = button.dataset.action;
    button.disabled = busy || (action === "library-add-folder" ? !window.rhineDesktop?.chooseMusicFolders : !selected);
    if (action === "library-root-up") button.disabled ||= selectedLibraryRoot <= 0;
    if (action === "library-root-down") button.disabled ||= selectedLibraryRoot >= libraryDraftRoots.length - 1;
  });
  document.querySelectorAll<HTMLButtonElement>('#library-page-body [data-action="scan"], #library-page-body [data-action="rescan"]').forEach((button) => { button.disabled = busy; });
}
async function chooseLibraryRoots(replace = false) {
  if (choosingLibraryFolder || scanSubmitting || library.scan.running) return;
  const choose = window.rhineDesktop?.chooseMusicFolders;
  if (!choose) { notify(trUi("请使用桌面应用选择音乐文件夹。")); return; }
  if (replace && selectedLibraryRoot < 0) return;
  choosingLibraryFolder = true;
  renderLibraryPaths();
  try {
    const roots = await choose({ multiple: !replace, language: uiLanguage() });
    if (!isLibrarySettings() || !roots.length) return;
    if (replace) {
      const duplicate = libraryDraftRoots.findIndex((root, index) => index !== selectedLibraryRoot && libraryPathKey(root) === libraryPathKey(roots[0]));
      if (duplicate >= 0) { selectedLibraryRoot = duplicate; notify(trUi("该目录已经在列表中。")); return; }
      libraryDraftRoots[selectedLibraryRoot] = roots[0];
      libraryDraftDirty = true;
    } else {
      let added = 0;
      for (const root of roots) {
        if (libraryDraftRoots.some((existing) => libraryPathKey(existing) === libraryPathKey(root))) continue;
        libraryDraftRoots.push(root);
        selectedLibraryRoot = libraryDraftRoots.length - 1;
        added++;
      }
      if (added) libraryDraftDirty = true;
      else notify(trUi("所选目录已经在列表中。"));
    }
  } catch (error) { notify((error as Error).message); }
  finally { choosingLibraryFolder = false; renderLibraryPaths(); }
}
function adjustLibraryRoots(action: string) {
  if (choosingLibraryFolder || scanSubmitting || library.scan.running || selectedLibraryRoot < 0) return;
  if (action === "library-remove-folder") {
    libraryDraftRoots.splice(selectedLibraryRoot, 1);
    selectedLibraryRoot = Math.min(selectedLibraryRoot, libraryDraftRoots.length - 1);
  } else {
    const next = selectedLibraryRoot + (action === "library-root-up" ? -1 : 1);
    if (next < 0 || next >= libraryDraftRoots.length) return;
    [libraryDraftRoots[selectedLibraryRoot], libraryDraftRoots[next]] = [libraryDraftRoots[next], libraryDraftRoots[selectedLibraryRoot]];
    selectedLibraryRoot = next;
  }
  libraryDraftDirty = true;
  renderLibraryPaths();
}
function renderLibraryPage() {
  $("#library-page-body").innerHTML =
    ui`<p class="panel-intro">选择本地音乐文件夹，按歌曲内嵌的专辑信息整理；标签缺失时使用目录规则。</p><section class="library-folder-section" aria-label="音乐目录管理"><div class="library-folder-heading"><h2>音乐文件夹</h2><span id="library-path-count"></span></div><div class="library-path-manager"><div id="library-path-list" class="library-path-list" role="listbox" aria-label="音乐文件夹列表"></div><div id="library-path-actions" class="library-path-actions"><button data-action="library-add-folder">添加文件夹…</button><button data-action="library-replace-folder">更改选中项…</button><button data-action="library-remove-folder">移除</button><button data-action="library-root-up">上移 ↑</button><button data-action="library-root-down">下移 ↓</button></div></div><p id="library-path-draft" class="library-path-draft" role="status"></p><p class="library-folder-note">移除仅取消此目录的曲库索引，不删除音乐文件。目录调整按“保存并扫描”生效；离开设置会放弃未保存的目录调整。</p></section><div class="panel-actions"><button class="primary-button" data-action="scan">保存并扫描 ↗</button><button data-action="rescan">重新扫描已保存目录</button></div><div id="scan-status" class="scan-status"></div><div class="library-metrics"><div><b id="library-album-count">${library.albums.length}</b><span>专辑</span></div><div><b id="library-track-count">${library.albums.reduce((n, a) => n + a.tracks.length, 0)}</b><span>曲目</span></div><div><b id="library-genre-count">${library.genres.filter((g) => library.albums.some((a) => a.genreId === g.id)).length}</b><span>流派</span></div></div><section class="panel-section"><h3>在线资料与本地分类</h3><p>向 MusicBrainz 查询专辑名称与艺术家，补充流派和制作人员；音乐文件留在本机。已有资料使用缓存，人工分类优先保留。</p><button data-action="enrich-library" class="text-button">补充缺失的在线资料 ↗</button><button data-action="edit-genres" class="text-button">编辑流派归并规则 ↗</button></section><section class="panel-section"><h3>封面显示</h3><p>方形、竖版、横版封面均保持原始比例，完整放入卡片正面。没有封面时显示专辑名称占位，不使用其他专辑的图片。</p>${!library.albums.length ? trUi('<button data-action="demo" class="text-button">查看演示封面 ↗</button>') : ""}</section>`;
  renderLibraryPaths();
  updateScanStatus();
  const configSection = document.createElement("section");
  configSection.className = "panel-section";
  configSection.id = "online-config";
  $("#library-page-body").append(configSection);
  void (async () => {
    try {
      const config = await request<{
        musicBrainzContact?: string;
        musicBrainzConfigured?: boolean;
        onlineEnabled?: boolean;
      }>("/api/config");
      if (!configSection.isConnected) return;
      configSection.innerHTML = ui`<h3>资料库连接</h3><label class="field-label" for="metadata-contact">MusicBrainz 联系邮箱或项目网址</label><input id="metadata-contact" type="text" value="${esc(config.musicBrainzContact || "")}" placeholder="你的联系邮箱或公开项目网址"><p>按 MusicBrainz 要求用于标识本应用的资料请求，不用于注册或订阅。</p><label class="settings-row"><span>扫描后自动补充新专辑资料<small>已有缓存不重复查询；断网仍可浏览与播放</small></span><input type="checkbox" id="online-enabled" ${config.onlineEnabled ? "checked" : ""}></label><button class="text-button" data-action="save-online">保存资料库设置 ↗</button><p>${config.musicBrainzConfigured ? trUi("资料库请求标识已配置。") : trUi("尚未配置；本地曲库和播放已可使用。")}</p>`;
    } catch (error) {
      if (configSection.isConnected)
        configSection.innerHTML = `<p>${esc((error as Error).message)}</p>`;
    }
  })();
}
function updateScanStatus() {
  for (const [selector, count] of [["#library-album-count", library.albums.length], ["#library-track-count", library.albums.reduce((total, album) => total + album.tracks.length, 0)], ["#library-genre-count", library.genres.filter((genre) => library.albums.some((album) => album.genreId === genre.id)).length]] as const) {
    const value = document.querySelector(selector);
    if (value) value.textContent = String(count);
  }
  const el = document.querySelector("#scan-status");
  if (el)
    el.textContent = library.scan.running
      ? trUi("正在扫描，已有曲库可以继续浏览…")
      : library.scan.error ||
        library.roots
          .filter((r) => r.status === "offline")
          .map((r) => ui`${r.path} 暂时离线，原索引已保留。`)
          .join("\n") ||
        (library.scan.finishedAt
          ? ui`上次扫描 ${new Date(library.scan.finishedAt).toLocaleString(uiLanguage())}`
          : trUi("尚未扫描音乐目录。"));
}
function licenseLabel(url?: string) {
  if (!url) return trUi("未标注授权，使用前请查看条目页");
  const cc = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/([\d.]+)/i.exec(url);
  if (!cc) return trUi("授权见条目页");
  const kind = cc[2].toLowerCase();
  if (cc[1].toLowerCase() === "publicdomain")
    return kind === "zero" ? trUi("CC0 公有领域") : kind === "mark" ? trUi("公有领域标识") : trUi("公有领域");
  return `CC ${kind.toUpperCase()} ${cc[3]}`;
}
function onlineNote(a: MusicAlbum) {
  if (a.genreId === "online-subsonic")
    return trUi(`<h3>来自你自己的音乐服务</h3><p>音频与封面通过本机服务转发，不会保存到本机。</p>`);
  const lines = (a.localNote || "").split("\n").filter(Boolean);
  const link = lines.find((line) => /^https?:\/\//.test(line));
  const license = lines.find((line) => line.startsWith("授权："))?.slice(3);
  return ui`<h3>来自 ${esc(a.folder)}</h3><p>${esc(licenseLabel(license))}。具体授权以条目页面为准。</p>${link ? ui`<a class="text-button" href="${esc(link)}" target="_blank" rel="noopener noreferrer">条目页面 ↗</a>` : ""}`;
}
function updateShelfChrome() {
  stage.dataset.shelf = shelf;
  const line = document.querySelector("#collection-line");
  const text = shelf === "online" ? "ONLINE COLLECTION " : "LOCAL COLLECTION ";
  if (line?.firstChild?.nodeType === Node.TEXT_NODE && line.firstChild.textContent !== text)
    line.firstChild.textContent = text;
  document
    .querySelector('.music-topnav [data-action="online"]')
    ?.setAttribute("aria-pressed", String(shelf === "online"));
  const empty = $("#music-empty");
  if (empty.dataset.shelf !== shelf) {
    empty.dataset.shelf = shelf;
    empty.innerHTML = shelf === "online" ? onlineEmptyHtml : localEmptyHtml;
  }
}
async function switchShelf(next: Shelf, reveal?: { albumId: string; trackId?: string }) {
  if (!ready) return;
  if (next === shelf) {
    if (reveal) revealAlbum(reveal.albumId, reveal.trackId);
    else closePanel();
    return;
  }
  closePanel(() => {
    void (async () => {
      try {
        const snapshot = await request<MusicLibrary>(
          next === "online" ? "/api/online/library" : "/api/library",
        );
        // Drop any in-flight refresh of the other shelf, and do not mistake the swap for a finished scan.
        libraryStateVersion++;
        clearTimeout(pollTimer);
        shelf = next;
        demo = false;
        libraryReceived = false;
        if (next === "online") onlineSnapshot = snapshot;
        await receiveLibrary(snapshot, true);
        pollTimer = setTimeout(() => void loadLibrary(), 12000);
        if (reveal) revealAlbum(reveal.albumId, reveal.trackId);
        else notify(next === "online" ? trUi("已切换到在线专辑架。") : trUi("已切换到本地专辑架。"));
      } catch (error) {
        notify((error as Error).message);
      }
    })();
  });
}
function locatePlaying(albumId: string, trackId: string) {
  // The playing song may belong to the other shelf; follow it there.
  const wanted: Shelf = albumId.startsWith("online-") ? "online" : "local";
  if (wanted !== shelf) void switchShelf(wanted, { albumId, trackId });
  else revealAlbum(albumId, trackId, { reuseOpenAlbum: true });
}
async function renderOnlinePanel() {
  $("#panel-body").innerHTML =
    trUi(`<p class="panel-intro">发现音乐，加入独立的在线专辑架。仅在搜索、加入或播放时联网。</p><div id="online-body"><p class="scan-status">正在读取在线曲库…</p></div>`);
  try {
    const [sources, snapshot] = await Promise.all([
      request<OnlineSourceInfo>("/api/online/sources"),
      request<MusicLibrary>("/api/online/library"),
    ]);
    onlineSources = sources;
    onlineSnapshot = snapshot;
  } catch (error) {
    const body = document.querySelector("#online-body");
    if (panel === "online" && body) body.innerHTML = `<p class="scan-status" role="alert">${esc((error as Error).message)}</p>`;
    return;
  }
  if (panel !== "online") return;
  $("#online-body").innerHTML = ui`<div class="genre-filters shelf-switch" id="shelf-switch"></div>
    <section class="panel-section online-discover"><h3>搜索在线曲库</h3>
      <div class="online-search">
        <label class="online-source-field"><span>来源</span><select id="online-source" aria-label="来源"></select></label>
        <label class="online-collection-field"><span>合集</span><select id="online-collection" aria-label="合集">${onlineCollections.map(([value, name]) => `<option value="${value}" ${onlineSearch.collection === value ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></label>
        <div class="panel-search-field online-query-field">${icons.search}<input class="album-search" id="online-query" type="search" placeholder="专辑、歌手、关键词…" aria-label="搜索在线专辑" value="${esc(onlineSearch.q)}"></div>
        <button type="button" class="primary-button" data-action="online-search">搜索 ↗</button>
      </div>
      <p class="online-note" id="online-source-note"></p>
      <div id="online-results"></div></section>
    <section class="panel-section"><h3>我的在线专辑 <small id="online-count"></small></h3><div id="online-list"></div></section>
    <section class="panel-section" id="online-subsonic"></section>`;
  drawShelfSwitch();
  drawOnlineSources();
  drawOnlineResults();
  drawOnlineList();
  drawSubsonicForm();
  if (preferences.style.design === "rhine") panelSelectControls = enhanceSettingsSelectControls($("#panel-body"));
}
function drawShelfSwitch() {
  const el = document.querySelector("#shelf-switch");
  if (!el) return;
  const count = onlineSnapshot?.albums.length ?? 0;
  el.innerHTML = ui`<button data-action="shelf-local" class="${shelf === "local" ? "active" : ""}" aria-pressed="${shelf === "local"}">本地专辑架</button><button data-action="shelf-online" class="${shelf === "online" ? "active" : ""}" aria-pressed="${shelf === "online"}">在线专辑架 · ${count}</button>`;
}
function drawOnlineSources() {
  const select = document.querySelector<HTMLSelectElement>("#online-source");
  if (!select) return;
  const configured = !!onlineSources?.sources.find((source) => source.id === "subsonic")?.configured;
  if (!configured && onlineSearch.source === "subsonic") onlineSearch.source = "internetarchive";
  select.innerHTML = `<option value="internetarchive">Internet Archive</option>${configured ? trUi('<option value="subsonic">自有音乐服务</option>') : ""}`;
  select.value = onlineSearch.source;
  panelSelectControls?.sync();
  updateOnlineSourceNote();
}
function updateOnlineSourceNote() {
  const source = document.querySelector<HTMLSelectElement>("#online-source")?.value;
  const ia = source !== "subsonic";
  const collection = document.querySelector<HTMLElement>(".online-collection-field");
  if (collection) collection.hidden = !ia;
  const note = document.querySelector("#online-source-note");
  if (note)
    note.textContent = ia
      ? trUi("搜索 archive.org 的公开音频。每个条目的授权各不相同，未标注授权的内容请自行确认能否使用。")
      : trUi("搜索你自己的音乐服务，音频由你的服务提供。");
}
function drawOnlineResults() {
  const el = document.querySelector("#online-results");
  if (!el) return;
  const s = onlineSearch;
  if (s.error) {
    el.innerHTML = `<p class="scan-status" role="alert">${esc(s.error)}</p>`;
    return;
  }
  if (s.busy && !s.items.length) {
    el.innerHTML = trUi('<p class="scan-status">正在搜索…</p>');
    return;
  }
  if (!s.q) {
    el.innerHTML = "";
    return;
  }
  if (!s.items.length) {
    el.innerHTML = trUi('<div class="no-results">没有找到匹配的专辑。</div>');
    return;
  }
  const showLicense = s.source === "internetarchive";
  el.innerHTML =
    s.items
      .map(
        (hit) =>
          `<div class="online-row"><span class="result-copy"><strong title="${esc(hit.title)}">${esc(hit.title)}</strong><small>${esc(hit.artist)}${hit.year ? ` · ${hit.year}` : ""}${showLicense ? ` · ${esc(licenseLabel(hit.license))}` : ""}</small>${hit.url && /^https?:\/\//.test(hit.url) ? ui`<a class="online-link" href="${esc(hit.url)}" target="_blank" rel="noopener noreferrer">条目页 ↗</a>` : ""}</span><button data-action="online-add" data-ref="${esc(hit.ref)}" ${hit.added ? "disabled" : ""}>${hit.added ? trUi("已加入") : trUi("加入 ↗")}</button></div>`,
      )
      .join("") +
    (s.hasMore
      ? `<button class="text-button" data-action="online-more" ${s.busy ? "disabled" : ""}>${s.busy ? trUi("正在搜索…") : trUi("更多结果 ↗")}</button>`
      : "");
}
function drawOnlineList() {
  const el = document.querySelector("#online-list");
  if (!el) return;
  const items = onlineSnapshot?.albums ?? [];
  const count = document.querySelector("#online-count");
  if (count) count.textContent = items.length ? `· ${items.length}` : "";
  el.innerHTML = items.length
    ? items
        .map(
          (a) =>
            ui`<div class="online-row has-cover"><span class="result-cover">${cover(a)}</span><span class="result-copy"><strong title="${esc(a.title)}">${esc(a.title)}</strong><small title="${esc(a.artist)} · ${esc(a.folder)}">${esc(a.artist)} · ${a.tracks.length} 首 · ${esc(a.folder)}</small></span><span class="online-buttons"><button data-action="online-reveal" data-id="${esc(a.id)}">在架上查看 ↗</button><button data-action="online-remove" data-id="${esc(a.id)}">移除</button></span></div>`,
        )
        .join("")
    : trUi('<p class="scan-status">还没有在线专辑。搜索后点“加入”，它们会出现在在线专辑架上。</p>');
}
function drawSubsonicForm() {
  const el = document.querySelector("#online-subsonic");
  if (!el) return;
  const config = onlineSources?.subsonic;
  const expanded = el.querySelector<HTMLDetailsElement>("details")?.open ?? preferences.style.design !== "rhine";
  el.innerHTML = ui`<details class="online-service" ${expanded ? "open" : ""}><summary><span><strong>自有音乐服务</strong><small>Subsonic · Navidrome · Jellyfin</small></span><span class="online-service-state">${config?.baseUrl ? trUi("已配置") : trUi("连接服务")}</span></summary><div class="online-service-fields"><p>连接你自己的 Navidrome、Jellyfin（Subsonic 插件）、Airsonic 等服务。地址、账号和密码只保存在本机数据目录的 online.json（密码为明文，建议使用只给播放器用的账号），不会写进项目文件夹。</p>
    <label class="field-label" for="subsonic-url">服务地址<span>例如 http://192.168.1.10:4533</span></label><input id="subsonic-url" type="text" autocomplete="off" spellcheck="false" value="${esc(config?.baseUrl || "")}">
    <label class="field-label online-gap" for="subsonic-user">账号</label><input id="subsonic-user" type="text" autocomplete="off" spellcheck="false" value="${esc(config?.username || "")}">
    <label class="field-label online-gap" for="subsonic-pass">密码<span>${config?.passwordSet ? trUi("已保存，留空则保持不变") : ""}</span></label><input id="subsonic-pass" type="password" autocomplete="new-password">
    <div class="panel-actions"><button class="primary-button" data-action="subsonic-save">保存</button><button data-action="subsonic-test">测试连接</button>${config ? trUi('<button data-action="subsonic-clear">清除</button>') : ""}</div>
    <p id="subsonic-status" class="scan-status" role="status" aria-live="polite"></p></div></details>`;
}
function subsonicFields() {
  const read = (id: string) => document.querySelector<HTMLInputElement>(id)?.value ?? "";
  return { baseUrl: read("#subsonic-url").trim(), username: read("#subsonic-user").trim(), password: read("#subsonic-pass") };
}
async function subsonicAction(kind: "save" | "test" | "clear") {
  const status = document.querySelector("#subsonic-status");
  const say = (text: string) => {
    if (status) status.textContent = text;
  };
  say(kind === "test" ? trUi("正在连接…") : "");
  try {
    if (kind === "test") {
      const result = await request<{ version: string; server?: string }>("/api/online/subsonic/test", subsonicFields());
      say(ui`连接成功${result.server ? `：${result.server}` : ""}（协议 ${result.version || trUi("未知")}）。`);
      return;
    }
    onlineSources = await request<OnlineSourceInfo>("/api/online/subsonic", kind === "clear" ? { clear: true } : subsonicFields());
    drawOnlineSources();
    drawSubsonicForm();
    const after = document.querySelector("#subsonic-status");
    if (after) after.textContent = kind === "clear" ? trUi("已清除保存的服务信息。") : trUi("已保存。现在可以在上方“来源”里选择自有音乐服务。");
  } catch (error) {
    say((error as Error).message);
  }
}
async function runOnlineSearch(more = false) {
  const s = onlineSearch;
  if (s.busy) return;
  if (!more) {
    const q = document.querySelector<HTMLInputElement>("#online-query")?.value.trim() ?? "";
    if (!q) {
      notify(trUi("请输入搜索词。"));
      return;
    }
    s.source = document.querySelector<HTMLSelectElement>("#online-source")?.value || "internetarchive";
    s.collection = s.source === "internetarchive" ? document.querySelector<HTMLSelectElement>("#online-collection")?.value || "" : "";
    s.q = q;
    s.page = 1;
    s.items = [];
    s.hasMore = false;
  } else s.page += 1;
  s.busy = true;
  s.error = "";
  drawOnlineResults();
  try {
    const params = new URLSearchParams({ source: s.source, q: s.q, page: String(s.page) });
    if (s.collection) params.set("collection", s.collection);
    const result = await request<{ items: OnlineHit[]; total: number | null; hasMore?: boolean }>(`/api/online/search?${params}`);
    s.items = more ? [...s.items, ...result.items] : result.items;
    s.hasMore = result.hasMore ?? (result.total !== null && s.page * 20 < result.total && result.items.length > 0);
  } catch (error) {
    s.error = (error as Error).message;
    if (more) s.page -= 1;
  } finally {
    s.busy = false;
    drawOnlineResults();
  }
}
async function refreshOnlineList() {
  onlineSnapshot = await request<MusicLibrary>("/api/online/library");
  if (shelf === "online") {
    libraryStateVersion++;
    await receiveLibrary(onlineSnapshot, true);
  }
  if (panel === "online") {
    drawOnlineList();
    drawShelfSwitch();
  }
}
async function addOnlineAlbum(button: HTMLElement) {
  const hit = onlineSearch.items.find((item) => item.ref === button.dataset.ref);
  if (!hit) return;
  button.setAttribute("disabled", "");
  button.textContent = trUi("正在加入…");
  try {
    const result = await request<{ title: string; tracks: number }>("/api/online/albums", { source: onlineSearch.source, ref: hit.ref });
    hit.added = true;
    notify(ui`已加入在线专辑架：${result.title}（${result.tracks} 首）。`);
    await refreshOnlineList();
  } catch (error) {
    notify((error as Error).message);
  }
  drawOnlineResults();
}
async function removeOnlineAlbum(id: string) {
  const removed = onlineSnapshot?.albums.find((a) => a.id === id);
  try {
    await request("/api/online/albums/remove", { id });
    if (removed)
      for (const hit of onlineSearch.items)
        if (hit.title === removed.title && hit.artist === removed.artist) hit.added = false;
    await refreshOnlineList();
    drawOnlineResults();
    notify(trUi("已从在线专辑架移除。"));
  } catch (error) {
    notify((error as Error).message);
  }
}
document.addEventListener("change", (event) => {
  if ((event.target as HTMLElement).id === "online-source") updateOnlineSourceNote();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.target as HTMLElement).id === "online-query") {
    event.preventDefault();
    void runOnlineSearch();
  }
});

function renderSearchPanel() {
  searchGenre = "";
  $("#panel-body").innerHTML =
    ui`<div class="panel-search-field">${icons.search}<input class="album-search" id="album-search" type="search" placeholder="专辑、歌曲、歌手、流派…" aria-label="搜索专辑与歌曲"></div><div class="genre-filters" aria-label="流派筛选"><button type="button" data-filter="" class="active" aria-pressed="true">全部</button>${genres
      .filter((g) => albums.some((a) => a.genreId === g.id))
      .map((g) => `<button type="button" data-filter="${esc(g.id)}" aria-pressed="false">${esc(g.name)}</button>`)
      .join("")}</div><div class="search-results-heading"><span>匹配结果</span><span id="search-result-count" role="status" aria-live="polite"></span></div><div id="album-results"></div>`;
  renderSearchResults();
}
let searchGenre = "";
function renderSearchResults() {
  const query = ($<HTMLInputElement>("#album-search")?.value || "")
    .trim()
    .toLocaleLowerCase();
  const results: string[] = [];
  for (const a of albums) {
    if (searchGenre && a.genreId !== searchGenre) continue;
    if (!query || `${a.title} ${a.artist} ${genreName(a.genreId)}`.toLocaleLowerCase().includes(query)) {
      results.push(ui`<button type="button" class="album-result" data-album="${esc(a.id)}"><span class="result-cover">${cover(a)}</span><span class="result-copy"><strong title="${esc(a.title)}">${esc(a.title)}</strong><small title="${esc(a.artist)} · ${esc(genreName(a.genreId))}">${esc(a.artist)} · ${esc(genreName(a.genreId))}</small></span><em>专辑</em><i aria-hidden="true">↗</i></button>`);
    }
    if (!query) continue;
    for (const track of a.tracks) {
      if (!`${track.title} ${track.artist}`.toLocaleLowerCase().includes(query)) continue;
      // Preserve the exact song identity; selecting a result navigates without playing.
      results.push(ui`<button type="button" class="album-result song-result" data-album="${esc(a.id)}" data-search-track="${esc(track.id)}" aria-label="定位歌曲 ${esc(track.title)}，${esc(a.title)}"><span class="result-cover">${cover(a)}</span><span class="result-copy"><strong title="${esc(track.title)}">${esc(track.title)}</strong><small title="${esc(track.artist)} · ${esc(a.title)}">${esc(track.artist)} · ${esc(a.title)}</small></span><em>歌曲</em><i aria-hidden="true">↗</i></button>`);
    }
  }
  $("#album-results").innerHTML = results.length
    ? results.join("")
    : trUi('<div class="no-results">没有找到专辑或歌曲。</div>');
  $("#search-result-count").textContent = String(results.length).padStart(2, "0");
}
function processingPresetMarkup() {
  const activeId = processingPresetStore.activeId || "current";
  const options = [
    ui`<option value="current" ${activeId === "current" ? "selected" : ""}>当前设置</option>`,
    ...processingPresetStore.presets.map((preset) => `<option value="${esc(preset.id)}" ${activeId === preset.id ? "selected" : ""}>${esc(preset.name)}${preset.kind === "imported" ? preset.format === "rhine" ? trUi(" · Rhine 备份") : trUi(" · Poweramp 原件") : ""}</option>`),
  ];
  const selected = processingPresetStore.presets.find((preset) => preset.id === activeId);
  const editable = selected?.kind === "saved";
  return ui`<div class="processing-presets" id="processing-presets">
    <div class="processing-preset-fields">
      <label class="settings-row"><span>EQ 预设</span><select id="processing-preset-select" aria-label="均衡器预设">${options.join("")}</select></label>
      <label class="settings-row"><span>预设名称<small>只保存均衡器参数</small></span><input id="processing-preset-name" type="text" maxlength="80" value="${esc(selected?.name || processingSettings.eq.name)}" aria-label="均衡器预设名称"></label>
    </div>
    <div class="processing-preset-actions">
      <button type="button" data-processing-preset-action="save" ${editable ? "" : "disabled"}>保存</button>
      <button type="button" data-processing-preset-action="save-as">另存为</button>
      <button type="button" data-processing-preset-action="rename" ${editable ? "" : "disabled"}>重命名</button>
      <button type="button" data-processing-preset-action="delete" ${selected ? "" : "disabled"}>删除本机记录</button>
      <button type="button" data-processing-preset-action="restore">恢复默认</button>
      <button type="button" data-processing-preset-action="undo" ${processingUndoStack.length ? "" : "disabled"}>撤销</button>
      <button type="button" data-processing-preset-action="import">导入预设 JSON</button>
      <button type="button" data-processing-preset-action="restore-backup" ${selected?.kind === "imported" && selected.format === "rhine" ? "" : "hidden disabled"}>恢复此备份的全部处理设置</button>
      <button type="button" data-processing-preset-action="export">导出当前设置 JSON</button>
      <input id="processing-preset-file" type="file" tabindex="-1" aria-label="选择 Poweramp 预设或 Rhine 设置备份" hidden>
    </div>
    <p id="processing-preset-status" class="processing-preset-status" role="status" aria-live="polite">两套均衡器参数随预设保存在本机。导入预设只更换均衡参数；音调与输出设置单独恢复。</p>
  </div>`;
}

function mountProcessingPresets(content: HTMLElement) {
  const slot = content.querySelector<HTMLElement>("[data-processing-presets-slot]");
  if (!slot) return;
  if (!processingPresetElement) {
    const template = document.createElement("template");
    template.innerHTML = processingPresetMarkup();
    processingPresetElement = template.content.firstElementChild as HTMLElement;
  }
  slot.append(processingPresetElement);
}

function setProcessingApplyStatus(message: string) {
  processingApplyMessage = message;
  document.querySelectorAll<HTMLElement>("[data-processing-apply-status]").forEach(node => { node.textContent = message; });
}

function replayGainMarkup() {
  const rg = processingSettings.replayGain;
  return ui`<section class="panel-section" id="replaygain-settings"><h3>播放增益 · ReplayGain</h3><p>按歌曲或专辑标签调整播放电平；找不到标签时使用备用前级。</p>
    <label class="settings-row"><span>模式</span><select data-processing-field="replayGain.mode" aria-label="播放增益模式"><option value="off" ${rg.mode === "off" ? "selected" : ""}>关闭</option><option value="gain" ${rg.mode === "gain" ? "selected" : ""}>播放增益</option><option value="protect" ${rg.mode === "protect" ? "selected" : ""}>避免削波</option></select></label>
    <label class="settings-row"><span>标签来源</span><select data-processing-field="replayGain.source" aria-label="播放增益标签来源"><option value="track" ${rg.source === "track" ? "selected" : ""}>单曲</option><option value="album" ${rg.source === "album" ? "selected" : ""}>专辑</option></select></label>
    <div class="processing-number-grid"><label><span>前级增益 · dB</span><input type="number" min="-24" max="24" step="0.1" data-processing-field="replayGain.preamp" value="${rg.preamp}" aria-label="播放增益前级"></label><label><span>缺少标签时 · dB</span><input type="number" min="-24" max="24" step="0.1" data-processing-field="replayGain.noTagPreamp" value="${rg.noTagPreamp}" aria-label="缺少标签时的播放增益"></label></div>
  </section>`;
}

function transitionMarkup() {
  const transition = processingSettings.transition;
  const select = (path: string, label: string, value: string, choices: [string, string][]) => `<label class="settings-row"><span>${label}</span><select data-processing-field="${path}" aria-label="${label}">${choices.map(([key, name]) => `<option value="${key}" ${value === key ? "selected" : ""}>${name}</option>`).join("")}</select></label>`;
  const range = (path: string, label: string, value: number, max: number, step: number) => `<label class="settings-row processing-setting-range"><span>${label}<small>${value === 0 ? "0 ms" : `${value} ms`}</small></span><input type="range" min="0" max="${max}" step="${step}" data-range-unit=" ms" data-processing-field="${path}" aria-label="${label}" value="${value}"></label>`;
  return ui`<section class="panel-section" id="transition-settings"><h3>切歌与淡变</h3><p>无缝、交叉渐变和操作淡变只在支持的原生 PCM 输出中应用。</p>
    ${select("transition.automatic", trUi("自动切歌"), transition.automatic, [["gapless", trUi("无间隙")], ["crossfade", trUi("交叉渐变")], ["none", trUi("保留曲间停顿")]])}
    ${select("transition.manual", trUi("手动切歌"), transition.manual, [["none", trUi("直接切换")], ["short", trUi("短淡变")], ["crossfade", trUi("交叉渐变")]])}
    ${range("transition.crossfadeMs", trUi("自动交叉渐变"), transition.crossfadeMs, 30000, 100)}
    ${range("transition.manualMs", trUi("手动切歌淡变"), transition.manualMs, 10000, 20)}
    <label class="settings-row"><span>播放 / 暂停淡变</span><input type="checkbox" role="switch" data-processing-field="transition.transportFade" ${transition.transportFade ? "checked" : ""}></label>
    ${range("transition.transportMs", trUi("播放 / 暂停淡变时长"), transition.transportMs, 10000, 20)}
    <label class="settings-row"><span>跳转淡变</span><input type="checkbox" role="switch" data-processing-field="transition.seekFade" ${transition.seekFade ? "checked" : ""}></label>
    ${range("transition.seekMs", trUi("跳转淡变时长"), transition.seekMs, 10000, 10)}
    ${range("transition.preloadMs", trUi("下一首预载"), transition.preloadMs, 30000, 100)}
    ${range("transition.gapMs", trUi("曲间停顿"), transition.gapMs, 10000, 10)}
  </section>`;
}

function resamplingMarkup() {
  const settings = processingSettings.resampling;
  const rates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];
  const rateName = (rate: number) => `${rate / 1000} kHz`;
  const suggestedRates = [...new Set([...rates, ...settings.allowedRates, settings.rate])].sort((a, b) => a - b);
  return ui`<section class="panel-section" id="resampling-settings"><h3>输出采样率</h3><p>在 DSEE 等声音增强之后匹配 PCM 提交采样率。跟随处理结果可保留增强后的采样率；自动模式从允许列表中匹配最近值；指定模式使用所选或填写的数值。</p>
    <label class="settings-row"><span>输出采样率模式</span><select data-processing-field="resampling.mode" data-processing-pcm-only aria-label="输出采样率模式"><option value="follow" ${settings.mode === "follow" ? "selected" : ""}>跟随处理结果</option><option value="auto" ${settings.mode === "auto" ? "selected" : ""}>自动匹配允许列表</option><option value="fixed" ${settings.mode === "fixed" ? "selected" : ""}>指定采样率</option></select></label>
    <label class="settings-row"><span>常用采样率<small>选择后直接应用；也可在下方输入其他数值</small></span><select data-processing-rate-choice aria-label="常用输出采样率"><option value="custom" ${!rates.includes(settings.rate) ? "selected" : ""}>自定义数值</option>${rates.map(rate => `<option value="${rate}" ${settings.rate === rate ? "selected" : ""}>${rateName(rate)}</option>`).join("")}</select></label>
    <label class="settings-row"><span>指定采样率<small>输入 kHz，范围 8–768；可用常见值，也可直接填写</small></span><input type="number" min="8" max="768" step="0.001" list="resampling-rate-suggestions" data-processing-field="resampling.rate" data-processing-rate-unit="khz" data-processing-pcm-only value="${settings.rate / 1000}" aria-label="指定输出采样率（kHz）"></label>
    <datalist id="resampling-rate-suggestions">${suggestedRates.map(rate => `<option value="${rate / 1000}" label="${rateName(rate)}">`).join("")}</datalist>
    <label class="settings-row"><span>重采样算法<small>仅在输入与目标采样率不同时运行</small></span><select data-processing-field="resampling.engine" data-processing-pcm-only aria-label="重采样算法"><option value="soxr" ${settings.engine === "soxr" ? "selected" : ""}>SoX · libsoxr</option><option value="r8brain" ${settings.engine === "r8brain" ? "selected" : ""}>r8brain · 高精度</option><option value="fast" ${settings.engine === "fast" ? "selected" : ""}>线性插值 · 快速</option></select></label>
    <label class="settings-row" data-soxr-option><span>SoX 质量<small>极高质量使用更严格的滤波设置</small></span><select data-processing-field="resampling.soxrQuality" data-processing-pcm-only aria-label="SoX 重采样质量"><option value="hq" ${settings.soxrQuality === "hq" ? "selected" : ""}>高质量 · HQ</option><option value="vhq" ${settings.soxrQuality === "vhq" ? "selected" : ""}>极高质量 · VHQ</option></select></label>
    <label class="settings-row" data-soxr-option><span>SoX 通带截止比例<small>相对输入／输出中较低奈奎斯特频率的比例；点击数值可输入</small></span><input type="range" min="85" max="99.5" step="0.1" data-range-unit="%" data-processing-field="resampling.soxrPassband" data-processing-passband-unit="percent" data-processing-pcm-only value="${settings.soxrPassband * 100}" aria-label="SoX 通带截止比例（%）"></label>
    <fieldset class="processing-rate-set" data-processing-pcm-only><legend>自动选择允许的采样率<small>自动模式会从已勾选的值中匹配；指定模式不受此列表限制</small></legend><div>${rates.map(rate=>`<label><input type="checkbox" role="switch" data-processing-rate="${rate}" ${settings.allowedRates.includes(rate)?'checked':''}><span>${rateName(rate)}</span></label>`).join('')}</div></fieldset>
    <label class="settings-row"><span>自动模式匹配采样率系列<small>只选择与处理结果同属 44.1 kHz 或 48 kHz 系列的值</small></span><input type="checkbox" role="switch" data-processing-field="resampling.family" data-processing-pcm-only ${settings.family?'checked':''}></label>
    <p id="processing-resampling-note" class="processing-support-note" role="status">采样率设置会在 PCM 原生输出中生效；实际设备输出以音频链路报告为准。</p>
    <p id="processing-resampling-live" class="audio-live-summary" role="status"></p>
  </section>`;
}

function precisionMarkup() {
  return ui`<section class="panel-section" id="precision-settings"><h3>输出格式与处理精度</h3>
    <div id="processing-precision-status" class="precision-status" aria-label="实际音频链路"></div>
    <label class="settings-row" id="processing-bitperfect"><span>比特一致性 · 纯输出<small id="bitperfect-capability-note">解码直通</small></span><input type="checkbox" role="switch" data-processing-field="bitPerfect" ${processingSettings.bitPerfect?'checked':''}></label>
    <div id="bitperfect-live-status" class="consistency-status" role="status"></div>
    <label class="settings-row"><span>64 位浮点优先<small>实验性</small></span><input type="checkbox" role="switch" data-processing-field="float64" data-processing-pcm-only ${processingSettings.float64?'checked':''}></label>
    <label class="settings-row"><span>输出格式</span><select data-processing-field="outputFormat" data-processing-pcm-only aria-label="输出格式">${[['auto',trUi('自动')],['s16',trUi('16 位整数')],['s24',trUi('24 位整数')],['s32',trUi('32 位整数')],['s32v24',trUi('24 位整数（32 位容器）')],['f32',trUi('32 位浮点')]].map(([value,label])=>`<option value="${value}" ${processingSettings.outputFormat===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <label class="settings-row"><span>整数输出抖动</span><select data-processing-field="dither" data-processing-pcm-only aria-label="整数输出抖动方式">${[['none',trUi('关闭')],['rectangular',trUi('矩形')],['triangular',trUi('三角')],['highpass',trUi('高通三角')]].map(([value,label])=>`<option value="${value}" ${processingSettings.dither===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <details class="precision-help"><summary>设置说明</summary><p>纯输出保留解码后的整数样本和原采样率，停用声音处理、数字音量、抖动与淡变。WASAPI 自动使用独占；关闭后恢复原输出模式和处理偏好。支持 16、24、32 位无损整数音源。</p><p>等待校验表示尚未获得本次播放的检查结果。</p><p>输出格式为送入接口的格式；共享模式之后还有 Windows 混音。24 位整数可用 24 位容器或 32 位容器存放，容器大小与有效位数分开。</p><p>64 位浮点优先用于内部处理；当前自有处理已使用双精度。整数抖动用于量化，浮点输出和纯输出不添加抖动。ASIO 的指定格式需与驱动原生格式匹配。</p><p>接口所需的对齐与零填充不改变有效样本值。</p></details>
  </section>`;
}

function bufferMarkup() {
  return ui`<section class="panel-section" id="buffer-settings"><h3>设备缓冲</h3><p>较大的缓冲有助于连续播放；实际管理方式和帧数以音频链路回报为准。</p>
    <label class="settings-row processing-setting-range"><span>播放缓冲<small>${processingSettings.bufferMs === 0 ? trUi("自动") : `${processingSettings.bufferMs} ms`}</small></span><input type="range" min="0" max="2000" step="10" data-range-unit=" ms" data-processing-field="bufferMs" aria-label="音乐播放缓冲" value="${processingSettings.bufferMs}"></label>
    <p id="buffer-control-note" class="processing-support-note" role="note">原生播放后会显示缓冲由系统、驱动或播放器管理。</p>
    <label class="settings-row processing-setting-range"><span>输出重配置等待<small>更改输出格式或采样率时的等待时长</small></span><input type="range" min="0" max="10000" step="10" data-range-unit=" ms" data-processing-field="reconfigureMs" aria-label="输出重配置等待时长" value="${processingSettings.reconfigureMs}"></label>
  </section>`;
}

function updateProcessingSupportStatus() {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-bitperfect-disabled]').forEach(control => {
    control.disabled = control.dataset.bitperfectDisabled === 'true';
    delete control.dataset.bitperfectDisabled;
  });
  const node = document.querySelector<HTMLElement>("#processing-support-status");
  const snapshot = playerState?.nativeOutputStatus?.backend === preferences.output.backend ? playerState.nativeOutputStatus : undefined;
  const rawDsdRoute = !!playerState?.currentTrack && (playerState.transport === "playing" || playerState.transport === "paused") && isDsdTrack(playerState.currentTrack) && (
    preferences.output.backend === "asio" && preferences.output.dsdMode !== "pcm"
    || preferences.output.backend === "wasapi" && preferences.output.wasapiDsdMode === "dop"
  );
  const effectiveWasapiMode = processingSettings.bitPerfect ? 'exclusive' : preferences.output.wasapiMode;
  document.querySelectorAll<HTMLButtonElement>('[data-eq-engine-target]').forEach(button => { button.disabled = rawDsdRoute || processingSettings.bitPerfect; });
  const sharedWasapi = preferences.output.backend === "wasapi" && effectiveWasapiMode === "shared";
  const bufferUnavailable = isPlaybackBufferUnavailable(preferences.output.backend, effectiveWasapiMode, snapshot?.bufferControl);
  const bufferControl = document.querySelector<HTMLInputElement>('[data-processing-field="bufferMs"]');
  if (bufferControl) bufferControl.disabled = bufferUnavailable;
  const bufferNote = document.querySelector<HTMLElement>("#buffer-control-note");
  if (bufferNote) {
    if (sharedWasapi) bufferNote.textContent = trUi("WASAPI 共享缓冲由 Windows 管理；播放器缓冲滑块在此模式下不可用。实际帧数会按设备回报显示。");
    else if (snapshot?.bufferControl === "driver") bufferNote.textContent = trUi("当前使用驱动默认缓冲；可提交请求值，驱动会按支持的粒度调整。实际帧数以音频链路回报为准。");
    else if (snapshot?.bufferControl === "system") bufferNote.textContent = trUi("当前缓冲由系统管理；播放器缓冲滑块不可用，实际帧数以音频链路回报为准。");
    else if (snapshot?.bufferControl === "application") bufferNote.textContent = trUi("当前缓冲由播放器设置；实际帧数以音频链路回报为准。");
    else bufferNote.textContent = trUi("原生播放后会显示缓冲由系统、驱动或播放器管理。");
  }
  const resamplingMode = processingSettings.resampling.mode;
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLFieldSetElement>("[data-processing-pcm-only]").forEach(control => {
    control.disabled = rawDsdRoute;
  });
  const specifiedRate = document.querySelector<HTMLInputElement>('[data-processing-field="resampling.rate"]');
  if (specifiedRate) specifiedRate.disabled = rawDsdRoute || resamplingMode !== "fixed";
  const rateChoice = document.querySelector<HTMLSelectElement>('[data-processing-rate-choice]');
  if (rateChoice) {
    rateChoice.disabled = rawDsdRoute || resamplingMode !== "fixed";
    const selectedRate = String(processingSettings.resampling.rate);
    rateChoice.value = [...rateChoice.options].some(option => option.value === selectedRate) ? selectedRate : "custom";
  }
  const resamplingEngine = document.querySelector<HTMLSelectElement>('[data-processing-field="resampling.engine"]');
  if (resamplingEngine) resamplingEngine.disabled = rawDsdRoute || resamplingMode === "follow";
  document.querySelectorAll<HTMLElement>('[data-soxr-option]').forEach(row => { row.hidden = processingSettings.resampling.engine !== 'soxr'; row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(control => { control.disabled = rawDsdRoute || resamplingMode === 'follow'; }); });
  document.querySelectorAll<HTMLInputElement>("[data-processing-rate]").forEach(control => {
    control.disabled = rawDsdRoute || resamplingMode !== "auto";
  });
  const family = document.querySelector<HTMLInputElement>('[data-processing-field="resampling.family"]');
  if (family) family.disabled = rawDsdRoute || resamplingMode !== "auto";
  const resamplingNote = document.querySelector<HTMLElement>("#processing-resampling-note");
  const resamplingLive = document.querySelector<HTMLElement>("#processing-resampling-live");
  if (resamplingLive) {
    const live = snapshot?.mode === 'pcm' && ['playing','paused'].includes(playerState?.transport ?? '');
    const source = snapshot?.sourceSampleRate, target = snapshot?.sampleRate;
    resamplingLive.textContent = live && source && target
      ? ui`实际采样率：${source / 1000} → ${target / 1000} kHz${source === target ? trUi(' · 未进行输出重采样') : ''}`
      : rawDsdRoute ? trUi('DSD 直出不经过 PCM 输出重采样。') : trUi('开始原生 PCM 播放后显示实际采样率。');
  }
  if (resamplingNote) {
    if (rawDsdRoute) resamplingNote.textContent = trUi("当前歌曲使用原生 DSD / DoP 位流直出；PCM 采样率与格式设置已锁定。切换到“转换为 PCM”后即可调整。");
    else if (preferences.output.backend === "browser") resamplingNote.textContent = trUi("浏览器兼容播放不会应用这些采样率设置；选择原生 PCM 输出后才会生效。");
    else if (preferences.output.backend === "wasapi" && preferences.output.wasapiMode === "shared") resamplingNote.textContent = trUi("WASAPI 共享输出由 Windows 系统混音；最终采样率可能受 Windows 当前默认格式影响。");
    else resamplingNote.textContent = trUi("实际采样率以音频链路报告为准；设备不支持指定值时，原生输出会报告打开失败。");
  }
  if (node) {
    if (rawDsdRoute) node.textContent = trUi("当前 DSD 歌曲正以原生 DSD / DoP 位流输出；PCM 处理选项已锁定。选择 PCM 转换后可使用重采样、位深和 DSP 设置。");
    else if (preferences.output.backend === "browser") node.textContent = trUi("浏览器兼容播放：设置可编辑并保存在本机，但不会改变播放声音。");
    else if (!nativeStatus) node.textContent = trUi("正在检查原生音频输出…");
    else if (preferences.output.backend === "wasapi" && !nativeStatus.wasapiAvailable) node.textContent = nativeStatus.wasapiError || trUi("WASAPI 当前不可用。");
    else if (preferences.output.backend === "asio" && !nativeStatus.available) node.textContent = nativeStatus.error || trUi("ASIO 当前不可用。");
    else if (snapshot?.capabilities?.processing === false) node.textContent = trUi("当前原生输出不支持音效处理；设置仍保存在本机。");
    else node.textContent = trUi("当前选择原生音频输出；效果是否参与播放以音频链路中的实际状态为准。");
  }
  if (preferences.output.backend === "browser") setProcessingApplyStatus(trUi("浏览器兼容播放不会应用这些处理。"));
    else if (playerState?.processingPending) setProcessingApplyStatus(trUi("切歌完成后应用新设置。"));
    else if (snapshot?.capabilities?.processing === false) setProcessingApplyStatus(trUi("当前原生输出不支持这些处理设置。"));
  const precision = document.querySelector<HTMLElement>("#processing-precision-status");
  if (precision) {
    const expanded=precision.querySelector<HTMLDetailsElement>('.precision-inactive')?.open;
    const markup=audioPrecisionMarkup(playerState);
    if(precision.dataset.renderedMarkup!==markup){
      precision.innerHTML=markup;precision.dataset.renderedMarkup=markup;
      const inactive=precision.querySelector<HTMLDetailsElement>('.precision-inactive');if(inactive)inactive.open=expanded??false;
    }
  }
  const bitPerfect = document.querySelector<HTMLInputElement>('[data-processing-field="bitPerfect"]');
  const bitPerfectNote = document.querySelector<HTMLElement>("#bitperfect-capability-note");
  const bitPerfectUnavailable = rawDsdRoute || preferences.output.backend === 'browser';
  if (bitPerfect) bitPerfect.disabled = !processingSettings.bitPerfect && bitPerfectUnavailable;
  if (bitPerfectNote) {
    if (rawDsdRoute) bitPerfectNote.textContent = trUi("当前为 DSD 位流输出");
    else if (preferences.output.backend === "browser") bitPerfectNote.textContent = trUi("适用于 WASAPI 或 ASIO");
    else bitPerfectNote.textContent = processingSettings.bitPerfect?trUi('原采样率 · 无音效 · 音量 100%'):trUi('解码直通');
  }
  const bitPerfectLive = document.querySelector<HTMLElement>('#bitperfect-live-status');
  if (bitPerfectLive) {
    bitPerfectLive.hidden=!processingSettings.bitPerfect;
    const status=pcmConsistencyStatus(snapshot);
    bitPerfectLive.dataset.state=pcmConsistencyCode(snapshot)==='match'?'ok':pcmConsistencyCode(snapshot)==='mismatch'?'error':'pending';
    bitPerfectLive.textContent=ui`一致性校验 · ${status}`;
  }
  const preservePcm = processingSettings.bitPerfect && preferences.output.backend !== 'browser' && !rawDsdRoute;
  if (preservePcm) {
    const suspend = (control: HTMLInputElement | HTMLSelectElement) => { control.dataset.bitperfectDisabled = String(control.disabled); control.disabled = true; };
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-processing-field]').forEach(control => {
      if (/^(eq\.|tone\.|replayGain\.|resampling\.|transition\.)|^(outputFormat|dither|float64)$/.test(control.dataset.processingField ?? '')) suspend(control);
    });
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-processing-rate],[data-processing-rate-choice]').forEach(suspend);
    if (resamplingNote) resamplingNote.textContent = trUi('纯输出 · 原采样率');
    if (node) node.textContent = trUi('纯输出 · 声音处理关闭');
  }
  settingsSelectControls?.sync();
}

function eqResponseSampleRate(): { rate: number; source: "actual" | "track" | "default" } {
  const current = playerState;
  if (current?.currentTrack && (current.transport === "playing" || current.transport === "paused")) {
    const snapshot = current.nativeOutputStatus;
    if (snapshot?.backend === preferences.output.backend) {
      const stage = snapshot.processingStages?.find((item) =>
        (item.id === "eq" || item.id === "tone") && Number.isFinite(item.sampleRate) && (item.sampleRate ?? 0) > 0,
      );
      if (stage?.sampleRate) return { rate: stage.sampleRate, source: "actual" };
    }
  }
  const trackRate = current?.currentTrack?.sampleRate;
  if(current?.currentTrack&&isDsdTrack(current.currentTrack))return {rate:48000,source:'default'};
  if (Number.isFinite(trackRate) && (trackRate ?? 0) > 0) return { rate: trackRate!, source: "track" };
  return { rate: 48000, source: "default" };
}

function cloneProcessing(value: ProcessingSettings) {
  return JSON.parse(JSON.stringify(value)) as ProcessingSettings;
}

function cloneEqModeBanks(value: EqModeBanks) {
  return JSON.parse(JSON.stringify(value)) as EqModeBanks;
}

function cloneEq(value: ProcessingSettings["eq"]) {
  return JSON.parse(JSON.stringify(value)) as ProcessingSettings["eq"];
}

function processingUndoSnapshot(settings = processingSettings): ProcessingUndoSnapshot {
  return { settings: cloneProcessing(settings), eqBanks: cloneEqModeBanks(processingPresetStore.eqBanks) };
}

function sameProcessing(left: ProcessingSettings, right: ProcessingSettings) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameProcessingUndo(left: ProcessingUndoSnapshot, right: ProcessingUndoSnapshot) {
  return sameProcessing(left.settings, right.settings) && JSON.stringify(left.eqBanks) === JSON.stringify(right.eqBanks);
}

function pushProcessingUndo(value: ProcessingSettings | ProcessingUndoSnapshot) {
  const snapshot = "settings" in value ? { settings: cloneProcessing(value.settings), eqBanks: cloneEqModeBanks(value.eqBanks) } : processingUndoSnapshot(value);
  const previous = processingUndoStack.at(-1);
  if (!previous || !sameProcessingUndo(previous, snapshot)) processingUndoStack.push(snapshot);
  if (processingUndoStack.length > 24) processingUndoStack.shift();
  const undo = document.querySelector<HTMLButtonElement>('[data-processing-preset-action="undo"]');
  if (undo) undo.disabled = !processingUndoStack.length;
}

function finishProcessingEdit() {
  if (processingEditStart && !sameProcessingUndo(processingEditStart, processingUndoSnapshot())) pushProcessingUndo(processingEditStart);
  processingEditStart = undefined;
  const mode = processingSettings.eq.mode;
  if (JSON.stringify(processingPresetStore.eqBanks[mode]) !== JSON.stringify(processingSettings.eq)) {
    processingPresetStore.eqBanks[mode] = cloneEq(processingSettings.eq);
    saveProcessingPresetStore();
  }
  syncProcessingPresetUi();
}

function showProcessingPresetStatus(message: string, error = false) {
  if (processingSettings.eq.engine === "standard") {
    if (error) standardEqPresets?.show(message, true);
    return;
  }
  const node = document.querySelector<HTMLElement>("#processing-preset-status");
  if (node) {
    if (processingPresetWritePending && !error) {
      pendingProcessingPresetStatus = { message, error };
      node.textContent = trUi("正在保存音频预设到本机配置文件…");
      node.dataset.state = "pending";
      return;
    }
    node.textContent = message;
    node.dataset.state = error ? "error" : "normal";
  }
}

function saveProcessingPresetStore() {
  let serialized: string;
  try {
    serialized = JSON.stringify(processingPresetStore);
    localStorage.setItem(processingPresetKey, serialized);
  } catch {
    showProcessingPresetStatus(trUi("本机存储空间不足，预设没有保存。"), true);
    return false;
  }
  if (window.rhineDesktop?.native) {
    const persist = window.rhineDesktop.saveAudioProcessingPresets;
    if (!persist) {
      processingPresetPersistenceError = trUi("桌面预设文件接口不可用，未能确认设置已写入配置文件。");
      showProcessingPresetStatus(processingPresetPersistenceError, true);
      return false;
    }
    const revision = ++processingPresetWriteRevision;
    processingPresetWritePending = true;
    pendingProcessingPresetStatus = null;
    showProcessingPresetStatus(trUi("正在保存音频预设到本机配置文件…"));
    let writeRequest: Promise<{ ok: boolean; error?: string }>;
    try { writeRequest = persist(JSON.parse(serialized)); }
    catch (error) {
      processingPresetWritePending = false;
      processingPresetPersistenceError = ui`本机音频预设文件保存失败：${(error as Error).message}`;
      pendingProcessingPresetStatus = null;
      showProcessingPresetStatus(processingPresetPersistenceError, true);
      return false;
    }
    void writeRequest.then((result) => {
      if (revision !== processingPresetWriteRevision) return;
      processingPresetWritePending = false;
      if (!result?.ok) {
        processingPresetPersistenceError = result?.error || trUi("本机音频预设文件写入失败，已保留原文件。");
        pendingProcessingPresetStatus = null;
        showProcessingPresetStatus(processingPresetPersistenceError, true);
        return;
      }
      processingPresetPersistenceError = "";
      const completedStatus = pendingProcessingPresetStatus;
      pendingProcessingPresetStatus = null;
      showProcessingPresetStatus(completedStatus?.message || trUi("音频预设已保存到本机配置文件。"), completedStatus?.error || false);
    }).catch((error: unknown) => {
      if (revision !== processingPresetWriteRevision) return;
      processingPresetWritePending = false;
      processingPresetPersistenceError = ui`本机音频预设文件保存失败：${(error as Error).message}`;
      pendingProcessingPresetStatus = null;
      showProcessingPresetStatus(processingPresetPersistenceError, true);
    });
  }
  return true;
}

function syncProcessingPresetUi() {
  if (processingSettings.eq.engine === "standard") {
    standardEqPresets?.sync();
    const summary = document.querySelector<HTMLElement>("#eq-preset-summary");
    if (summary) summary.textContent = standardEqPresetState.selected?.name || processingSettings.eq.name;
    settingsSelectControls?.sync();
    return;
  }
  const select = document.querySelector<HTMLSelectElement>("#processing-preset-select");
  const selectedId = processingPresetStore.activeId || "current";
  if (select) {
    const options = [trUi(`<option value="current">当前设置</option>`), ...processingPresetStore.presets.map((preset) => `<option value="${esc(preset.id)}">${esc(preset.name)}${preset.kind === "imported" ? preset.format === "rhine" ? trUi(" · Rhine 备份") : trUi(" · Poweramp 原件") : ""}</option>` )];
    select.innerHTML = options.join("");
    select.value = selectedId;
  }
  const selected = processingPresetStore.presets.find((preset) => preset.id === selectedId);
  const summary = document.querySelector<HTMLElement>("#eq-preset-summary");
  if (summary) summary.textContent = selected?.name || processingSettings.eq.name || trUi("当前设置");
  const name = document.querySelector<HTMLInputElement>("#processing-preset-name");
  if (name && document.activeElement !== name) name.value = selected?.name || processingSettings.eq.name;
  const editable = selected?.kind === "saved";
  for (const action of ["save", "rename"] as const) {
    const button = document.querySelector<HTMLButtonElement>(`[data-processing-preset-action="${action}"]`);
    if (button) button.disabled = !editable;
  }
  const deletePreset = document.querySelector<HTMLButtonElement>('[data-processing-preset-action="delete"]');
  if (deletePreset) deletePreset.disabled = !selected;
  const restoreBackup = document.querySelector<HTMLButtonElement>('[data-processing-preset-action="restore-backup"]');
  if (restoreBackup) {
    const canRestore = selected?.kind === "imported" && selected.format === "rhine" && !!selected.backup;
    restoreBackup.hidden = !canRestore;
    restoreBackup.disabled = !canRestore;
  }
  const undo = document.querySelector<HTMLButtonElement>('[data-processing-preset-action="undo"]');
  if (undo) undo.disabled = !processingUndoStack.length;
  if (processingPresetPersistenceError) showProcessingPresetStatus(processingPresetPersistenceError, true);
  settingsSelectControls?.sync();
}

function updateProcessingControlValues() {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-processing-field]').forEach((control) => {
    if (document.activeElement === control) return;
    const value = control.dataset.processingField!.split(".").reduce<unknown>((current, key) => {
      if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
      return undefined;
    }, processingSettings);
    if (value === undefined) return;
    if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = value === true;
    else if (control.dataset.processingRateUnit === "khz") control.value = String(Number(value) / 1000);
    else if (control.dataset.processingPassbandUnit === "percent") control.value = String(Number(value) * 100);
    else control.value = String(value);
  });
  document.querySelectorAll<HTMLInputElement>('[data-processing-rate]').forEach((control) => {
    control.checked = processingSettings.resampling.allowedRates.includes(Number(control.dataset.processingRate));
  });
  eqControls?.render();
  settingsSelectControls?.sync();
  editableRanges?.sync();
}

function setProcessingSettings(value: ProcessingSettings, committed = true) {
  const before = cloneProcessing(processingSettings);
  if (!processingEditStart) processingEditStart = processingUndoSnapshot(before);
  try {
    processingSettings = normalizeProcessing(value, { clamp: false });
    lastProcessingError = "";
  } catch (error) {
    processingSettings = before;
    processingEditStart = undefined;
    lastProcessingError = (error as Error).message;
    showProcessingPresetStatus(lastProcessingError, true);
    return false;
  }
  (preferences.output as OutputWithProcessing).processing = processingSettings;
  if (before.eq.engine !== processingSettings.eq.engine) syncEqModePanels();
  document.querySelectorAll<HTMLInputElement>('[data-processing-field="eq.enabled"]').forEach(control => { control.checked = processingSettings.eq.enabled; });
  savePrefs();
  updateOutputUI();
  eqControls?.sync();
  editableRanges?.sync();
  if (processingApplyTimer) clearTimeout(processingApplyTimer);
  const applyRevision = ++processingApplyRevision;
  processingApplyPending = true;
  processingApplyTimer = setTimeout(() => {
    processingApplyTimer = undefined;
    const method = (player as unknown as { setProcessingSettings?: (settings: ProcessingSettings) => void | Promise<void> }).setProcessingSettings;
    if (!method) {
      if (applyRevision === processingApplyRevision) processingApplyPending = false;
      if (preferences.output.backend !== "browser") {
        const message = trUi("原生音频处理接口暂不可用。");
        setProcessingApplyStatus(message);
        showProcessingPresetStatus(message, true);
      }
      return;
    }
    const submitted = cloneProcessing(processingSettings);
    Promise.resolve(method.call(player, submitted)).then(() => {
      if (applyRevision !== processingApplyRevision) return;
      processingApplyPending = false;
      if (!sameProcessing(submitted, processingSettings)) return;
      if (preferences.output.backend === "browser") { updateProcessingSupportStatus(); return; }
      const snapshot = playerState?.nativeOutputStatus;
      if (snapshot?.backend === preferences.output.backend && snapshot.capabilities?.processing === false) {
        setProcessingApplyStatus(trUi("当前原生输出不支持这些处理设置。"));
        } else setProcessingApplyStatus(playerState?.processingPending ? trUi("切歌完成后应用新设置。") : trUi("设置已更新，可在音频链路中查看当前效果。"));
    }).catch((error: Error) => {
      if (applyRevision !== processingApplyRevision) return;
      processingApplyPending = false;
      if (preferences.output.backend === "browser") { updateProcessingSupportStatus(); return; }
      const message = ui`原生输出未能应用这些处理设置：${error.message}`;
      setProcessingApplyStatus(message);
      showProcessingPresetStatus(message, true);
    });
  }, 90);
  if (committed) finishProcessingEdit();
  return true;
}

function applyProcessingPreset(preset: ProcessingPresetRecord) {
  pushProcessingUndo(processingSettings);
  processingEditStart = undefined;
  if (preset.kind === "saved" && preset.eq) {
    processingSettings = normalizeProcessing({ ...processingSettings, eq: preset.eq }, { clamp: true });
  } else if (preset.kind === "imported" && preset.format === "rhine" && preset.backup) {
    processingSettings = normalizeProcessing({ ...processingSettings, eq: preset.backup.settings.eq }, { clamp: false });
  } else if (preset.kind === "imported" && preset.imported) {
    const currentTone = processingSettings.tone;
    processingSettings = normalizeProcessing({
      ...processingSettings,
      eq: { ...preset.imported.eq, lsp: processingSettings.eq.lsp },
      tone: preset.imported.tone ? { ...currentTone, bass: preset.imported.tone.bass, treble: preset.imported.tone.treble } : currentTone,
    }, { clamp: false });
  }
  processingPresetStore.eqBanks = {
    ...processingPresetStore.eqBanks,
    [processingSettings.eq.mode]: cloneEq(processingSettings.eq),
  };
  processingPresetStore.activeId = preset.id;
  (preferences.output as OutputWithProcessing).processing = processingSettings;
  savePrefs();
  saveProcessingPresetStore();
  updateProcessingControlValues();
  showProcessingPresetStatus(preset.kind !== "imported"
    ? ui`已载入“${preset.name}”。`
    : preset.format === "rhine"
      ? trUi("已载入备份中的 EQ；本机 Tone、ReplayGain 与输出设置已保留。可另选“恢复此备份的全部处理设置”。")
      : trUi("已载入 Poweramp 参数；原始文件保存在本机，音调开关保持原状态。"));
  syncProcessingPresetUi();
  if (processingApplyTimer) clearTimeout(processingApplyTimer);
  setProcessingSettings(processingSettings, true);
}

function restoreFullProcessingBackup(preset: ProcessingPresetRecord) {
  if (preset.kind !== "imported" || preset.format !== "rhine" || !preset.backup) return false;
  pushProcessingUndo(processingSettings);
  processingEditStart = undefined;
  try {
    processingSettings = normalizeProcessing({ ...preset.backup.settings, tone: preset.backup.tone }, { clamp: false });
    processingPresetStore.eqBanks = cloneEqModeBanks(preset.backup.eqModes);
    processingPresetStore.eqBanks[processingSettings.eq.mode] = cloneEq(processingSettings.eq);
  } catch (error) {
    showProcessingPresetStatus((error as Error).message, true);
    return false;
  }
  processingPresetStore.activeId = preset.id;
  (preferences.output as OutputWithProcessing).processing = processingSettings;
  savePrefs();
  saveProcessingPresetStore();
  updateProcessingControlValues();
  showProcessingPresetStatus(trUi("已恢复 Rhine 备份中的全部处理设置；当前输出设备与设备编号保持不变。可按“撤销”还原。"));
  setProcessingSettings(processingSettings, true);
  return true;
}

async function processingPresetAction(action: string) {
  try {
    if (["save", "save-as", "export"].includes(action)) await eqControls?.saveState();
    else if (["restore", "undo", "import", "restore-backup"].includes(action)) await eqControls?.beforeDestroy();
  } catch (error) { showProcessingPresetStatus((error as Error).message, true); return; }
  const selected = processingPresetStore.presets.find((preset) => preset.id === processingPresetStore.activeId);
  const nameControl = document.querySelector<HTMLInputElement>("#processing-preset-name");
  const name = nameControl?.value.trim() || "";
  if (action === "save") {
    if (!selected || selected.kind !== "saved") return;
    selected.eq = cloneEq(processingSettings.eq);
    selected.updatedAt = Date.now();
    if (!saveProcessingPresetStore()) return;
    showProcessingPresetStatus(ui`已保存“${selected.name}”。`);
  } else if (action === "save-as") {
    if (!name) { showProcessingPresetStatus(trUi("请先填写预设名称。"), true); nameControl?.focus(); return; }
    if (processingPresetStore.presets.some((preset) => preset.kind === "saved" && preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showProcessingPresetStatus(trUi("已有同名本机预设，请换一个名称。"), true); nameControl?.focus(); return;
    }
    const id = globalThis.crypto?.randomUUID?.() || `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    processingPresetStore.presets.push({ id, name, kind: "saved", eq: cloneEq(processingSettings.eq), updatedAt: Date.now() });
    processingPresetStore.activeId = id;
    if (!saveProcessingPresetStore()) { processingPresetStore.presets.pop(); processingPresetStore.activeId = null; return; }
    showProcessingPresetStatus(ui`已另存为“${name}”。`);
  } else if (action === "rename") {
    if (!selected || selected.kind !== "saved") return;
    if (!name) { showProcessingPresetStatus(trUi("请填写新的预设名称。"), true); nameControl?.focus(); return; }
    if (processingPresetStore.presets.some((preset) => preset.id !== selected.id && preset.kind === "saved" && preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showProcessingPresetStatus(trUi("已有同名本机预设，请换一个名称。"), true); nameControl?.focus(); return;
    }
    selected.name = name;
    selected.updatedAt = Date.now();
    if (!saveProcessingPresetStore()) return;
    showProcessingPresetStatus(ui`已重命名为“${name}”。`);
  } else if (action === "delete") {
    if (!selected) return;
    processingPresetStore.presets = processingPresetStore.presets.filter((preset) => preset.id !== selected.id);
    processingPresetStore.activeId = null;
    if (!saveProcessingPresetStore()) return;
    showProcessingPresetStatus(selected.kind === "imported"
      ? ui`已从本机预设库删除导入记录“${selected.name}”；原始文件不会被删除。`
      : ui`已删除“${selected.name}”。`);
  } else if (action === "restore") {
    pushProcessingUndo(processingSettings);
    processingEditStart = undefined;
    processingSettings = normalizeProcessing({ ...processingSettings, eq: processingDefault.eq });
    processingPresetStore.eqBanks = { [processingSettings.eq.mode]: cloneEq(processingSettings.eq) };
    processingPresetStore.activeId = null;
    (preferences.output as OutputWithProcessing).processing = processingSettings;
    savePrefs(); saveProcessingPresetStore();
    updateProcessingControlValues();
    showProcessingPresetStatus(trUi("已恢复默认均衡器设置。音调、播放增益和过渡设置已保留，可按“撤销”还原。"));
    setProcessingSettings(processingSettings, true);
  } else if (action === "undo") {
    const previous = processingUndoStack.pop();
    if (!previous) return;
    processingEditStart = undefined;
    processingSettings = normalizeProcessing(previous.settings, { clamp: true });
    processingPresetStore.eqBanks = cloneEqModeBanks(previous.eqBanks);
    processingPresetStore.activeId = null;
    (preferences.output as OutputWithProcessing).processing = processingSettings;
    savePrefs(); saveProcessingPresetStore();
    updateProcessingControlValues();
    showProcessingPresetStatus(trUi("已撤销上一步设置。"));
    setProcessingSettings(processingSettings, true);
  } else if (action === "import") {
    document.querySelector<HTMLInputElement>("#processing-preset-file")?.click();
  } else if (action === "restore-backup") {
    if (selected) restoreFullProcessingBackup(selected);
  } else if (action === "export") {
    try {
      const banks = cloneEqModeBanks(processingPresetStore.eqBanks);
      banks[processingSettings.eq.mode] = cloneEq(processingSettings.eq);
      const payload = serializeRhineProcessingBackup(processingSettings, banks);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "Rhine-audio-settings.json";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showProcessingPresetStatus(trUi("已导出 Rhine 完整备份 JSON，音调与 EQ 模式配置分别保存；此文件不是 Poweramp 导出格式。"));
    } catch (error) { showProcessingPresetStatus((error as Error).message, true); }
  }
  syncProcessingPresetUi();
}

async function importProcessingFile(file: File) {
  if (file.size > 4 * 1024 * 1024) { showProcessingPresetStatus(trUi("预设文件超过 4 MB，未导入。"), true); return; }
  try {
    const sourceText = await file.text();
    const encoder = new TextEncoder();
    const existingSourceSize = processingPresetStore.presets.reduce((size, preset) => size + (preset.kind === "imported" && preset.sourceText ? encoder.encode(preset.sourceText).byteLength : 0), 0);
    if (existingSourceSize + encoder.encode(sourceText).byteLength > 4 * 1024 * 1024) throw new RangeError(trUi("本机原始导入文本已达到容量上限，无法再添加；原有导入仍保留。"));
    const importedPreset = parseProcessingImport(sourceText);
    const id = globalThis.crypto?.randomUUID?.() || `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const name = importedPreset.format === "rhine" ? importedPreset.backup.name : importedPreset.imported.eq.name || file.name || trUi("Poweramp 导入");
    const record: ProcessingPresetRecord = { id, name, kind: "imported", ...importedPreset, sourceText, updatedAt: Date.now() };
    processingPresetStore.presets.push(record);
    if (!saveProcessingPresetStore()) { processingPresetStore.presets = processingPresetStore.presets.filter((preset) => preset.id !== id); return; }
    applyProcessingPreset(record);
    showProcessingPresetStatus(importedPreset.format === "rhine"
      ? ui`已导入 Rhine 备份“${name}”并应用 EQ；完整处理设置未自动覆盖。本机原始文件已保留。`
      : ui`已导入 Poweramp 预设“${name}”；原始文件已保存在本机。`);
  } catch (error) {
    showProcessingPresetStatus((error as Error).message, true);
  } finally {
    const input = document.querySelector<HTMLInputElement>("#processing-preset-file");
    if (input) input.value = "";
  }
}

function updateProcessingField(control: HTMLInputElement | HTMLSelectElement) {
  const path = control.dataset.processingField;
  if (!path) return false;
  if (!processingEditStart) processingEditStart = processingUndoSnapshot();
  const next = cloneProcessing(processingSettings) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let owner: Record<string, unknown> = next;
  for (const key of keys.slice(0, -1)) owner = owner[key] as Record<string, unknown>;
  let value: unknown;
  if (control instanceof HTMLInputElement && control.type === "checkbox") value = control.checked;
  else if (control.dataset.processingRateUnit === "khz") value = Math.round(Number(control.value) * 1000);
  else if (control.dataset.processingPassbandUnit === "percent") value = Number(control.value) / 100;
  else if ((control instanceof HTMLInputElement && ["number", "range"].includes(control.type)) || control.dataset.processingNumber === "true") value = Number(control.value);
  else value = control.value;
  owner[keys.at(-1)!] = value;
  try {
    if (!setProcessingSettings(next as unknown as ProcessingSettings, false)) throw new Error(lastProcessingError || trUi("音频参数未更新，请检查输入范围。"));
    control.setCustomValidity("");
    control.removeAttribute("aria-invalid");
    control.title = "";
    return true;
  } catch (error) {
    control.setCustomValidity((error as Error).message);
    control.setAttribute("aria-invalid", "true");
    control.title = (error as Error).message;
    return false;
  }
}

function entrySettingsMarkup() {
  const future = preferences.style.design === "rhine";
  const disabled = future ? "" : "disabled";
  const fields = ([
    ["entryWelcome", "entry-welcome", trUi("欢迎文案")],
    ["entryIdentity", "entry-identity", trUi("欢迎 ID")],
  ] as const).map(([key, id, label]) => `<label class="entry-text-field" for="${id}"><span>${label}<output data-entry-count="${key}" aria-hidden="true">${preferences[key].length} / ${ENTRY_TEXT_MAX_LENGTH}</output></span><input type="text" id="${id}" data-entry-text="${key}" value="${esc(preferences[key])}" maxlength="${ENTRY_TEXT_MAX_LENGTH}" pattern="[A-Za-z]+( [A-Za-z]+)*" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="entry-text-help entry-text-status" ${disabled}></label>`).join("");
  return ui`<section class="panel-section" id="entry-settings"><h3>终端入场 <small>FUTURE</small></h3>${!future ? trUi('<p class="entry-unavailable-note">Punk 入场动画后续适配，当前仅保留设置入口。</p>') : ""}<label class="settings-row"><span>每次打开窗口时播放入场<small>关闭后直接进入总览，仍可手动重播。</small></span><input type="checkbox" id="entry-on-open" ${preferences.entryOnOpen ? "checked" : ""} ${disabled}></label><div class="entry-text-fields">${fields}</div><p id="entry-text-help">仅限英文字母 A–Z/a–z 和单词间空格，最多 24 个字符（含空格）。离开输入框时自动保存，留空恢复默认。</p><div class="entry-settings-actions"><button type="button" class="text-button" data-action="entry-replay" aria-describedby="entry-replay-note">重播入场 ↗</button><button type="button" class="text-button" data-action="entry-text-reset" ${disabled}>恢复默认文案与 ID ↗</button></div><p id="entry-replay-note"></p><p id="entry-text-status" role="status" aria-live="polite"></p></section>`;
}

function renderSettingsPage() {
  cleanupAlbumInfoSources?.();
  cleanupAlbumInfoSources = undefined;
  const content = $("#settings-page-content");
  cleanupQualityDetection?.();
  cleanupQualityDetection = undefined;
  cleanupGpuSettings?.();
  cleanupGpuSettings = undefined;
  settingsSelectControls?.destroy();
  settingsSelectControls = undefined;
  void eqControls?.destroy().catch((error: Error) => notify(error.message));
  eqControls = undefined;
  standardEqPresets?.destroy();
  standardEqPresets = undefined;
  lyricsSettings?.destroy();
  lyricsSettings = undefined;
  content.innerHTML =
    ui`<section class="panel-section" id="interface-settings"><h3>界面语言</h3><p>主题、配色与唱片盒外观在 STYLE 中调整。</p><button type="button" class="text-button" data-action="theme">打开 STYLE ↗</button></section>
    ${motionSettingsMarkup(renderQuality, preferences.style.design, musicApplication.view.layout, preferences.reduced)}
    ${displaySettingsMarkup(renderQuality, preferences.style.design, musicApplication.view.layout, preferences.windowAspect)}
    <section class="panel-section" id="library-sort-settings"><h3>音乐库排列</h3><label class="settings-row"><span>排列方式<small>${uiLanguage() === "en" ? "Shared with browse toolbar" : "与浏览工具栏共享设置"}</small></span><select id="music-sort" aria-label="音乐库排列方式">${(["genre", "artist", "album"] as MusicSortMode[]).map((value) => `<option value="${value}" ${musicArrangementPreset() === value ? "selected" : ""}>${sortLabels[value].name}</option>`).join("")}<option value="custom" disabled ${musicArrangementPreset() === "custom" ? "selected" : ""}>${trUi("自定义")}</option></select></label><p>${uiLanguage() === "en" ? "More grouping and sorting options are available in the album browse toolbar." : "更多分组与排序选项可在唱片浏览页工具栏中调整。"}</p></section>
    <section class="panel-section" id="introduction-settings"><h3>专辑介绍</h3><p>从公开百科查询并更新专辑介绍，附上资料来源。介绍保存在本机，不需要配置 MusicBrainz 联系信息；音乐文件不会上传。</p><p id="introduction-coverage"></p><button class="primary-button" id="introduction-refresh" data-action="introductions-library">查询 / 更新专辑介绍 ↗</button><progress id="introduction-progress" aria-label="专辑介绍查询进度" max="1" value="0" hidden></progress><p id="introduction-status" class="scan-status" role="status" aria-live="polite"></p><details id="introduction-missing" hidden><summary></summary><ul></ul></details></section>
    <section class="panel-section" id="current-audio-settings"><h3>当前音源</h3><p id="current-audio-source"></p><p>歌曲文件的格式与音质信息。播放时的处理和输出方式可在音频链路中查看。</p><button class="text-button" data-action="audio-info">查看音频链路 ↗</button></section>
    <section class="panel-section" id="decoder-settings"><h3>解码与格式转换</h3><p id="audio-decode-summary" class="audio-live-summary"></p><p>原生播放时，FLAC 由 libFLAC 解码，其他 PCM 音源由 FFmpeg 解码。保持音源采样率进入处理链；解码样本格式与计算精度分别显示。DSD 使用下方独立播放路线。</p><p id="processing-support-status" class="processing-support-note" role="status"></p></section>
    ${dsdRouteSettingsMarkup()}
    ${outputSettingsMarkup()}
    ${sonySettingsMarkup()}
    ${ftpSettingsMarkup()}
    ${replayGainMarkup()}
    <section class="panel-section" id="sound-settings"><h3>音乐音量</h3><p id="audio-volume-summary" class="audio-live-summary"></p><label class="settings-row"><span>歌曲音量</span><input type="range" id="volume" aria-label="歌曲音量" min="0" max="100" value="${Math.round(preferences.volume * 100)}"></label><label class="settings-row" data-compat-transition ${preferences.output.backend==='browser'?'':'hidden'}><span>兼容播放切歌淡变<small>先淡出当前歌曲，再淡入下一首</small></span><input type="checkbox" id="song-fade-setting" ${preferences.songFade ? "checked" : ""}></label></section>
    ${transitionMarkup()}
    ${resamplingMarkup()}
    ${precisionMarkup()}
    ${bufferMarkup()}
    ${entrySettingsMarkup()}
    <section class="panel-section" id="interface-sound-settings"><h3>界面声音与氛围</h3>
      <p id="interface-sound-status" class="interface-audio-note" role="status"></p>
      <label class="settings-row"><span>界面音效<small>按钮、卡片和页面切换的提示音</small></span><input type="checkbox" id="sound-setting" ${preferences.sound ? "checked" : ""}></label>
      <label class="settings-row"><span>音效音量</span><input type="range" id="sound-volume" aria-label="音效音量" min="0" max="100" value="${Math.round(preferences.soundVolume * 100)}"></label>
      <button class="text-button" data-action="sound-preview">试听界面音效 ↗</button>
      <p id="interface-bgm-status" class="interface-audio-note" hidden></p>
      <label class="settings-row"><span>氛围 BGM<small>音乐停止时播放，开始播放歌曲后淡出</small></span><input type="checkbox" id="bgm-setting" ${preferences.bgm ? "checked" : ""}></label>
      <label class="settings-row"><span>BGM 音量</span><input type="range" id="bgm-volume" aria-label="BGM 音量" min="0" max="100" value="${Math.round(preferences.bgmVolume * 100)}"></label>
    </section>
    <section class="panel-section" id="lyrics-global-settings"></section>
    <section class="panel-section" id="about-settings"><h3>项目与许可</h3><p>音乐适配与维护：<a href="https://github.com/RonaldDeng/Rhine-Music-Demo" target="_blank" rel="noopener">RonaldDeng ↗</a><br>原版界面：<a href="https://github.com/LBEILC/RhineLabUI" target="_blank" rel="noopener">LBEILC / RhineLabUI ↗</a></p><p><a href="/licenses/project-mit.txt" target="_blank" rel="noopener">代码 MIT 许可 ↗</a> · <a href="https://github.com/RonaldDeng/Rhine-Music-Demo/blob/v0.2.0/NOTICE.md" target="_blank" rel="noopener">版权与资源说明 ↗</a></p><a href="/?original=1&scene=archive" target="_blank" rel="noopener">打开原版档案界面 ↗</a><p><a href="/fonts/MiSans-license.pdf" target="_blank" rel="noopener">MiSans 字体许可 ↗</a></p></section>`;
  content.querySelector('#about-settings')?.insertAdjacentHTML('beforeend',trUi('<button type="button" class="text-button known-issues-button" data-action="known-issues">已知问题</button>'));
  if (preferences.style.design === "archive") content.querySelector('#about-settings')?.insertAdjacentHTML('beforeend',ui`<p><a href="/licenses/audio-archive-style-mit.txt" target="_blank" rel="noopener">Audio Archive · MIT ↗</a> · <a href="/licenses/geistmono-ofl.txt" target="_blank" rel="noopener">Geist Mono · SIL OFL ↗</a></p>`);
  content.querySelector('#interface-settings')?.insertAdjacentHTML('beforeend', ui`<label class="settings-row"><span>界面语言<small>切换后重新载入界面</small></span><select id="ui-language" aria-label="界面语言"><option value="zh-CN" ${uiLanguage()==='zh-CN'?'selected':''}>简体中文</option><option value="en" ${uiLanguage()==='en'?'selected':''}>English</option></select></label><button type="button" class="text-button" data-action="apply-language">应用语言 ↗</button>`);
  content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(control => control.setAttribute("role", "switch"));
  syncEntrySettings();
  entryTextControls.sync();
  content.insertAdjacentHTML("beforeend", ui`<section class="panel-section" id="library-management-settings"><h3>导入与目录管理</h3><div id="library-page-body" class="library-settings-body" role="region" aria-label="音乐库导入与目录管理"></div></section>`);
  const categories = settingsCategories.map((category) => {
    const section = document.createElement("section");
    section.className = "settings-category";
    section.dataset.settingsCategory = category.id;
    section.setAttribute("aria-labelledby", `settings-category-${category.id}`);
    section.innerHTML = `<h2 id="settings-category-${category.id}" tabindex="-1">${category.title}</h2><p class="settings-category-intro">${category.intro}</p>`;
    for (const selector of category.sections) {
      const controls = content.querySelector(selector);
      if (controls) section.append(controls);
    }
    if (category.id === "audio") {
      for (const [index, audioSection] of audioSettingsSections.entries()) {
        const group = document.createElement("section");
        group.id = `audio-settings-${audioSection.id}`;
        group.className = "audio-settings-section";
        group.dataset.audioSettingsSection = audioSection.id;
        group.setAttribute("aria-labelledby", `${group.id}-heading`);
        group.innerHTML = `<h3 id="${group.id}-heading" class="audio-settings-section-heading" tabindex="-1"><small>${String(index + 1).padStart(2, "0")}</small>${audioSection.title}</h3>`;
        for (const selector of audioSection.sections) {
          const controls = section.querySelector(selector);
          if (controls) group.append(controls);
        }
        section.append(group);
      }
    }
    return section;
  });
  content.replaceChildren(...categories);
  lyricsSettings = setupLyricsSettings($("#lyrics-global-settings"), {
    chooseDirectory: async () => {
      if (!window.rhineDesktop?.chooseLyricsCacheFolder) { notify(trUi("请在桌面应用中选择歌词缓存文件夹。")); return null; }
      return window.rhineDesktop.chooseLyricsCacheFolder(uiLanguage());
    }, notify,
  });
  settingsSelectControls = enhanceSettingsSelectControls(content);
  syncQualityUI(renderQuality, true);
  const albumSourcesSection = content.querySelector<HTMLElement>("#introduction-settings");
  if (albumSourcesSection) {
    const host = document.createElement("div");
    host.id = "album-info-sources-settings";
    albumSourcesSection.append(host);
    cleanupAlbumInfoSources = albumInfoEditor.mountSources(host);
  }
  syncQualitySummary();
  syncFullscreenUI();
  selectSettingsCategory(settingsCategory);
  content.scrollTop = settingsScrollPositions.get(settingsCategory) ?? 0;
  markAudioSettingsSection(audioSettingsSection);
  syncAudioSettingsLocation();
  updateCurrentAudioSummary();
  updateIntroductionStatus();
  updateSonyUI();
  void refreshSonyStatus();
  void refreshFtpStatus();
  updateOutputUI();
  updateProcessingSupportStatus();
  syncProcessingPresetUi();
  if (processingRestoreError) showProcessingPresetStatus(ui`之前保存的音频设置无法读取，已载入默认值：${processingRestoreError}`, true);
  editableRanges?.sync();
  void refreshNativeStatus();
}

function syncPunkEqTypography() {
  if(preferences.style.design!=="archive")return;
  syncPunkEqInstruments($("#eq-page-content"));
  $("#eq-page-content").querySelectorAll<HTMLElement>('button,label > span,.settings-row > span,.eq-band-index,summary,figcaption,.eq-mode-description,#tone-settings h3,#tone-settings h4,#tone-settings p').forEach(node=>{
    node.dataset.punkCjk=String(containsCjk(node.textContent??''));
  });
}
function syncEqModePanels() {
  const content = document.querySelector<HTMLElement>("#eq-page-content");
  if (!content) return;
  const standard = processingSettings.eq.engine === "standard";
  const changed = content.dataset.eqPresetEngine !== processingSettings.eq.engine;
  content.dataset.eqPresetEngine = processingSettings.eq.engine;
  for (const selector of ["[data-standard-eq-presets-slot]", "#tone-settings"]) {
    const element = content.querySelector<HTMLElement>(selector);
    if (element) element.hidden = !standard;
  }
  const advanced = content.querySelector<HTMLElement>("[data-processing-presets-slot]");
  if (advanced) advanced.hidden = standard;
  standardEqPresets?.sync();
  if (changed && standard) void standardEqPresets?.refresh();
  syncProcessingPresetUi();
}
function renderEqPage() {
  const content = $("#eq-page-content");
  settingsSelectControls?.destroy();
  void eqControls?.destroy().catch((error: Error) => notify(error.message));
  standardEqPresets?.destroy();
  content.innerHTML = ui`<details class="eq-preset-disclosure" ${eqPresetsExpanded ? "open" : ""}><summary>预设与保存 <span id="eq-preset-summary">${esc(processingSettings.eq.name)}</span></summary><div data-standard-eq-presets-slot ${processingSettings.eq.engine === "standard" ? "" : "hidden"}>${standardEqPresetMarkup()}</div><div data-processing-presets-slot ${processingSettings.eq.engine === "standard" ? "hidden" : ""}></div></details><p class="processing-support-note" data-processing-apply-status role="status">${esc(processingApplyMessage)}</p><div id="eq-page-editor">${renderEqControls(processingSettings)}</div><section class="eq-tone-section" id="tone-settings" aria-labelledby="eq-tone-title" ${processingSettings.eq.engine === "standard" ? "" : "hidden"}><h3 id="eq-tone-title">低音与高音</h3><p>独立于均衡器开关；低音和高音增益均为 0 dB 时不改变声音。</p>${renderToneControls(processingSettings)}</section>`;
  mountProcessingPresets(content);
  standardEqPresets = setupStandardEqPresets($("#standard-eq-presets"), standardEqPresetState, {
    request: window.rhineDesktop?.standardEqPresets,
    getSettings: () => processingSettings,
    apply: async (parsed) => {
      if (processingSettings.eq.engine !== "standard") return;
      await eqControls?.beforeDestroy();
      const next = normalizeProcessing({ ...processingSettings,
        eq: { ...parsed.eq, engine: "standard", lsp: processingSettings.eq.lsp },
        tone: parsed.tone ? { ...processingSettings.tone, ...parsed.tone } : processingDefault.tone,
      }, { clamp: false });
      if (!setProcessingSettings(next, true)) throw new Error(lastProcessingError);
      updateProcessingControlValues();
    },
    restore: () => {
      setProcessingSettings(normalizeProcessing({ ...processingSettings, eq: { ...processingDefault.eq, lsp: processingSettings.eq.lsp }, tone: processingDefault.tone }), true);
      updateProcessingControlValues();
    },
    undo: () => processingPresetAction("undo"),
    canUndo: () => processingUndoStack.length > 0,
    legacy: () => processingPresetStore.presets.filter(preset => (preset.eq || preset.imported?.eq || preset.backup?.settings.eq)?.engine !== "lsp").map(preset => ({ id: preset.id, name: preset.name })),
    loadLegacy: async (id) => {
      const preset = processingPresetStore.presets.find(preset => preset.id === id);
      if (preset) applyProcessingPreset(preset);
    },
    changed: () => { syncProcessingPresetUi(); syncPunkEqTypography(); },
  });
  settingsSelectControls = enhanceSettingsSelectControls(content);
  eqControls = setupEqControls(
    $("#processing-eq-controls"),
    () => processingSettings,
    (value, committed = true) => {
      const previousMode = processingSettings.eq.mode;
      if (value.eq.mode !== previousMode) {
        if (!processingEditStart) processingEditStart = processingUndoSnapshot();
        processingPresetStore.eqBanks[previousMode] = cloneEq(processingSettings.eq);
        processingPresetStore.eqBanks[value.eq.mode] = cloneEq(value.eq);
        saveProcessingPresetStore();
      }
      setProcessingSettings(value, committed);
    },
    (current, targetMode) => processingPresetStore.eqBanks[targetMode]
      ? { ...cloneEq(processingPresetStore.eqBanks[targetMode]!), engine: current.eq.engine, lsp: structuredClone(current.eq.lsp) }
      : undefined,
    eqResponseSampleRate,
  );
  syncPunkEqTypography();
  syncEqModePanels();
  content.scrollTop = eqPageScrollTop;
  syncProcessingPresetUi();
  updateProcessingSupportStatus();
  editableRanges?.sync();
  void refreshNativeStatus();
}
function updateCurrentAudioSummary() {
  const summary = document.querySelector("#current-audio-source");
  if (summary) summary.textContent = audioSourceSummary(playerState);
  const button = document.querySelector<HTMLButtonElement>('#current-audio-settings [data-action="audio-info"]');
  if (button) button.disabled = !playerState?.currentTrack;
  if (!playerState) return;
  const signal = audioSignalSummary(playerState, nativeStatus);
  for (const [selector, view] of [["#audio-decode-summary", signal.decoder], ["#audio-volume-summary", signal.volume], ["#audio-output-summary", signal.output], ["#audio-device-summary", signal.device], ["#sony-live-path", audioSonySummary(playerState)]] as const) {
    const row = document.querySelector(selector);
    if (row) row.textContent = playerState.currentTrack ? `${view.value} · ${view.detail}` : trUi("播放歌曲后显示音频信息。");
  }
  const dsdSummary = document.querySelector<HTMLElement>("#dsd-route-summary");
  if (dsdSummary) {
    const output = preferences.output;
    let target: string;
    if (output.backend === "browser") {
      target = trUi("浏览器兼容播放 · 转为 PCM");
    } else if (output.backend === "wasapi") {
      const mode = output.wasapiDsdMode ?? "pcm";
      target = mode === "dop"
        ? output.wasapiMode === "exclusive"
          ? trUi("WASAPI 独占 · DoP")
          : trUi("WASAPI DoP · 请开启独占模式")
        : trUi("WASAPI · 转为 PCM");
    } else {
      target = `ASIO ${output.dsdMode === "native" ? trUi("原生 DSD") : output.dsdMode === "dop" ? "DoP" : trUi("DSD 转 PCM")}`;
    }
    const track = playerState.currentTrack;
    if (!track) {
      dsdSummary.textContent = ui`DSD 播放方式：${target}。播放 DSD 歌曲后显示实际输出。`;
    } else if (isDsdTrack(track)) {
      dsdSummary.textContent = `${signal.decoder.value} · ${signal.decoder.detail}`;
    } else {
      dsdSummary.textContent = trUi("当前歌曲不是 DSD，下面的设置仅用于 DSD 曲目。");
    }
  }
}
function dsdRouteSettingsMarkup() {
 const wasapiDsdMode=preferences.output.wasapiDsdMode??'pcm';
 return ui`<section class="panel-section" id="dsd-route-settings"><h3>DSD 播放路线</h3><p id="dsd-route-summary" class="audio-live-summary"></p>
 <label class="settings-row" data-output-backend="wasapi"><span>WASAPI DSD 方式<small>DoP 需要 WASAPI 独占模式</small></span><select id="output-wasapi-dsd" aria-label="WASAPI DSD 播放方式"><option value="pcm" ${wasapiDsdMode==='pcm'?'selected':''}>转换为 PCM</option><option value="dop" ${wasapiDsdMode==='dop'?'selected':''}>DoP</option></select></label>
 <p id="wasapi-dsd-status" class="dsd-route-note" data-output-backend="wasapi"></p>
 <label class="settings-row" data-output-backend="asio"><span>ASIO DSD 播放方式</span><select id="output-dsd" aria-label="ASIO DSD 播放方式">${[['pcm',trUi('转 PCM')],['native',trUi('原生 DSD')],['dop','DoP']].map(([value,name])=>`<option value="${value}" ${preferences.output.dsdMode===value?'selected':''}>${name}</option>`).join('')}</select></label>
 <p class="dsd-route-note" data-output-backend="asio">“原生 DSD”和“DoP”需要驱动与解码器支持；播放时请使用设备调节音量。</p>
 <p class="dsd-route-note" data-output-backend="browser">浏览器兼容播放使用 PCM 路线；这里不提供原生 DSD 或 DoP 直出配置。</p></section>`;
}
function outputSettingsMarkup() {
 const choices=window.rhineDesktop?.native?[['wasapi','WASAPI'],['asio','ASIO']]:[['browser',trUi('浏览器兼容播放')],['wasapi','WASAPI'],['asio','ASIO']];
 return ui`<section class="panel-section" id="output-settings"><h3>音频输出</h3><p id="native-component-status" role="status">正在读取输出设备…</p>
 <p id="audio-output-summary" class="audio-live-summary"></p><p id="audio-device-summary" class="audio-live-summary"></p>
 <label class="settings-row"><span>输出方式</span><select id="output-backend" aria-label="音频输出方式">${choices.map(([value,name])=>`<option value="${value}" ${preferences.output.backend===value?'selected':''}>${name}</option>`).join('')}</select></label>
  <label class="settings-row" data-output-backend="wasapi"><span>WASAPI 设备<small>系统默认设备在打开歌曲时解析；默认设备变化后请重新打开歌曲</small></span><select id="output-wasapi-device" aria-label="WASAPI 输出设备"><option value="default">系统默认设备</option></select></label>
  <p id="wasapi-device-session-note" class="processing-support-note" role="status" data-output-backend="wasapi"></p>
 <label class="settings-row" data-output-backend="wasapi"><span>独占模式<small id="wasapi-mode-setting"></small></span><input id="output-wasapi-exclusive" type="checkbox" role="switch" aria-describedby="wasapi-mode-setting" ${preferences.output.wasapiMode==='exclusive'?'checked':''}></label>
 <p id="wasapi-output-format-note" class="processing-support-note" role="note" data-output-backend="wasapi"></p>
 <label class="settings-row" data-output-backend="asio"><span>ASIO 驱动</span><select id="output-device" aria-label="ASIO 驱动"><option value="-1">请选择已安装的驱动</option></select></label>
 <label class="settings-row" data-output-backend="asio"><span>ASIO 第一输出通道<small>从 1 开始，双声道使用相邻两个通道</small></span><input id="output-channel" type="number" min="1" max="256" value="${preferences.output.channel+1}" aria-label="ASIO 第一输出通道"></label>
 <div class="output-format-shortcuts"><button class="text-button" data-action="audio-settings-jump" data-audio-settings-target="resampling">设置输出采样率 ↗</button><button class="text-button" data-action="audio-settings-jump" data-audio-settings-target="precision">设置输出位深 ↗</button></div>
 <button class="text-button" data-action="native-refresh">停止播放并刷新设备</button><p id="native-playback-status" role="status"></p>
 <p data-output-backend="browser">浏览器兼容播放的输出设备由浏览器和系统管理。</p>
 <p>共享模式可与其他应用一起播放；独占模式仅在音乐播放期间占用设备，暂停、停止、播放结束或出错后释放。继续播放时重新打开所选设备。</p></section>`;
}
function updateOutputUI() {
 const output=preferences.output,native=output.backend!=='browser',asio=output.backend==='asio',wasapi=output.backend==='wasapi';
 const directPcm=wasapi&&processingSettings.bitPerfect;
 const effectiveMode=directPcm?'exclusive':output.wasapiMode;
 const component=document.querySelector('#native-component-status');
 if(component)component.textContent=nativeStatus?nativeStatus.available?ui`音频输出可用 · ${nativeStatus.wasapiDevices?.length??0} 个 WASAPI 设备 · ${nativeStatus.devices.length} 个 ASIO 驱动${wasapi&&!nativeStatus.wasapiAvailable?` · ${nativeStatus.wasapiError||trUi('WASAPI 当前不可用')}`:''}`:nativeStatus.error||trUi('无法读取输出设备，请刷新设备列表。'):trUi('正在读取输出设备…');
 document.querySelectorAll<HTMLElement>('[data-output-backend]').forEach(row=>{row.hidden=row.dataset.outputBackend!==output.backend;});
 const wasapiSelector=document.querySelector<HTMLSelectElement>('#output-wasapi-device');
 if(wasapiSelector){const entries=nativeStatus?.wasapiDevices??[];wasapiSelector.innerHTML=trUi('<option value="default">系统默认设备</option>')+entries.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}${d.isDefault?trUi(' · 系统默认'):''}</option>`).join('')+(output.wasapiDevice!=='default'&&!entries.some(d=>d.id===output.wasapiDevice)?ui`<option value="${esc(output.wasapiDevice)}">上次选择的设备（未连接）</option>`:'');wasapiSelector.value=output.wasapiDevice;wasapiSelector.disabled=!wasapi||!nativeStatus?.wasapiAvailable;}
  const wasapiSnapshot=playerState?.nativeOutputStatus?.backend==='wasapi'&&['playing','paused'].includes(playerState.transport)?playerState.nativeOutputStatus:undefined;
  const currentDefaultId=nativeStatus?.wasapiDevices?.find(device=>device.isDefault)?.id;
  const defaultChanged=output.wasapiDevice==='default'&&!!wasapiSnapshot?.deviceId&&!!currentDefaultId&&wasapiSnapshot.deviceId!==currentDefaultId;
  const deviceSessionNote=document.querySelector<HTMLElement>('#wasapi-device-session-note');
  if(deviceSessionNote)deviceSessionNote.textContent=defaultChanged
    ?trUi('Windows 默认播放设备已变化；当前歌曲仍使用打开时的设备。重新打开歌曲后应用新默认设备。')
    :output.wasapiDevice==='default'
      ?trUi('系统默认设备只在打开歌曲时解析；之后默认设备变化需重新打开歌曲。')
      :trUi('所选设备在歌曲打开时使用；设备变化后请重新打开歌曲。');
 const exclusive=document.querySelector<HTMLInputElement>('#output-wasapi-exclusive');if(exclusive){exclusive.checked=effectiveMode==='exclusive';exclusive.disabled=directPcm||!wasapi||!nativeStatus?.wasapiAvailable;}
 const wasapiModeNote=document.querySelector('#wasapi-mode-setting');if(wasapiModeNote)wasapiModeNote.textContent=directPcm?trUi('纯输出 · 自动独占'):effectiveMode==='exclusive'?trUi('独占设备'):trUi('共享设备 · Windows 混音');
 const wasapiFormatNote=document.querySelector<HTMLElement>('#wasapi-output-format-note');
 if(wasapiFormatNote)wasapiFormatNote.textContent=effectiveMode==='exclusive'
   ?trUi('独占模式会按请求的采样率和 PCM 格式打开设备；设备不支持时会报告播放错误，不会静默改用其他采样率或位深。')
   :trUi('共享模式由 Windows 系统混音。最终采样率与位深受 Windows“更多声音设置 > 播放设备属性 > 高级”中的默认格式影响，播放器设置的值可能经系统混音。');
 const selector=document.querySelector<HTMLSelectElement>('#output-device');
 if(selector){const entries=nativeStatus?.devices??[];selector.innerHTML=trUi('<option value="-1">请选择已安装的驱动</option>')+entries.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')+(output.device>=0&&!entries.some(d=>d.id===output.device)?ui`<option value="${output.device}">上次选择的设备（未连接）</option>`:'');selector.value=String(output.device);selector.disabled=!asio||!nativeStatus?.available;}
 const channel=document.querySelector<HTMLInputElement>('#output-channel');if(channel)channel.disabled=!asio||!nativeStatus?.available;
 const dsd=document.querySelector<HTMLSelectElement>('#output-dsd');if(dsd)dsd.disabled=!asio;
 const wasapiDsd=document.querySelector<HTMLSelectElement>('#output-wasapi-dsd');
 if(wasapiDsd){
   const mode=output.wasapiDsdMode??'pcm';
   const dopOption=wasapiDsd.querySelector<HTMLOptionElement>('option[value="dop"]');
   if(dopOption)dopOption.disabled=output.wasapiMode!=='exclusive';
   wasapiDsd.value=mode;
   wasapiDsd.disabled=!wasapi;
 }
 const wasapiDsdStatus=document.querySelector<HTMLElement>('#wasapi-dsd-status');
 if(wasapiDsdStatus){
   wasapiDsdStatus.textContent=(output.wasapiDsdMode??'pcm')==='dop'
     ?output.wasapiMode==='exclusive'
       ?trUi('DoP 保留 DSD 数据，使用 PCM 格式传输。需要支持 DoP 的 DAC，音量请在设备上调节。')
       :trUi('DoP 需要独占模式。请到“输出与设备”开启独占，或选择“转换为 PCM”。')
     :trUi('转换为 PCM 可使用播放器音效和音量调节。选择 DoP 时，需要开启独占并使用支持 DoP 的 DAC。');
 }
 const backend=document.querySelector<HTMLSelectElement>('#output-backend');if(backend)for(const option of backend.options)option.disabled=option.value==='wasapi'?!nativeStatus?.wasapiAvailable:option.value==='asio'?!nativeStatus?.available:false;
 const locked=playerState?.volumeLocked===true,volume=document.querySelector<HTMLInputElement>('#volume');if(volume){volume.disabled=locked;volume.value=String(locked?100:Math.round(preferences.volume*100));volume.title=locked?trUi('数字音量已锁定，请使用设备调节'):'';}
 const fade=document.querySelector<HTMLInputElement>('#song-fade-setting');if(fade){if(fade.disabled!==locked)fade.disabled=locked;fade.closest<HTMLElement>('[data-compat-transition]')!.hidden=native;}
 syncInterfaceAudio();
 const status=document.querySelector('#native-playback-status');if(status)status.textContent=locked?trUi('数字音量已锁定 · 请使用设备调节。'):native?trUi('已选择原生音频输出。'):trUi('浏览器兼容播放。');
 updateCurrentAudioSummary();
  updateProcessingSupportStatus();
 settingsSelectControls?.sync();
  editableRanges?.sync();
}
async function refreshNativeStatus() {
 try{nativeStatus=await request<NativeStatus>('/api/native/status')}catch(error){nativeStatus={available:false,devices:[],error:(error as Error).message}}
 updateOutputUI();
 audioInfoPopup.update(playerState, nativeStatus);
 updateCurrentAudioSummary();
}
function sonySettingsMarkup() {
  const options = (values: string[], selected: number) => values.map((label, index) => `<option value="${index}" ${index === selected ? "selected" : ""}>${label}</option>`).join("");
  return ui`<section class="panel-section" id="sony-settings"><h3>Sony 音效</h3>
    <p id="sony-live-path" class="audio-live-summary"></p>
    <p class="sony-signal-layer">为 PCM 音乐添加音效。DSD 直出时无法使用。</p>
    <p id="sony-component-status" role="status">正在加载音效…</p>
    <label class="settings-row"><span>DSEE AI<small>增强与升频：44.1 → 176.4 kHz，48 → 192 kHz；输出采样率另行设置</small></span><input type="checkbox" role="switch" id="sony-dsee" ${preferences.sony.dsee ? "checked" : ""}></label>
    <p id="sony-dsee-status" class="processing-support-note" role="status"></p>
    <label class="settings-row"><span>DC 相位线性器<small>选择相位特性与处理强度</small></span><select id="sony-dc" aria-label="DC 相位线性器">${options([trUi("关闭"), trUi("A 型 · 低"), trUi("A 型 · 标准"), trUi("A 型 · 高"), trUi("B 型 · 低"), trUi("B 型 · 标准"), trUi("B 型 · 高")], preferences.sony.dc)}</select></label>
    <p class="sony-validation-note">左右声道分别处理，保持立体声声道关系。</p>
    <label class="settings-row"><span>黑胶处理器<small>选择黑胶唱片的声音特征，或关闭处理</small></span><select id="sony-vinyl" aria-label="黑胶处理器">${options([trUi("关闭"), trUi("标准"), trUi("唱臂共振"), trUi("转盘"), trUi("表面噪声")], preferences.sony.vinyl)}</select></label>
    <fieldset class="sony-execution-settings"><legend>处理任务的运行方式</legend>
    <p>适用于 Sony 音效处理与 DSD 转 PCM；EQ 和输出重采样由原生播放核心独立执行。</p>
    <label class="settings-row"><span>多核并行<small>让多个 Sony 音效按顺序分工处理；同时开启两种及以上音效时可用</small></span><input type="checkbox" role="switch" id="sony-parallel" ${preferences.sonyParallel ? "checked" : ""}></label>
    <label class="settings-row"><span>边算边播<small>音效处理或 DSD 转 PCM 时，准备好部分音频即可播放；关闭则等待整首完成</small></span><input type="checkbox" role="switch" id="sony-streaming" ${preferences.sonyStreaming ? "checked" : ""}></label>
    <p id="sony-execution-status" class="processing-support-note" role="status"></p></fieldset>
    <progress id="sony-progress" aria-label="Sony 音效处理进度" max="1" value="0" hidden></progress><p id="sony-playback-status" role="status" aria-live="polite"></p>
    <button class="text-button" data-action="sony-cache-clear">停止播放并清理音效缓存</button>
    <p>DSEE AI 支持 44.1／48 kHz 音源；DC 相位和黑胶处理支持 44.1、48、176.4、192 kHz。更改音效后会从原位置继续播放。</p>
    <p class="sony-legal-notice"><small>法律信息</small><span>© 2026 Sony Corporation</span></p></section>`;
}
function updateSonyUI() {
  updateSonyTechIndicators(document.querySelector("#sony-tech-indicators"), playerState, currentAlbum()?.id);
  const component = document.querySelector("#sony-component-status");
  if (component) component.textContent = sonyStatus ? (sonyStatus.available ? trUi("Sony 音效可用") : sonyStatus.error || trUi("音效暂不可用。")) : trUi("正在加载音效…");
  const preservePcm = preferences.output.backend !== 'browser' && processingSettings.bitPerfect;
  const unavailable = !sonyStatus?.available || playerState?.volumeLocked===true || preservePcm;
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#sony-dsee, #sony-dc, #sony-vinyl").forEach((control) => { control.disabled = unavailable; });
  const vinylMode = document.querySelector<HTMLSelectElement>("#sony-vinyl");
  if (vinylMode) vinylMode.value = String(preferences.sony.vinyl);
  const effectsCount = Number(preferences.sony.dsee) + Number(preferences.sony.dc > 0) + Number(preferences.sony.vinyl > 0);
  const track = playerState?.currentTrack;
  const dsdToPcm = !!track && isDsdTrack(track) && (preferences.output.backend === 'browser' || preferences.output.backend === 'wasapi' && preferences.output.wasapiDsdMode === 'pcm' || preferences.output.backend === 'asio' && preferences.output.dsdMode === 'pcm');
  const parallel = document.querySelector<HTMLInputElement>("#sony-parallel");
  if (parallel) parallel.disabled = unavailable || effectsCount < 2 || sonyStatus?.workers === 1;
  const streaming = document.querySelector<HTMLInputElement>("#sony-streaming");
  if (streaming) streaming.disabled = unavailable || effectsCount === 0 && !dsdToPcm;
  const executionStatus = document.querySelector<HTMLElement>("#sony-execution-status");
  if (executionStatus) executionStatus.textContent = preservePcm ? trUi('纯输出 · 处理任务停用') : playerState?.volumeLocked
    ? trUi('当前为数字直出，未使用音效处理与转换任务。运行偏好会保留。')
    : !sonyStatus?.available ? trUi('处理组件可用后可调整运行方式。')
    : effectsCount === 0 && !dsdToPcm ? trUi('当前未启用 Sony 音效，也没有 DSD 转 PCM 任务。运行偏好会保留。')
    : trUi('运行方式用于后续处理任务，当前任务继续按原设置运行；已有完整缓存时直接播放缓存。');
  settingsSelectControls?.sync();
  const output = document.querySelector("#sony-playback-status");
  const process = playerState?.sonyProcessing;
  const dseeStatus = document.querySelector<HTMLElement>("#sony-dsee-status");
  if (dseeStatus) {
    const rate = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value / 1000} kHz` : trUi('未读取');
    dseeStatus.textContent = preservePcm ? trUi('纯输出 · DSEE 停用') : playerState?.volumeLocked ? trUi('DSD 位流 · DSEE 停用')
      : process?.state === 'active' && process.effectiveSettings?.dsee
        ? ui`本曲 DSEE：${rate(process.inputSampleRate)} → ${rate(process.sampleRate)}。跟随处理结果时保留此采样率。`
      : process?.state === 'preparing' && preferences.sony.dsee ? trUi('正在准备 DSEE 处理，完成后显示实际采样率。')
      : process?.state === 'error' && preferences.sony.dsee ? trUi('本曲处理失败，DSEE 结果不可用。')
      : preferences.sony.dsee && process?.effectiveSettings?.dsee === false ? trUi('本曲输入参数不支持 DSEE，未进行增强与升频。')
      : preferences.sony.dsee ? trUi('已开启；播放支持的曲目后显示实际升频结果。')
      : trUi('DSEE 已关闭，不进行增强与升频。');
  }
  const validation=document.querySelector('.sony-validation-note');
  if(validation&&sonyStatus?.phaseStereoIsolation)validation.textContent=trUi('左右声道分别处理，保持立体声声道关系。');
  const processingText = audioProcessingText(process?.message, process?.state === "error");
  if (output && process) output.textContent = preservePcm ? trUi("纯输出 · Sony 音效停用") : playerState?.volumeLocked ? trUi("DSD 直出时无法使用音效。") : process.state === "preparing" ? `${processingText || trUi("正在准备音效…")}${process.bufferedSeconds ? ui` · 已处理 ${process.bufferedSeconds.toFixed(1)} 秒` : ""}` : process.state === "active" ? ui`音效已启用 · ${(process.sampleRate || 0)/1000} kHz${process.streaming ? trUi(" · 边处理边播放") : ""}${processingText?`。${processingText}`:''}` : process.state === "error" ? processingText || trUi("音效处理失败。") : processingText || trUi("音效未启用。");
  const progress = document.querySelector<HTMLProgressElement>("#sony-progress");
  if (progress && process) { progress.hidden = process.state !== "preparing" && !process.streaming; progress.value = process.progress; }
  const button = document.querySelector<HTMLButtonElement>("#playback-toggle");
  if (button && process?.state === "preparing") button.title = ui`正在准备音效… ${Math.round(process.progress*100)}%（点击取消）`;
}
async function refreshSonyStatus() {
  try { sonyStatus = await request<SonyStatus>("/api/sony/status"); }
  catch { sonyStatus = { available: false, original: false, error: trUi("无法连接音乐服务，音效暂不可用。") }; }
  updateSonyUI();
}
interface FtpStatus {
  configured: boolean; connected: boolean; passwordSet: boolean;
  config: { host?: string; port?: number; user?: string; root?: string; secure?: boolean | "implicit" };
  albums: number; tracks: number;
  scan: { running: boolean; tracks?: number; directories?: number; error?: string };
}
let ftpStatus: FtpStatus | undefined;
let ftpPoll: ReturnType<typeof setTimeout> | undefined;
function ftpSettingsMarkup() {
  return trUi(`<section class="panel-section" id="ftp-settings"><h3>FTP 音乐库</h3>
    <label class="field-label" for="ftp-host">服务器（主机名或 IP）</label><input id="ftp-host" type="text" placeholder="music.example.com" autocomplete="off">
    <div class="ftp-fields"><div><label class="field-label" for="ftp-port">端口</label><input id="ftp-port" type="number" value="21" min="1" max="65535"></div><div><label class="field-label" for="ftp-security">连接方式</label><select id="ftp-security"><option value="ftp">FTP</option><option value="tls">FTPS / TLS</option><option value="implicit">FTPS / Implicit TLS</option></select></div></div>
    <label class="field-label" for="ftp-user">用户名</label><input id="ftp-user" type="text" value="anonymous" autocomplete="off">
    <label class="field-label" for="ftp-password">密码</label><input id="ftp-password" type="password" autocomplete="new-password" placeholder="已保存时留空即可保留">
    <label class="field-label" for="ftp-root">服务器上的音乐目录</label><input id="ftp-root" type="text" value="/" placeholder="/Music">
    <div class="ftp-actions"><button class="text-button" data-action="ftp-test">测试连接 ↗</button><button class="primary-button" data-action="ftp-save">保存并扫描 ↗</button><button class="text-button" data-action="ftp-scan">重新扫描</button><button class="text-button" data-action="ftp-disconnect">移除连接</button><button class="text-button" data-action="ftp-cache-clear">停止播放并清理歌曲缓存</button></div>
    <p id="ftp-status" role="status" aria-live="polite">正在读取 FTP 设置…</p>
    <p>从 FTP 服务器添加音乐，歌曲播放时会下载到本机缓存。清理缓存后，下次播放会重新下载。密码保存在本机；扫描和播放不会修改服务器上的文件。</p></section>`);
}
function updateFtpUI(fill = false) {
  const section = document.querySelector("#ftp-settings");
  if (!section || !ftpStatus) return;
  const status = section.querySelector("#ftp-status");
  if (status) status.textContent = ftpStatus.scan.error || (ftpStatus.scan.running ? ui`正在扫描 FTP… ${ftpStatus.scan.directories || 0} 个目录 / ${ftpStatus.scan.tracks || 0} 首歌曲` : ftpStatus.configured ? ui`FTP 已配置 · ${ftpStatus.albums} 张专辑 / ${ftpStatus.tracks} 首歌曲${ftpStatus.connected ? trUi(" · 连接成功") : ""}` : trUi("尚未配置 FTP 音乐库。"));
  section.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => { button.disabled = ftpStatus!.scan.running; });
  if (fill) {
    for (const [id,value] of Object.entries({ "ftp-host": ftpStatus.config.host || "", "ftp-port": String(ftpStatus.config.port || 21), "ftp-user": ftpStatus.config.user || "anonymous", "ftp-root": ftpStatus.config.root || "/", "ftp-security": ftpStatus.config.secure === true ? "tls" : ftpStatus.config.secure === "implicit" ? "implicit" : "ftp" })) {
      const field = section.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`); if (field) field.value = value;
    }
  }
  settingsSelectControls?.sync();
}
async function refreshFtpStatus(fill = true) {
  clearTimeout(ftpPoll);
  try {
    ftpStatus = await request<FtpStatus>("/api/ftp/status");
    updateFtpUI(fill);
    if (ftpStatus.scan.running) ftpPoll = setTimeout(() => void refreshFtpStatus(false),1000);
    else if (!fill && ftpStatus.configured) await loadLibrary(true);
  } catch {
    const status = document.querySelector("#ftp-status"); if (status) status.textContent = trUi("本地音乐服务未连接。");
  }
}
async function ftpAction(action: string) {
  if (action === "ftp-cache-clear") player.stop();
  const node = document.querySelector("#ftp-status");
  if (node) node.textContent = trUi("正在连接 FTP…");
  const section = document.querySelector("#ftp-settings");
  const buttons = section?.querySelectorAll<HTMLButtonElement>("button[data-action]");
  buttons?.forEach((button) => { button.disabled = true; });
  try {
    if (action === "ftp-scan" || action === "ftp-disconnect" || action === "ftp-cache-clear") {
      ftpStatus = await request<FtpStatus>(action === "ftp-scan" ? "/api/ftp/scan" : action === "ftp-cache-clear" ? "/api/ftp/cache/clear" : "/api/ftp/disconnect",{});
    } else {
      const field = (id: string) => $<HTMLInputElement>(`#${id}`).value;
      const password = field("ftp-password");
      const config = { host: field("ftp-host"), port: Number(field("ftp-port")), user: field("ftp-user"), root: field("ftp-root"), secure: field("ftp-security") === "tls" ? true : field("ftp-security") === "implicit" ? "implicit" : false, ...(password ? { password } : {}) };
      if (action === "ftp-test") {
        await request("/api/ftp/test",config);
        if (node) node.textContent = trUi("FTP 登录与音乐目录读取成功。");
        return;
      }
      ftpStatus = await request<FtpStatus>("/api/ftp/config",config);
      $<HTMLInputElement>("#ftp-password").value = "";
    }
    updateFtpUI();
    await loadLibrary(true);
    if (ftpStatus?.scan.running) ftpPoll = setTimeout(() => void refreshFtpStatus(false),700);
  } catch (error) { if (node) node.textContent = (error as Error).message; }
  finally { buttons?.forEach((button) => { button.disabled = !!ftpStatus?.scan.running; }); }
}
function updateQuality() {
  renderQuality = normalizeQuality(renderQuality);
  preferences.renderQuality = renderQuality;
  scene?.setQuality(renderQuality);
  viewer?.setQuality(renderQuality);
  syncQualityUI(renderQuality, true);
  terminalLighting.setQuality(renderQuality);
  if (scene) terminalLighting.setDirection(scene.terminalLightDirection());
  caseEditor?.refresh();
  lyricsPage.refreshCasePreview();
  settingsSelectControls?.sync();
  syncQualitySummary();
  editableRanges?.sync();
  savePrefs();
}
function syncQualitySummary() {
  const summary = document.querySelector("#quality-summary");
  if (summary) {
    summary.textContent = ui`渲染 ${renderQuality.scale}% · 像素上限 ${renderQuality.pixelRatio}×`;
    if (preferences.style.design === "rhine")
      summary.textContent += ` · ${renderQuality.antialias === "off" ? trUi("原始抗锯齿") : "SMAA"}`;
  }
}
async function editGenres() {
  const body = document.querySelector("#library-page-body");
  if (!body) return;
  const loading = document.createElement("p");
  loading.className = "panel-intro";
  loading.textContent = trUi("正在读取本地分类规则…");
  body.replaceChildren(loading);
  try {
    const rules = await request<GenreRules>("/api/genre-rules");
    if (!loading.isConnected || page !== "settings") return;
    body.innerHTML = ui`<p class="panel-intro">这里编辑展示流派、别名和专辑人工分类。保存后重新归并本地索引，不修改音频标签。</p><label class="field-label" for="genre-json">本地流派规则</label><textarea id="genre-json" class="json-editor" spellcheck="false">${esc(JSON.stringify(rules, null, 2))}</textarea><div class="panel-actions"><button data-action="save-genres" class="primary-button">保存并应用</button><button data-action="library-home">返回目录管理</button></div><p id="genre-error" role="alert"></p>`;
  } catch (error) {
    notify((error as Error).message);
  }
}
async function scan(saveRoots = false) {
  if (scanSubmitting || library.scan.running) return;
  scanSubmitting = true;
  renderLibraryPaths();
  clearTimeout(scanRefreshTimer);
  scanRefreshTimer = undefined;
  ++libraryStateVersion;
  try {
    const roots = saveRoots ? [...libraryDraftRoots] : undefined;
    const next = await request<MusicLibrary>("/api/library/scan", roots ? { roots } : {});
    if (saveRoots) libraryDraftDirty = false;
    ++libraryStateVersion; // Discard polls started before this accepted scan.
    notify(trUi("开始扫描音乐库，已有专辑可以继续浏览。"));
    await receiveLibrary(next);
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void loadLibrary(), 600);
  } catch (error) {
    notify((error as Error).message);
  } finally {
    scanSubmitting = false;
    renderLibraryPaths();
  }
}
async function enrich(one = false) {
  if (demo) return;
  try {
    await request(
      "/api/library/enrich",
      one ? { albumIds: [currentAlbum()!.id] } : {},
    );
    notify(trUi("已开始补充流派和制作资料，结果将缓存在本机。"));
    await loadLibrary();
  } catch (error) {
    notify((error as Error).message);
  }
}
async function queryIntroductions(one = false) {
  const album = currentAlbum();
  if (demo || !library.albums.length || (one && !album)) return;
  if (introductionsStarting || library.introductions?.running) {
    notify(trUi("专辑介绍正在查询，进度可在设置中查看。"));
    return;
  }
  introductionsStarting = true;
  introductionRequestError = "";
  updateIntroductionStatus();
  try {
    const next = await request<MusicLibrary>("/api/library/introductions", {
      ...(one ? { albumIds: [album!.id] } : {}),
      force: true,
    });
    // A GET started before this accepted job must not restore an older snapshot.
    libraryStateVersion++;
    apiAvailable = true;
    await receiveLibrary(next);
    const job = next.introductions;
    notify(
      job?.running
        ? ui`${one ? trUi("这张专辑") : trUi("音乐库")}的介绍查询已开始，可在设置中查看进度。`
        : job?.error ||
            (job && job.total > 0
              ? ui`专辑介绍查询完成：更新 ${job.updated} 张，未找到可靠资料 ${job.notFound} 张，查询失败 ${job.failed} 张。`
              : trUi("当前没有需要查询的专辑。")),
    );
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void loadLibrary(), 800);
  } catch (error) {
    introductionRequestError = (error as Error).message;
    notify(introductionRequestError);
  } finally {
    introductionsStarting = false;
    updateIntroductionStatus();
  }
}
function playAlbum(id?: string) {
  flushArchiveVisual();
  const a = currentAlbum();
  if (!a?.tracks.length || a.offline) return;
  const focusedTrack=getMusicCatalogOptions().show==='tracks'?getMusicFocusedEntry(musicApplication.selectedIndex)?.track:undefined;
  void player.play(id || focusedTrack?.id || a.tracks[0].id, a.tracks);
}

/** The album action starts its queue at the first track, independently of TRACKS focus. */
function playSelectedAlbum() {
  const album = currentAlbum();
  if (!album?.tracks.length || album.offline) return;
  void player.play(album.tracks[0].id, album.tracks);
}

function setFoobarOrder(value: string) {
  player.setPlaybackOrder(value as Parameters<MusicPlayer["setPlaybackOrder"]>[0]);
}
function refreshFoobarSceneForLayoutChange() {
  scene?.setMusicStyle(preferences.style);
  void scene?.setCaseSettings(caseProfiles[preferences.style.design]).catch(error => notify((error as Error).message));
}
function syncMusicCatalogView() {
  const view = musicApplication.view;
  const code = preferences.style.design === "archive" ? "SHELF"
    : { genre: "GENRE", artist: "ARTIST", decade: "DECADE", az: "A-Z", none: "GROUP" }[view.group];
  const positionLabel = stage.querySelector("#genre-position")?.firstChild;
  if (positionLabel?.nodeType === Node.TEXT_NODE) positionLabel.textContent = `${code} `;
  const hint = stage.querySelector(".music-keyhint");
  if (hint?.childNodes[0]?.nodeType === Node.TEXT_NODE) hint.childNodes[0].textContent = `← → ${uiLanguage() === "en" ? "group" : "分组"} `;
  if (hint?.childNodes[2]?.nodeType === Node.TEXT_NODE) hint.childNodes[2].textContent = ` ↑ ↓ ${uiLanguage() === "en" ? view.show === "tracks" ? "track" : "album" : view.show === "tracks" ? "曲目" : "专辑"} `;
  const shelves = getMusicCatalogShelves();
  const location = getMusicRecordLocation(musicApplication.selectedIndex);
  const loop = view.layout === "array";
  for (const [action, disabled] of [
    ["genre-prev", !location || shelves.length < 2 || (!loop && location.shelf === 0)],
    ["genre-next", !location || shelves.length < 2 || (!loop && location.shelf === shelves.length - 1)],
    ["album-prev", !location || shelves[location.shelf].entryKeys.length < 2 || (!loop && location.slot === 0)],
    ["album-next", !location || shelves[location.shelf].entryKeys.length < 2 || (!loop && location.slot === shelves[location.shelf].entryKeys.length - 1)],
  ] as const) stage.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`).forEach(button => { button.disabled = disabled; });
  stage.dataset.musicLayout = scene?.musicDisplayLayout.effective ?? view.layout;
  catalogGrid?.setDesign(preferences.style.design);
  catalogGrid?.update(view.layout, musicApplication.selectedIndex, musicApplication.mode === "detail");
  syncMusicViewControls(stage, view, getMusicGridPage().total);
  settingsSelectControls?.sync();
}
function musicArrangementPreset(): MusicSortMode | "custom" {
  const view = musicApplication.view;
  if (view.group === "genre" && view.sort === "artist") return "genre";
  if (view.group === "artist" && view.sort === "title") return "artist";
  if (view.group === "none" && view.sort === "title") return "album";
  return "custom";
}
function applyMusicView(next: Partial<MusicViewSettings>, query?: string) {
  flushArchiveVisual();
  const previous = musicApplication.view;
  const layoutOnly = next.layout !== undefined && next.show === undefined && next.group === undefined && next.sort === undefined && query === undefined;
  const gridSizeOnly = next.gridPageSize !== undefined && next.layout === undefined && next.show === undefined && next.group === undefined && next.sort === undefined && query === undefined;
  configureMusicCatalog(next, query);
  if (gridSizeOnly) {
    foobarShell?.refreshCatalog();
    syncMusicCatalogView();
    savePrefs();
    return;
  }
  const pending = libraryRebuilding && libraryIntent && "index" in libraryIntent
    ? libraryIntent : presentation.pendingSelection;
  const entry = getMusicFocusedEntry(pending?.index ?? musicApplication.selectedIndex);
  if (entry) focusMusicEntry(entry.key);
  foobarShell?.refreshCatalog();
  if (previous.layout !== musicApplication.view.layout) refreshFoobarSceneForLayoutChange();
  else scene?.setMusicStyle(preferences.style);
  const filtered = getMusicCatalogRecords();
  if (!layoutOnly && filtered.length && !filtered.includes(musicApplication.selectedIndex)) select(filtered[0]);
  else updateSelection();
  savePrefs();
}
function setMusicGridPage(pageIndex: number) {
  if (page !== "music" || musicApplication.mode !== "archive" || musicApplication.view.layout !== "grid") return;
  const next = paginateMusicGridGroups(getMusicCatalogGroups(), getMusicGridPage().pageSize, pageIndex);
  musicApplication.setGridPage(next.pageIndex);
  syncMusicCatalogView();
}
function shuffleFoobarLibrary() {
  const tracks = records.flatMap(record => record.album && !record.album.offline ? record.album.tracks : []);
  for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
  if (tracks.length) void player.play(tracks[0].id, tracks);
}
function randomFoobarAlbum() {
  if(getMusicCatalogOptions().show==='tracks'){
    const entries=getMusicCatalogGroups().flatMap(group=>group.entryKeys).map(key=>getMusicEntryByKey(key)).filter(entry=>entry?.track&&!entry.record.album?.offline);
    const entry=entries[Math.floor(Math.random()*entries.length)];if(entry){focusMusicEntry(entry.key);select(entry.recordIndex);playAlbum(entry.track!.id);}return;
  }
  const choices = getMusicCatalogRecords().filter(index => records[index].album?.tracks.length && !records[index].album!.offline);
  if (choices.length) {
    const index = choices[Math.floor(Math.random() * choices.length)]; select(index);
    const album = records[index].album!; void player.play(album.tracks[0].id, album.tracks);
  }
}

document.addEventListener("click", (e) => {

  const target = (e.target as HTMLElement).closest<HTMLElement>(
    "button, [data-action]",
  );
  if (!target) return;
  if (target.dataset.processingPresetAction) {
    e.preventDefault();
    void processingPresetAction(target.dataset.processingPresetAction);
    return;
  }
  if (target.dataset.action === "dismiss-panel" && e.target !== target) return;
  if (target.dataset.musicGridSize !== undefined) {
    const size = Number(target.dataset.musicGridSize);
    if (musicGridPageSizes.includes(size as MusicGridPageSize)) applyMusicView({ gridPageSize: size as MusicGridPageSize });
    return;
  }
  if (target.dataset.musicGridPage !== undefined) {
    if (!(target as HTMLButtonElement).disabled) setMusicGridPage(Number(target.dataset.musicGridPage));
    return;
  }
  const browseField = target.dataset.musicBrowseField ?? target.dataset.foobarCatalog;
  if (browseField === "show" || browseField === "group" || browseField === "sort") {
    applyMusicView({ [browseField]: target.dataset.value } as Partial<MusicViewSettings>);
    return;
  }
  if (target.dataset.musicLayout === "shelf" || target.dataset.musicLayout === "array" || target.dataset.musicLayout === "grid") {
    applyMusicView({ layout: target.dataset.musicLayout });
    return;
  }
  if (target.dataset.action === "foobar-select" || target.dataset.action === "foobar-track") {
    const index = Number(target.dataset.foobarRecord);
    if (!Number.isInteger(index) || !records[index]) return;
    if(target.dataset.foobarEntry)focusMusicEntry(target.dataset.foobarEntry);
    select(index);
    if (target.dataset.action==='foobar-track'&&target.dataset.foobarTrack && records[index].album) void player.play(target.dataset.foobarTrack, records[index].album!.tracks);
    return;
  }
  if (target.dataset.theme) {
    setTheme(target.dataset.theme as Theme);
    return;
  }
  if (target.dataset.dayPalette) {
    setFutureDayPalette(target.dataset.dayPalette);
    return;
  }
  if (target.dataset.styleScheme) {
    setMusicStyle({ ...preferences.style, scheme: target.dataset.styleScheme as MusicStyle["scheme"] });
    return;
  }
  if (target.dataset.styleDesign === "rhine" || target.dataset.styleDesign === "archive") {
    void switchDesign(target.dataset.styleDesign).catch(error => notify((error as Error).message));
    return;
  }
  if (target.dataset.track) {
    if (target.closest(".lyrics-archive-queue")) {
      const album = currentLyricsAlbum(playerState);
      if (album?.tracks.some(track => track.id === target.dataset.track)) void player.play(target.dataset.track, album.tracks);
      return;
    }
    playAlbum(target.dataset.track);
    return;
  }
  if (target.dataset.select) {
    const entry=getMusicEntry(Number(target.dataset.select));
    if(entry){focusMusicEntry(entry.key);select(entry.recordIndex);}
    return;
  }
  if (target.dataset.album) {
    revealAlbum(target.dataset.album, target.dataset.searchTrack);
    return;
  }
  if (target.dataset.tab) {
    setTab(target.dataset.tab as "tracks" | "about");
    return;
  }
  if (target.dataset.filter !== undefined) {
    searchGenre = target.dataset.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((b) => {
        const active = (b as HTMLElement).dataset.filter === searchGenre;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", String(active));
      });
    renderSearchResults();
    return;
  }
  const action = target.dataset.action;
  if (action === "apply-language") {
    const language = document.querySelector<HTMLSelectElement>("#ui-language")?.value;
    if (!language || language === uiLanguage()) return;
    try {
      saveUiLanguage(language);
      preferences.language = language === "en" ? "en" : "zh-CN";
      savePrefs();
      sessionStorage.setItem("rhine-settings-return", page === "theme" ? "theme" : settingsCategory);
      location.reload();
    } catch (error) { notify((error as Error).message); }
    return;
  }
  if (action === "known-issues") {
    if(window.rhineDesktop?.showKnownIssues)void window.rhineDesktop.showKnownIssues(uiLanguage()).catch((error:Error)=>notify(error.message));
    else window.alert(ui`已知问题\n\n${getKnownIssuesText(uiLanguage())}`);
    return;
  }
  if (action === "playback-queue") { albumQueue.toggle(target); return; }
  if (action === "audio-info") { albumQueue.close(false);audioInfoPopup.toggle(target); return; }
  if (action === "library") { openArchivePage(); return; }
  if (action === "entry-replay") { replayFutureEntry(); return; }
  if (action === "entry-text-reset") {
    if (preferences.style.design !== "rhine") return;
    preferences.entryWelcome = defaultEntryWelcome;
    preferences.entryIdentity = defaultEntryIdentity;
    entryTextControls.sync();
    savePrefs();
    $("#entry-text-status").textContent = trUi("已恢复默认欢迎文案与 ID。");
    return;
  }
  if (action === "eq") { page === "eq" ? closeManagementPage() : openEqPage(); return; }
  if (action === "lyrics") { page === "lyrics" ? closeManagementPage() : openLyricsPage(); return; }
  if (action === "signal") { page === "signal" ? closeManagementPage() : openSignalPage(); return; }
  if (action === "theme") { page === "theme" ? closeManagementPage() : openThemePage(); return; }
  if (action === "library-home") { if (isLibrarySettings()) renderLibraryPage(); return; }
  if (action === "library-select-root") { selectedLibraryRoot = Number(target.dataset.rootIndex); renderLibraryPaths(); return; }
  if (action === "library-add-folder" || action === "library-replace-folder") { void chooseLibraryRoots(action === "library-replace-folder"); return; }
  if (action === "library-remove-folder" || action === "library-root-up" || action === "library-root-down") { adjustLibraryRoots(action); return; }
  if (action === "settings") { page === "settings" ? closeManagementPage() : openSettingsPage(); return; }
  if (action === "audio-settings-jump") { jumpToAudioSettingsSection(target.dataset.audioSettingsTarget as AudioSettingsSection); return; }
  if (action === "settings-category") { selectSettingsCategory(target.dataset.settingsCategoryTarget as SettingsCategory, true); return; }
  if(action==='native-refresh') {
    player.stop();void request<NativeStatus>('/api/native/refresh',{}).then(status=>{nativeStatus=status;updateOutputUI()}).catch((error: Error)=>notify(error.message));return;
  }
  if (action === "sony-cache-clear") {
    player.stop();
    void request("/api/sony/cache/clear",{}).then(()=>notify(trUi("Sony 音效缓存已清理。"))).catch((error: Error)=>notify(error.message));
    return;
  }
  if (action?.startsWith("ftp-")) { void ftpAction(action); return; }
  if (["search", "online"].includes(action || "")) {
    searchGenre = "";
    openPanel(action as Panel);
    return;
  }
  switch (action) {
    case "foobar-home":
      openArchivePage();
      break;
    case "foobar-random":
      randomFoobarAlbum();
      break;
    case "foobar-shuffle":
      shuffleFoobarLibrary();
      break;
    case "locate-playing": {
      closeManagementPage(false);
      const track = playerState.currentTrack;
      const cover = preferences.style.design === "archive" && target.matches(".playback-song");
      const nowPlaying = ["loading", "playing", "paused"].includes(playerState.transport);
      if (track && (!cover || nowPlaying)) locatePlaying(track.albumId, track.id);
      else if (cover) { openArchivePage(); setMode("detail"); }
      break;
    }
    case "shelf-local":
      void switchShelf("local");
      break;
    case "shelf-online":
      void switchShelf("online");
      break;
    case "online-search":
      void runOnlineSearch();
      break;
    case "online-more":
      void runOnlineSearch(true);
      break;
    case "online-add":
      void addOnlineAlbum(target);
      break;
    case "online-remove":
      if (target.dataset.id) void removeOnlineAlbum(target.dataset.id);
      break;
    case "online-reveal":
      if (target.dataset.id) void switchShelf("online", { albumId: target.dataset.id });
      break;
    case "subsonic-save":
    case "subsonic-test":
    case "subsonic-clear":
      void subsonicAction(action!.slice("subsonic-".length) as "save" | "test" | "clear");
      break;
    case "close-panel":
    case "dismiss-panel":
      closePanel();
      break;
    case "open":
      setMode("detail");
      break;
    case "play-album":
      playSelectedAlbum();
      break;
    case "back":
      setMode("archive");
      break;
    case "model-viewer":
      // Temporarily unavailable for the simplified CD shell (no inner assembly).
      break;
    case "sound-preview":
      effects.play("confirm");
      break;
    case "fullscreen":
      void changeFullscreen();
      break;
    case "prev":
      stepAlbum(-1);
      break;
    case "next":
      stepAlbum(1);
      break;
    case "genre-prev":
      stepGenre(-1);
      break;
    case "genre-next":
      stepGenre(1);
      break;
    case "genres":
      openPanel("search");
      break;
    case "play-pause":
      playerState.currentTrack ? void player.toggle() : playAlbum();
      break;
    case "stop":
      player.stop();
      break;
    case "track-previous":
      void player.previous();
      break;
    case "track-next":
      void player.next();
      break;
    case "scan":
      void scan(true);
      break;
    case "rescan":
      void scan();
      break;
    case "enrich-album":
      void enrich(true);
      break;
    case "enrich-library":
      void enrich();
      break;
    case "introduction-album":
    case "edit-album-info":
      if (currentAlbum()) albumInfoEditor.open(currentAlbum()!);
      break;
    case "introductions-library":
      void queryIntroductions();
      break;
    case "edit-genres":
      void editGenres();
      break;
    case "save-online":
      void (async () => {
        try {
          await request("/api/config", {
            musicBrainzContact:
              $<HTMLInputElement>("#metadata-contact").value.trim(),
            onlineEnabled: $<HTMLInputElement>("#online-enabled").checked,
          });
          albumInfoEditor.refreshSources();
          notify(trUi("资料库设置已保存。可以开始补充专辑资料。"));
        } catch (error) {
          notify((error as Error).message);
        }
      })();
      break;
    case "save-genres":
      void (async () => {
        const editor = $<HTMLTextAreaElement>("#genre-json");
        try {
          const body = JSON.parse(editor.value);
          await request("/api/genre-rules", body);
          await loadLibrary(true);
          notify(trUi("分类规则已保存并应用。"));
          if (editor.isConnected && page === "settings") renderLibraryPage();
        } catch (error) {
          const errorNode = document.querySelector("#genre-error");
          if (editor.isConnected && errorNode)
            errorNode.textContent = (error as Error).message;
          else notify((error as Error).message);
        }
      })();
      break;
    case "demo":
      demo = true;
      closeManagementPage(false);
      closePanel(() => void applyLibrary());
      break;
  }
});
document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.processingField && el.type === "range") {
    updateProcessingField(el);
  }
  if (el.dataset.quality && el.type === "range") {
    renderQuality = normalizeQuality({
      ...renderQuality,
      [el.dataset.quality]: Number(el.value),
    });
    updateQuality();
  }
  if (el.id === "bgm-volume") {
    preferences.bgmVolume = Number(el.value) / 100;
    player.setBgmVolume(preferences.bgmVolume);
    savePrefs();
  }
  if (el.id === "sound-volume") {
    preferences.soundVolume = Number(el.value) / 100;
    syncInterfaceAudio();
    savePrefs();
  }
  if (el.id === "album-search") renderSearchResults();
  if (el.id === "volume") {
    preferences.volume = Number(el.value) / 100;
    player.setVolume(preferences.volume);
    savePrefs();
  }
});
document.addEventListener("keydown", event => {
  const control = event.target as HTMLInputElement;
  if (event.key !== "Enter" || !control.matches?.('[data-processing-rate-unit="khz"]') || control.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  control.dispatchEvent(new Event("change", { bubbles: true }));
});
document.addEventListener("change", (e) => {
  const control = e.target as HTMLInputElement | HTMLSelectElement;
  if (control.id === "entry-on-open" && control instanceof HTMLInputElement) {
    if (preferences.style.design !== "rhine" || control.disabled) { control.checked = preferences.entryOnOpen; return; }
    preferences.entryOnOpen = control.checked;
    savePrefs();
    return;
  }
  if (control instanceof HTMLInputElement && control.hasAttribute("data-follow-system-theme")) {
    setFollowSystemTheme(control.checked);
    return;
  }
  if (control.hasAttribute("data-processing-rate-choice")) {
    if (control.disabled) return;
    if (control.value === "custom") {
      const input = document.querySelector<HTMLInputElement>('[data-processing-field="resampling.rate"]');
      input?.focus(); input?.select();
    } else if (setProcessingSettings({ ...processingSettings, resampling: { ...processingSettings.resampling, rate: Number(control.value) } }, true)) {
      updateProcessingControlValues(); finishProcessingEdit();
    }
    return;
  }
  if (control.dataset.processingField) {
    if (updateProcessingField(control)) finishProcessingEdit();
    return;
  }
  if (control instanceof HTMLInputElement && control.dataset.processingRate !== undefined) {
    const rate = Number(control.dataset.processingRate);
    const allowedRates = new Set(processingSettings.resampling.allowedRates);
    if (control.checked) allowedRates.add(rate); else allowedRates.delete(rate);
    if (setProcessingSettings({ ...processingSettings, resampling: { ...processingSettings.resampling, allowedRates: [...allowedRates].sort((a, b) => a - b) } }, true)) updateProcessingControlValues();
    return;
  }
  if (control.id === "processing-preset-select" && control instanceof HTMLSelectElement) {
    if (control.value === "current") {
      processingPresetStore.activeId = null;
      saveProcessingPresetStore();
      syncProcessingPresetUi();
    } else {
      const preset = processingPresetStore.presets.find((item) => item.id === control.value);
      if (preset) applyProcessingPreset(preset);
    }
    return;
  }
  if (control.id === "processing-preset-file" && control instanceof HTMLInputElement) {
    const file = control.files?.[0];
    if (file) void importProcessingFile(file);
    return;
  }
  const el = e.target as HTMLInputElement;
  if(['output-backend','output-device','output-channel','output-dsd','output-wasapi-device','output-wasapi-exclusive','output-wasapi-dsd'].includes(el.id)) {
    const next={...preferences.output};
    if(el.id==='output-backend')next.backend=el.value as OutputSettings['backend'];
    if(el.id==='output-device')next.device=Number(el.value);
    if(el.id==='output-channel')next.channel=Number(el.value)-1;
    if(el.id==='output-dsd')next.dsdMode=el.value as OutputSettings['dsdMode'];
    if(el.id==='output-wasapi-dsd')next.wasapiDsdMode=el.value as OutputSettings['wasapiDsdMode'];
    if(el.id==='output-wasapi-device')next.wasapiDevice=el.value;
    if(el.id==='output-wasapi-exclusive')next.wasapiMode=el.checked?'exclusive':'shared';
    preferences.output=normalizeOutput(next);savePrefs();updateOutputUI();
    void player.setOutputSettings(preferences.output).catch((error: Error)=>notify(error.message));
  }
  if (["sony-parallel", "sony-streaming"].includes(el.id)) {
    if (el.disabled) return;
    if (el.id === "sony-parallel") preferences.sonyParallel = el.checked;
    else preferences.sonyStreaming = el.checked;
    savePrefs();
    player.setSonyExecution({ parallel: preferences.sonyParallel, streaming: preferences.sonyStreaming });
  }
  if (["sony-dsee", "sony-dc", "sony-vinyl"].includes(el.id)) {
    if (el.disabled) return;
    preferences.sony = normalizeSony({ ...preferences.sony,
      ...(el.id === "sony-dsee" ? { dsee: el.checked } : el.id === "sony-dc" ? { dc: Number(el.value) } : { vinyl: Number(el.value) }) });
    savePrefs();
    updateSonyUI();
    void player.setSonySettings(preferences.sony);
  }
  if (el.id === "music-sort" && ["genre", "artist", "album"].includes(el.value)) {
    applyMusicView(el.value === "genre" ? { group: "genre", sort: "artist" }
      : el.value === "artist" ? { group: "artist", sort: "title" } : { group: "none", sort: "title" });
    return;
  }
  if (el.id === "quality-preset") {
    preferences.quality = el.value as QualityPreset;
    renderQuality = normalizeQuality({ ...qualityPresets[preferences.quality], wave: renderQuality.wave });
    updateQuality();
  }
  if (el.matches("[data-window-aspect]")) {
    preferences.windowAspect = normalizeWindowAspect(el.value);
    fit();
    savePrefs();
    return;
  }
  if (el.dataset.styleField) {
    const field = el.dataset.styleField as keyof MusicStyle;
    const value = el.type === "checkbox" ? el.checked : ["arrayScale", "inspectScale", "textScale"].includes(field) ? Number(el.value) : el.value;
    setMusicStyle({ ...preferences.style, [field]: value });
    return;
  }
  if (el.dataset.quality) {
    renderQuality = withQualityField(renderQuality, el.dataset.quality, el.value);
    updateQuality();
  }
  if (el.id === "sound-setting") {
    preferences.sound = el.checked;
    syncInterfaceAudio();
    savePrefs();
  }
  if (el.id === "song-fade-setting") {
    preferences.songFade = el.checked;
    player.setSongFadeEnabled(el.checked);
    savePrefs();
  }
  if (el.id === "reduced-motion") {
    preferences.reduced = el.checked;
    stage.dataset.reducedMotion = String(preferences.reduced);
    transportTitleMotion.setReduced(el.checked);
    if (el.checked) {
      albumPanel.finish();
      browseTransition.finish();
      detailTransition.finish();
    }
    syncSelectionMotion();
    scene?.setReduced(el.checked);
    stage.classList.toggle("reduce-motion", el.checked);
    updateSelection();
    savePrefs();
  }
  if (el.id === "bgm-setting") {
    preferences.bgm = el.checked;
    player.setBgmEnabled(el.checked);
    savePrefs();
  }
});
// Reference settings use a confirmation after a committed preference change.
// Volume dragging stays silent; the explicit preview auditions that level.
document.addEventListener("change", (event) => {
  const control = event.target;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement) || control.disabled) return;
  if (!control.matches('#sound-setting,#bgm-setting,#reduced-motion,#entry-on-open,[data-quality="wave"]')) return;
  queueMicrotask(() => effects.play("confirm"));
});

document.addEventListener("dblclick", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action="foobar-select"]');
  if (!target || page !== "music" || panel || viewer?.isOpen || presentation.phase !== "archive") return;
  const index = Number(target.dataset.foobarRecord);
  if (Number.isInteger(index) && index === musicApplication.selectedIndex) {
    if(target.dataset.foobarTrack)playAlbum(target.dataset.foobarTrack);else setMode("detail");
  }
});
document.addEventListener("keydown", (e) => {
  if (handleFutureAppearanceKey(e)) return;
  if (e.defaultPrevented) return;

  if (viewer?.isOpen) return;
  if (isLibrarySettings() && (e.target as HTMLElement).closest("#library-path-list") && libraryDraftRoots.length) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      selectedLibraryRoot = Math.max(0, Math.min(libraryDraftRoots.length - 1, selectedLibraryRoot + (e.key === "ArrowUp" ? -1 : 1)));
      renderLibraryPaths();
      document.querySelector<HTMLElement>('#library-path-list [aria-selected="true"]')?.focus();
      return;
    }
    if (e.key === "Delete") { e.preventDefault(); adjustLibraryRoots("library-remove-folder"); return; }
  }
  if (e.key === "Escape") {
    e.preventDefault();
    if (e.repeat) return;
    // Escape belongs to the current page; peer-page navigation uses its tabs.
    if (panel) closePanel();
    else if (windowFullscreen) void changeFullscreen("exit");
    else if (page === "music") setMode("archive");
    return;
  }
  if (panel) {
    if (e.key === "Tab") {
      const items = [
        ...document.querySelectorAll<HTMLElement>(
          "#music-panel-root button:not([disabled]), #music-panel-root input, #music-panel-root textarea, #music-panel-root select, #music-panel-root a",
        ),
      ];
      if (!items.length) return;
      const first = items[0],
        last = items.at(-1)!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    return;
  }
  if ((e.target as HTMLElement).closest(".music-header, .foobar-header, .music-topnav, .music-playback, .foobar-footer, .foobar-status")) return;
  const editing = (e.target as HTMLElement).matches("input, textarea, select, [contenteditable=true]");
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!editing) {
    if (page === "music" && e.key === "/") { e.preventDefault();searchGenre="";openPanel("search");return; }
    if ((page === "lyrics" || page === "signal") && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault(); player.seek(Math.max(0, playerState.currentTime + (e.key === "ArrowRight" ? 5 : -5))); return;
    }
    if (e.key.toLowerCase() === "t") { e.preventDefault(); setTheme(preferences.theme === "day" ? "night" : "day"); return; }
    if (page === "music" && e.key.toLowerCase() === "r") { e.preventDefault(); randomFoobarAlbum(); return; }
    if (page === "music" && e.key.toLowerCase() === "g") {
      e.preventDefault(); const current = getMusicCatalogOptions();
      applyMusicView({ layout: current.layout === "grid" ? musicApplication.spatialLayout : "grid" }); return;
    }
    if (page === "music" && musicApplication.mode === "archive" && (e.key === "Home" || e.key === "End")) {
      const location = getMusicRecordLocation(musicApplication.selectedIndex), shelves = getMusicCatalogShelves();
      const files = location ? shelves[location.shelf]?.entryKeys : undefined;
      if (files?.length) { const entry=getMusicEntryByKey(e.key === "Home" ? files[0] : files[files.length-1]);if(entry){e.preventDefault();focusMusicEntry(entry.key);select(entry.recordIndex);}return; }
    }
  }
  if (page !== "music") return;
  if ((e.target as HTMLElement).closest(".music-topnav, .music-playback")) return;
  const gridCard = (e.target as HTMLElement).closest<HTMLElement>(".music-catalog-grid-host .foobar-grid-card");
  if (e.key === "Enter" && gridCard) {
    e.preventDefault();
    const entry = getMusicEntryByKey(gridCard.dataset.foobarEntry || "");
    if (entry) { focusMusicEntry(entry.key);select(entry.recordIndex, undefined, true); }
    return;
  }
  if (
    (e.target as HTMLElement).matches("[role=tab]") &&
    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
  ) {
    e.preventDefault();
    setTab(
      e.key === "Home"
        ? "tracks"
        : e.key === "End"
          ? "about"
          : musicApplication.activeTab === "tracks"
            ? "about"
            : "tracks",
    );
    $(`#tab-${musicApplication.activeTab}`).focus();
    return;
  }
  if (
    (e.target as HTMLElement).matches(
      "input, textarea, select, [contenteditable=true]",
    )
  )
    return;
  if (e.key === "/") {
    e.preventDefault();
    searchGenre = "";
    openPanel("search");
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    stepGenre(-1);
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    stepGenre(1);
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    stepAlbum(-1);
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    stepAlbum(1);
  }
  if (e.key === "Enter" && !(e.target as HTMLElement).closest("button, a")) {
    e.preventDefault();
    setMode("detail");
  }
  if (e.code === "Space" && !(e.target as HTMLElement).closest("button, a")) {
    e.preventDefault();
    const album = records[navigationSelection()]?.album;
    const track = getMusicFocusedEntry(musicApplication.selectedIndex)?.track;
    if(track&&track.id!==playerState.currentTrack?.id)playAlbum(track.id);
    else if (album && playerState.currentTrack?.albumId !== album.id && album.tracks.length && !album.offline) playAlbum();
    else playerState.currentTrack ? void player.toggle() : playAlbum();
  }
});

let lastFrame = 0,
  frameCount = 0;
function frame(ms: number) {
  if (!document.hidden && page === "music") scene?.prepareFrameViewport();
  flushArchiveVisual();
  foobarShell?.tick(ms / 1000, preferences.reduced);
  if (!document.hidden && scene && page === "music") {
    const entryWasActive = !!futureEntry?.active;
    const entryShot = futureEntry?.update(ms);
    // The music entry ends at the overview. Omit the reference's later
    // extraction/inspection cues, which belong to a detail transition.
    if (entryShot) effects.updateBoot(entryShot.time, false, 26.92, preferences.entryIdentity);
    // The prepared WebGL frame stays beneath the opaque terminal film. Start
    // rendering its cinematic path when the welcome screen actually releases it.
    if (!viewer?.isOpen && (!entryShot || entryShot.time >= 21.9) &&
      !(entryWasActive && !futureEntry?.active)) scene.update(ms / 1000, entryShot);
    viewer?.update(ms / 1000);
    if (!viewer?.isOpen && !futureEntry?.active) presentation.update();
    const phase = presentation.phase;
    if (stage.dataset.presentation !== phase) stage.dataset.presentation = phase;
    const cameraPhase = scene.musicPresentationPhase;
    if (stage.dataset.cameraPhase !== cameraPhase) stage.dataset.cameraPhase = cameraPhase;
    if (presentation.phase === "detail") {
      if (pendingTrackReveal && !panel && !viewer?.isOpen &&
        $("#music-detail").dataset.transition === "open" &&
        currentAlbum()?.id === pendingTrackReveal.albumId) {
        const content = albumPanel.scrollTarget() ?? $("#album-detail-content");
        const trackId = pendingTrackReveal.trackId;
        pendingTrackReveal = undefined;
        const row = Array.from(content.querySelectorAll<HTMLButtonElement>(".track-row"))
          .find((item) => item.dataset.track === trackId);
        if (row) trackFocus.reveal(content, row, preferences.reduced);
      }
    }
    frameCount++;
    if (ms - lastFrame > 1500) {
      $("#runtime-info").textContent =
        `${Math.round((frameCount * 1000) / (ms - lastFrame))} FPS / ${themeNames[preferences.theme]}`;
      // Keep read-only render diagnostics alongside the existing resolution
      // attributes, without adding controls or per-frame DOM work.
      if (!viewer?.isOpen) {
        const { drawCalls, triangles, selectionLight } = scene.getStats();
        $("#three-scene").dataset.renderStats = JSON.stringify({
          drawCalls,
          triangles,
        });
        $("#three-scene").dataset.selectionLight =
          JSON.stringify(selectionLight);
      }
      frameCount = 0;
      lastFrame = ms;
    }
  } else {
    frameCount = 0;
    lastFrame = ms;
  }
  requestAnimationFrame(frame);
}
async function start() {
  let returningCategory: string | null = null;
  try { returningCategory = sessionStorage.getItem("rhine-settings-return"); sessionStorage.removeItem("rhine-settings-return"); } catch {}
  if (returningCategory === "playback" || returningCategory === "sony") returningCategory = "audio";
  const restoreTheme = returningCategory === "theme";
  const restoreSettings = settingsCategories.some((category) => category.id === returningCategory);
  // This local application owns its live index. An old archive PWA must not serve stale UI.
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  }
  await loadLibrary(true);
  {
    let recovered: NativePlaybackSession|null=null;
    try {
      recovered=await recoverNativeSession();
      if(recovered){
        const desiredProcessing=cloneProcessing(processingSettings);
        const available=new Map(library.albums.flatMap(album=>album.tracks).map(track=>[track.id,track]));
        let queue: MusicTrack[]|undefined;
        try{const saved=JSON.parse(sessionStorage.getItem('rhine-native-queue')||'null');if(saved?.session===recovered.session&&Array.isArray(saved.queue))queue=saved.queue.map((id:string)=>available.get(id)).filter((track:MusicTrack|undefined):track is MusicTrack=>!!track)}catch{}
        if(!queue?.some(track=>track.id===recovered!.trackId))queue=library.albums.find(album=>album.tracks.some(track=>track.id===recovered!.trackId))?.tracks;
        processingApplyPending=true;
        if(!queue||!player.restoreNativePlayback(recovered,queue)){processingApplyPending=false;await discardNativeSession(recovered.session);notify(trUi('当前曲目无法从曲库恢复，已停止原生播放。'))}
        else{
          preferences.output={...playerState.outputSettings,processing:desiredProcessing};processingSettings=desiredProcessing;
          preferences.sony={...playerState.sonySettings};preferences.volume=playerState.volume;savePrefs();updateOutputUI();
          setProcessingSettings(desiredProcessing,false);
        }
      }
    }catch(error){processingApplyPending=false;if(recovered)await discardNativeSession(recovered.session).catch(()=>{});notify((error as Error).message)}
  }
  try {
    fit();
    if (preferences.style.design === "archive") await Promise.all([400, 500, 600, 700].map(weight => document.fonts.load(`${weight} 17px "Archive Mono"`)));
    scene = new ArchiveScene($("#three-scene"));
    scene.onStyleError = notify;
    scene.attachPlaybackGlass($("#music-playback"));
    // Keep a direct visual comparison URL without adding another user setting.
    if (new URLSearchParams(location.search).get("lighting") !== "baseline")
      scene.enableSelectionLighting();
    await Promise.all([
      scene.load(),
      document.fonts.load("400 20px MiSans"),
      document.fonts.load("600 20px MiSans"),
    ]);
    ready = true;
    $("#three-scene canvas").setAttribute(
      "aria-label",
      ui`三维专辑阵列，左右切${sortLabel.column}，上下切专辑`,
    );
    stage.classList.toggle("reduce-motion", preferences.reduced);
    await scene.refreshLibrary(musicApplication.selectedIndex);
    scene.setTheme(preferences.theme);
    scene.setMusicStyle(preferences.style);
    scene.setQuality(renderQuality);
    await scene.setCaseSettings(caseProfiles[preferences.style.design]);
    terminalLighting.setDirection(scene.terminalLightDirection());
    scene.setReduced(preferences.reduced);
    await scene.warmup();
    scene.onSelect = (index, cell) => {
      if (!futureEntry?.active && presentation.phase === "archive" && !panel && page === "music") {
        if(cell?.foobarEntryKey)focusMusicEntry(cell.foobarEntryKey);
        select(index, cell ? { cell } : undefined);
      }
    };
    scene.onOpenAlbum = index => {
      if (!futureEntry?.active && presentation.phase === "archive" && !panel && !viewer?.isOpen && page === "music" && index === musicApplication.selectedIndex)
        setMode("detail");
    };
    scene.onNavigate = (axis, direction) => {
      if (!futureEntry?.active && presentation.phase === "archive" && !panel && page === "music")
        axis === "lane" ? stepGenre(direction) : stepAlbum(direction);
    };
    updateSelection();
    scene.showMusicArchiveImmediately(performance.now() / 1000);
    effects.setScene("archive");
    if (albums.length) showBrowseSurface(true);
    else browseTransition.hide(true);
    $("#music-browse").inert = !albums.length;
    $("#music-browse").setAttribute("aria-hidden", String(!albums.length));
    syncSelectionMotion();
    if (restoreSettings) {
      settingsCategory = returningCategory as SettingsCategory;
      openSettingsPage();
    }
    if (restoreTheme) openThemePage();
    // Future album MATRIX and ARRAY each have their own scene choreography.
    // Saved layouts, the Punk theme, empty libraries and reduced motion retain
    // the existing immediate archive path; settings returns keep their page.
    if (preferences.entryOnOpen && !restoreSettings && !restoreTheme) startFutureEntry();
    requestAnimationFrame((ms) => {
      stage.classList.add("theme-motion-ready");
      frame(ms);
      requestAnimationFrame(() => {
        window.rhineDesktop?.frontendReady?.();
        futureEntry?.arm();
      });
    });
  } catch (error) {
    console.error(error);
    window.rhineDesktop?.frontendFailed?.(error instanceof Error ? error.message : String(error));
    $("#music-startup-error").hidden = false;
    $("#music-startup-error").innerHTML =
      ui`<strong>三维资源未能加载</strong><small>${esc((error as Error).message)}</small><button data-action="library-settings">打开音乐库设置</button>`;
  }
}
void start();
Object.assign(window, {
  rhineMusic: {
    get entry() { return futureEntry?.state ?? { active: false, phase: "archive" }; },
    get design() { return { ...preferences.style }; },
    get library() {
      return library;
    },
    get selectedAlbum() {
      return currentAlbum();
    },
    get operationFocus() { return albumInteraction.side; },
    get player() {
      return player.state;
    },
    stats: (includeGeometry = false) => scene?.getStats(includeGeometry),
    get presentation() {
      return { phase: presentation.phase, cameraPhase: scene?.musicPresentationPhase,
        pendingIndex: presentation.pendingSelection?.index,
        menuVisible: !$("#music-detail").hidden,
        cameraReady: scene?.musicPresentationReady,
        archiveReady: scene?.musicArchiveReady };
    },
  },
});
