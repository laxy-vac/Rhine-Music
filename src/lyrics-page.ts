import { trUi, ui, lyricSourceLabel } from "./i18n";
import type { MusicPlayerState } from "./music-player";
import type { MusicAlbum } from "./music-types";
import { audioStageName, pcmConsistencyStatus } from "./audio-info";

export type SpectrumSnapshot = {
  available: boolean;
  bands: number[];
  peakDb?: number;
  rmsDb?: number;
  sampleRate?: number;
  updatedAt?: number;
  reason?: string;
  stage?: string;
};

export interface LyricsSourceMapping {
  results?: string;
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: string;
  lrc?: string;
  translation?: string;
}

export interface LyricsSource {
  id: string;
  name: string;
  builtin: boolean;
  enabled: boolean;
  searchUrl?: string;
  lyricUrl?: string;
  mapping?: LyricsSourceMapping;
}

export interface LyricsCandidate {
  id: string;
  sourceId: string;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  score?: number;
}

export interface LyricDocument {
  trackId: string;
  lrc: string;
  translation?: string;
  offsetMs: number;
  offsetInText?: boolean;
  source: { id: string; name: string; url?: string };
  savedAt: string;
}

export interface LyricsCustomSourceConfig {
  id?: string;
  name: string;
  searchUrl: string;
  lyricUrl: string;
  mapping?: LyricsSourceMapping;
}

export interface LyricsPageCallbacks {
  seek: (seconds: number) => void;
  spectrum: () => SpectrumSnapshot | undefined;
  notify: (message: string) => void;
  openSettings: () => void;
}

interface LyricsGlobalSettings {
  defaultSourceId: string;
  cacheDirectory: string;
  defaultCacheDirectory: string;
}

type LyricsKind = "local" | "cloud";
interface LyricsStatePayload {
  lyric: LyricDocument | null;
  activeKind: LyricsKind;
  variants: Record<LyricsKind, boolean>;
  userSelected?: boolean;
  selectionRevision?: number;
  effectiveKind?: LyricsKind | null;
  usingCloudFallback?: boolean;
}
const kindOfLyric = (documentValue: LyricDocument): LyricsKind => documentValue.source.id === "local-import" ? "local" : "cloud";

export interface ParsedLyricLine {
  time: number | null;
  text: string;
  translation?: string;
}

export interface ParsedLyrics {
  lines: ParsedLyricLine[];
  timed: boolean;
  offsetMs: number;
}

type LyricsNoticeState = "standby" | "loading" | "missing" | "error";

const MAX_IMPORT_BYTES = 96 * 1024;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function timestampSeconds(match: RegExpExecArray): number | null {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ?? "";
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  const milliseconds = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
  return minutes * 60 + seconds + milliseconds / 1000;
}

/** Parse LRC timestamps without depending on player state or the DOM. */
export function parseLyrics(lrc: string, translation = ""): ParsedLyrics {
  const offsetMatch = lrc.match(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/im);
  const offsetValue = offsetMatch ? Number(offsetMatch[1]) : 0;
  const offsetMs = Number.isSafeInteger(offsetValue) ? offsetValue : 0;
  const stamp = /\[(\d{1,4}):(\d{1,2})(?:[.:](\d{1,3}))?\]/gu;
  const rows: Array<{ time: number | null; text: string; ordinal: number }> = [];
  let ordinal = 0;

  for (const rawLine of lrc.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const stamps: number[] = [];
    stamp.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = stamp.exec(line))) {
      const seconds = timestampSeconds(match);
      if (seconds !== null) stamps.push(seconds - offsetMs / 1000);
    }
    const text = line.replace(stamp, "").replace(/^\[[a-z]{1,8}\s*:[^\]]*\]/iu, "").trim();
    if (/^\[(?:ar|al|ti|by|re|ve|length|id|offset)\s*:/iu.test(line) && stamps.length === 0) continue;
    if (!text) continue;
    if (stamps.length) {
      for (const time of stamps) rows.push({ time, text, ordinal: ordinal++ });
    } else {
      rows.push({ time: null, text, ordinal: ordinal++ });
    }
  }

  rows.sort((a, b) => {
    if (a.time === null && b.time === null) return a.ordinal - b.ordinal;
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time - b.time || a.ordinal - b.ordinal;
  });

  const translated = parseTranslationLines(translation, offsetMs);
  if (translated.length) {
    if (translated.some((line) => line.time !== null) && rows.some((line) => line.time !== null)) {
      const byTime = new Map<number, string[]>();
      for (const line of translated) {
        if (line.time === null) continue;
        const key = Math.round(line.time * 1000);
        const bucket = byTime.get(key) ?? [];
        bucket.push(line.text);
        byTime.set(key, bucket);
      }
      let positional = 0;
      for (const row of rows) {
        if (row.time === null) continue;
        const bucket = byTime.get(Math.round(row.time * 1000));
        if (bucket?.length) row.text += "\u0000" + bucket.shift();
        else if (translated[positional]?.time === null) row.text += "\u0000" + translated[positional].text;
        positional += 1;
      }
    } else {
      const timedRows = rows.filter((line) => line.time !== null);
      const target = timedRows.length ? timedRows : rows;
      target.forEach((row, index) => {
        if (translated[index]) row.text += "\u0000" + translated[index].text;
      });
    }
  }

  const lines = rows.map((row) => {
    const splitAt = row.text.indexOf("\u0000");
    return splitAt < 0
      ? { time: row.time, text: row.text }
      : { time: row.time, text: row.text.slice(0, splitAt), translation: row.text.slice(splitAt + 1) };
  });
  return { lines, timed: lines.some((line) => line.time !== null), offsetMs };
}

function parseTranslationLines(value: string, baseOffsetMs: number): ParsedLyricLine[] {
  if (!value.trim()) return [];
  const stamp = /\[(\d{1,4}):(\d{1,2})(?:[.:](\d{1,3}))?\]/gu;
  const rows: Array<{ time: number | null; text: string; ordinal: number }> = [];
  let ordinal = 0;
  for (const rawLine of value.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const times: number[] = [];
    stamp.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = stamp.exec(line))) {
      const seconds = timestampSeconds(match);
      if (seconds !== null) times.push(seconds - baseOffsetMs / 1000);
    }
    const text = line.replace(stamp, "").replace(/^\[[a-z]{1,8}\s*:[^\]]*\]/iu, "").trim();
    if (!text || /^\[(?:ar|al|ti|by|re|ve|length|id|offset)\s*:/iu.test(line)) continue;
    if (times.length) for (const time of times) rows.push({ time, text, ordinal: ordinal++ });
    else rows.push({ time: null, text, ordinal: ordinal++ });
  }
  rows.sort((a, b) => a.time === null && b.time === null ? a.ordinal - b.ordinal : a.time === null ? 1 : b.time === null ? -1 : a.time - b.time || a.ordinal - b.ordinal);
  return rows.map(({ time, text }) => ({ time, text }));
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}

function formatRate(rate?: number): string {
  return Number.isFinite(rate) && rate! > 0 ? `${(rate! / 1000).toFixed(rate! % 1000 === 0 ? 0 : 1)} kHz` : "—";
}

function formatDsdRate(rate?: number): string {
  if (!Number.isFinite(rate) || !rate || rate <= 0) return trUi("DSD · 1 位");
  const mhz = (rate / 1_000_000).toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
  return ui`${mhz} MHz DSD · 1 位`;
}

function processingStageLabel(name: string): string {
  return name.replace(/\bPCM decode\b/giu, trUi("PCM 解码")).replace(/\bOutput format\b/giu, trUi("输出格式"));
}

function localCoverUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.href);
    return url.origin === window.location.origin && ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!response.ok) throw new Error(typeof record.error === "string" ? record.error : ui`本机歌词服务返回 ${response.status}`);
  return body as T;
}

export function setupLyricsPage(
  host: HTMLElement,
  callbacks: LyricsPageCallbacks,
): { update(state: MusicPlayerState, album?: MusicAlbum): void; setVisible(visible: boolean): void; destroy(): void } {
  let latestState: MusicPlayerState | undefined;
  let latestAlbum: MusicAlbum | undefined;
  let visible = false;
  let disposed = false;
  let activeTrackId = "";
  let activeMetadataSignature = "";
  let lyricRequestTrackId = "";
  let lyricAttemptSignature = "";
  let lyricDocument: LyricDocument | null = null;
  let parsedLyrics: ParsedLyrics | null = null;
  let activeLineIndex = -2;
  let followEnabled = true;
  let sourceList: LyricsSource[] = [];
  let globalSettings: LyricsGlobalSettings | undefined;
  let activeKind: LyricsKind = "cloud";
  let optionsKind: LyricsKind = "cloud";
  let lyricVariants: Record<LyricsKind, boolean> = { local: false, cloud: false };
  let confirmedState: LyricsStatePayload = { lyric: null, activeKind: "cloud", variants: { local: false, cloud: false } };
  let variantBusy = false;
  let variantRequest: AbortController | undefined;
  let temporarySearchSourceId: string | undefined;
  let sourceRequest: AbortController | undefined;
  let lyricRequest: AbortController | undefined;
  let currentTrackRequestGeneration = 0;
  let trackOperationControllers: AbortController[] = [];
  let spectrumTimer = 0;
  let lyricStatus = trUi("选择一首曲目以读取本机歌词。");
  let lyricNoticeState: LyricsNoticeState = "standby";
  let sourceLoaded = false;
  let searchStatus = trUi("自动匹配优先使用 QQ 音乐，也可手动查找其他版本。");
  let activeMobileQuery: MediaQueryList | undefined;
  let preferenceDialogTrackId = "";
  let preferenceDialogOpener: HTMLElement | null = null;
  let searchBusy = false;
  let activeSearch: AbortController | undefined;
  let archiveQueueSignature = "";

  const workspace = element("div", "lyrics-workspace");
  const archiveLayout = element("div", "lyrics-archive-layout");
  archiveLayout.style.display = "contents";
  const musicApp = host.closest<HTMLElement>(".music-app");
  const left = element("details", "lyrics-side lyrics-left");
  left.open = true;
  const leftSummary = element("summary", "lyrics-side-summary");
  const leftSummaryLabel = element("span", "", trUi("播放与解码"));
  leftSummary.append(element("small", "lyrics-index", "01"), leftSummaryLabel);
  left.append(leftSummary);
  const leftBody = element("div", "lyrics-side-body");

  const transportState = element("div", "lyrics-transport-state");
  const transportDot = element("span", "lyrics-state-dot");
  const transportText = element("span", "lyrics-transport-label", trUi("空闲"));
  transportState.append(transportDot, transportText);
  const leftTrack = element("p", "lyrics-track-reference", trUi("未选择曲目"));
  const decodeBlock = element("div", "lyrics-data-block");
  const decodeHeading = element("div", "lyrics-data-heading", trUi("解码信息"));
  const decodeCodec = element("div", "lyrics-data-row");
  const decodeRate = element("div", "lyrics-data-row");
  const decodeChannels = element("div", "lyrics-data-row");
  const decodeFormat = element("div", "lyrics-data-row");
  decodeBlock.append(decodeHeading, decodeCodec, decodeRate, decodeChannels, decodeFormat);

  const linkBlock = element("div", "lyrics-data-block");
  const linkHeading = element("div", "lyrics-data-heading", trUi("输出链路"));
  const outputBackend = element("div", "lyrics-data-row");
  const outputDevice = element("div", "lyrics-data-row");
  const outputFormat = element("div", "lyrics-data-row");
  const outputStages = element("p", "lyrics-link-stage", trUi("等待播放状态。"));
  linkBlock.append(linkHeading, outputBackend, outputDevice, outputFormat, outputStages);

  const sourceReadouts = element("section", "lyrics-archive-readouts");
  sourceReadouts.hidden = true;
  sourceReadouts.append(element("div", "lyrics-data-heading", "SIGNAL READOUT"));
  const sourcePeak = element("div", "lyrics-data-row");
  const sourceRms = element("div", "lyrics-data-row");
  const sourceStereo = element("div", "lyrics-data-row");
  const sourceRate = element("div", "lyrics-data-row");
  sourceReadouts.append(sourcePeak, sourceRms, sourceStereo, sourceRate);

  const sourceAnalysis = element("section", "lyrics-archive-analysis");
  sourceAnalysis.hidden = true;
  sourceAnalysis.append(element("div", "lyrics-data-heading", "ANALYSIS LOG"));
  const sourceAnalysisRows = Array.from({ length: 5 }, () => element("div", "lyrics-data-row"));
  sourceAnalysis.append(...sourceAnalysisRows);

  const spectrumSection = element("section", "lyrics-spectrum-section");
  const spectrumTitle = element("div", "lyrics-data-heading", trUi("实时频谱 · 32 段"));
  const spectrumBars = element("div", "lyrics-spectrum-bars");
  spectrumBars.setAttribute("role", "img");
  spectrumBars.setAttribute("aria-label", trUi("真实音频频段能量"));
  const barNodes = Array.from({ length: 32 }, (_, index) => {
    const bar = element("i", "lyrics-spectrum-bar");
    bar.setAttribute("aria-hidden", "true");
    bar.dataset.band = String(index);
    spectrumBars.append(bar);
    return bar;
  });
  const spectrumMeta = element("p", "lyrics-spectrum-meta", trUi("等待真实音频频谱数据。"));
  spectrumSection.append(spectrumTitle, spectrumBars, spectrumMeta);
  leftBody.append(transportState, leftTrack, decodeBlock, linkBlock, sourceReadouts, sourceAnalysis);
  left.append(leftBody, spectrumSection);

  const main = element("section", "lyrics-main");
  const mainHeader = element("div", "lyrics-main-header");
  const mainHeading = element("div", "lyrics-main-title");
  const lyricsEyebrow = element("small", "lyrics-eyebrow", trUi("02 / 同步文本"));
  mainHeading.append(lyricsEyebrow, element("h2", "", trUi("歌词")));
  const lineCounter = element("div", "lyrics-line-counter", "— / —");
  const headerActions = element("div", "lyrics-header-actions");
  const cloudTabButton = element("button", "lyrics-dialog-tab", trUi("云歌词"));
  cloudTabButton.type = "button";
  cloudTabButton.setAttribute("role", "tab");
  cloudTabButton.id = "lyrics-options-cloud-tab";
  cloudTabButton.setAttribute("aria-selected", "true");
  cloudTabButton.setAttribute("aria-controls", "lyrics-cloud-panel");
  const trackPreferenceButton = element("button", "lyrics-settings-gear");
  trackPreferenceButton.type = "button";
  trackPreferenceButton.title = trUi("歌词选项");
  trackPreferenceButton.setAttribute("aria-label", trUi("歌词选项"));
  trackPreferenceButton.setAttribute("aria-haspopup", "dialog");
  trackPreferenceButton.setAttribute("aria-controls", "lyrics-options-dialog");
  trackPreferenceButton.setAttribute("aria-expanded", "false");
  trackPreferenceButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m4 4v6"/></svg>';
  mainHeader.append(mainHeading, headerActions);
  const syncTools = element("div", "lyrics-sync-tools");
  const followLabel = element("label", "lyrics-follow-control");
  const followInput = element("input");
  followInput.type = "checkbox";
  followInput.setAttribute("role", "switch");
  followInput.checked = true;
  followLabel.append(followInput, element("span", "", trUi("跟随播放")));
  const resumeFollow = element("button", "lyrics-quiet-button", trUi("回到当前行"));
  resumeFollow.type = "button";
  resumeFollow.hidden = true;
  const currentTimeLabel = element("span", "lyrics-current-time", "00:00 / 00:00");
  syncTools.append(lineCounter, followLabel, resumeFollow, currentTimeLabel);
  const lyricsScroller = element("div", "lyrics-scroller");
  lyricsScroller.tabIndex = 0;
  lyricsScroller.setAttribute("aria-label", trUi("按播放进度同步的歌词"));
  const lyricsList = element("div", "lyrics-lines");
  const archiveLineIndex = element("div", "lyrics-archive-line-index");
  archiveLineIndex.hidden = true;
  archiveLineIndex.setAttribute("aria-hidden", "true");
  lyricsScroller.append(lyricsList, archiveLineIndex);
  const lyricsNotice = element("section", "lyrics-notice");
  lyricsNotice.dataset.state = "standby";
  lyricsNotice.setAttribute("role", "status");
  lyricsNotice.setAttribute("aria-live", "polite");
  lyricsNotice.setAttribute("aria-atomic", "true");
  const noticeFrame = element("div", "lyrics-notice-frame");
  const noticeRail = element("div", "lyrics-notice-rail");
  const noticeSignal = element("span", "lyrics-notice-signal");
  noticeSignal.setAttribute("aria-hidden", "true");
  const noticeRailLabel = element("span", "lyrics-notice-rail-label", "SYSTEM NOTICE");
  const noticeCode = element("span", "lyrics-notice-code", "PLAYBACK · 03");
  noticeRail.append(noticeSignal, noticeRailLabel, noticeCode);
  const noticeBody = element("div", "lyrics-notice-body");
  const noticeEyebrow = element("p", "lyrics-notice-eyebrow", trUi("未载入曲目"));
  const noticeTitle = element("h3", "lyrics-notice-title", "STANDBY");
  const noticeText = element("p", "lyrics-notice-text", trUi("当前没有载入曲目。输出链路待命。"));
  const noticeFoot = element("div", "lyrics-notice-foot");
  const noticeFootLabel = element("span", "lyrics-notice-foot-label", trUi("输出链路"));
  const noticeFootValue = element("span", "lyrics-notice-foot-value", trUi("等待曲目"));
  noticeFoot.append(noticeFootLabel, noticeFootValue);
  const retryLyricsButton = element("button", "lyrics-quiet-button lyrics-retry-button", trUi("重新匹配"));
  retryLyricsButton.type = "button";
  retryLyricsButton.hidden = true;
  noticeBody.append(noticeEyebrow, noticeTitle, noticeText, noticeFoot, retryLyricsButton);
  noticeFrame.append(noticeRail, noticeBody);
  lyricsNotice.append(noticeFrame);
  main.append(mainHeader, syncTools, lyricsScroller, lyricsNotice);

  const right = element("details", "lyrics-side lyrics-right");
  right.open = true;
  const rightSummary = element("summary", "lyrics-side-summary");
  const rightSummaryLabel = element("span", "", trUi("曲目信息"));
  rightSummary.append(element("small", "lyrics-index", "03"), rightSummaryLabel);
  right.append(rightSummary);
  const rightBody = element("div", "lyrics-side-body");
  const coverFrame = element("div", "lyrics-cover-frame");
  const coverImage = element("img", "lyrics-cover");
  coverImage.alt = trUi("专辑封面");
  coverImage.hidden = true;
  const coverPlaceholder = element("div", "lyrics-cover-placeholder", "R");
  coverFrame.append(coverImage, coverPlaceholder);
  const albumTitle = element("h3", "lyrics-album-title", trUi("未选择曲目"));
  const albumArtist = element("p", "lyrics-album-artist", "");
  const albumMeta = element("p", "lyrics-album-meta", "—");

  const archiveProfile = element("section", "lyrics-archive-profile");
  archiveProfile.hidden = true;
  const archiveProfileHeading = element("div", "lyrics-archive-profile-heading");
  archiveProfileHeading.append(element("span", "", "SIGNAL PROFILE"));
  const archiveFileChip = element("span", "lyrics-archive-file", "QUEUE —");
  archiveProfileHeading.append(archiveFileChip);
  const archiveCoverButton = element("button", "lyrics-archive-cover");
  archiveCoverButton.type = "button";
  archiveCoverButton.dataset.action = "locate-playing";
  archiveCoverButton.setAttribute("aria-label", trUi("定位当前歌曲所在专辑"));
  const archiveCoverFrame = element("span", "lyrics-archive-cover-frame");
  const archiveCoverImage = element("img", "lyrics-archive-cover-image");
  archiveCoverImage.alt = trUi("专辑封面，点击定位当前歌曲");
  archiveCoverImage.hidden = true;
  const archiveCoverPlaceholder = element("span", "lyrics-archive-cover-placeholder", "R");
  archiveCoverFrame.append(archiveCoverImage, archiveCoverPlaceholder);
  archiveCoverButton.append(archiveCoverFrame);
  const archiveProfileTags = element("div", "lyrics-archive-profile-tags");
  const archiveTransportTag = element("span", "lyrics-archive-tag", trUi("待机"));
  const archiveFormatTag = element("span", "lyrics-archive-tag", "—");
  const archiveTrackTag = element("span", "lyrics-archive-tag", "—");
  archiveProfileTags.append(archiveTransportTag, archiveFormatTag, archiveTrackTag);
  const archiveTitle = element("h3", "lyrics-archive-title", trUi("暂无信号"));
  const archiveArtist = element("p", "lyrics-archive-artist", "");
  const archiveLoaded = element("div", "lyrics-archive-loaded");
  const archiveLoadedValue = element("span", "lyrics-archive-loaded-value", "—");
  archiveLoaded.append(element("small", "", trUi("曲目信息")), archiveLoadedValue);
  const archiveProfileTable = element("div", "lyrics-archive-table");
  const archiveProfileValues = [
    element("div", "lyrics-archive-table-row"),
    element("div", "lyrics-archive-table-row"),
    element("div", "lyrics-archive-table-row"),
    element("div", "lyrics-archive-table-row"),
  ];
  archiveProfileTable.append(...archiveProfileValues);
  const archivePager = element("div", "lyrics-archive-pager");
  const archivePrevious = element("button", "lyrics-archive-pager-button", "‹");
  archivePrevious.type = "button";
  archivePrevious.dataset.action = "track-previous";
  archivePrevious.title = trUi("上一曲");
  archivePrevious.setAttribute("aria-label", trUi("上一曲"));
  const archiveCurrent = element("button", "lyrics-archive-pager-current", trUi("定位当前曲目"));
  archiveCurrent.type = "button";
  archiveCurrent.dataset.action = "locate-playing";
  archiveCurrent.title = trUi("定位当前歌曲所在专辑");
  const archiveNext = element("button", "lyrics-archive-pager-button", "›");
  archiveNext.type = "button";
  archiveNext.dataset.action = "track-next";
  archiveNext.title = trUi("下一曲");
  archiveNext.setAttribute("aria-label", trUi("下一曲"));
  archivePager.append(archivePrevious, archiveCurrent, archiveNext);
  const archiveQueue = element("section", "lyrics-archive-queue");
  const archiveQueueHeading = element("div", "lyrics-archive-queue-heading");
  const archiveQueueCount = element("small", "lyrics-archive-queue-count", "00");
  archiveQueueHeading.append(element("span", "", trUi("QUEUE / NEXT")), archiveQueueCount);
  const archiveQueueList = element("div", "lyrics-archive-queue-list");
  archiveQueue.append(archiveQueueHeading, archiveQueueList);
  archiveProfile.append(archiveProfileHeading, archiveCoverButton, archiveProfileTags, archiveTitle, archiveArtist, archiveLoaded, archiveProfileTable, archivePager, archiveQueue);

  const offsetSection = element("section", "lyrics-offset-section");
  const offsetHeading = element("div", "lyrics-data-heading", trUi("云歌词校准"));
  offsetSection.append(offsetHeading);
  const offsetControls = element("div", "lyrics-offset-controls");
  const offsetInput = element("input");
  offsetInput.type = "number";
  offsetInput.min = "-30";
  offsetInput.max = "30";
  offsetInput.step = "0.1";
  offsetInput.value = "0";
  offsetInput.setAttribute("aria-label", trUi("歌词偏移秒数，正值让歌词提前"));
  const offsetApply = element("button", "lyrics-quiet-button", trUi("应用"));
  offsetApply.type = "button";
  const offsetMinus = element("button", "lyrics-offset-nudge", "−0.5s");
  offsetMinus.type = "button";
  const offsetPlus = element("button", "lyrics-offset-nudge", "+0.5s");
  offsetPlus.type = "button";
  const offsetReset = element("button", "lyrics-offset-nudge", trUi("归零"));
  offsetReset.type = "button";
  offsetControls.append(offsetInput, offsetApply, offsetMinus, offsetPlus, offsetReset);
  const offsetHint = element("p", "lyrics-help", trUi("正值让歌词相对播放进度提前；LRC 自带 offset 也会保留。"));
  offsetSection.append(offsetControls, offsetHint);

  const sourceSection = element("section", "lyrics-source-section lyrics-search-panel");
  sourceSection.id = "lyrics-cloud-panel";
  sourceSection.setAttribute("role", "tabpanel");
  sourceSection.setAttribute("aria-labelledby", "lyrics-options-cloud-tab");
  sourceSection.hidden = true;
  const sourceSectionHeading = element("div", "lyrics-source-section-heading");
  sourceSectionHeading.append(element("div", "lyrics-data-heading", trUi("搜索来源")));
  const globalSettingsLink = element("button", "lyrics-source-settings-link", trUi("管理来源"));
  globalSettingsLink.type = "button";
  sourceSectionHeading.append(globalSettingsLink);
  const sourceSelect = element("select", "lyrics-source-select");
  sourceSelect.setAttribute("aria-label", trUi("选择本次搜索使用的歌词来源"));
  sourceSectionHeading.append(sourceSelect);
  const queryTitle = element("input", "lyrics-query-input");
  queryTitle.placeholder = trUi("曲名");
  queryTitle.setAttribute("aria-label", trUi("搜索曲名"));
  const queryArtist = element("input", "lyrics-query-input");
  queryArtist.placeholder = trUi("歌手");
  queryArtist.setAttribute("aria-label", trUi("搜索歌手"));
  const queryAlbum = element("input", "lyrics-query-input");
  queryAlbum.placeholder = trUi("专辑（可选）");
  queryAlbum.setAttribute("aria-label", trUi("搜索专辑"));
  const searchButton = element("button", "lyrics-primary-button", trUi("搜索"));
  searchButton.type = "button";
  const importLabel = element("label", "lyrics-import-button");
  importLabel.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M12 11v6m-3-3 3 3 3-3"/></svg>';
  const importCaption = element("span", "", trUi("导入本地歌词"));
  importLabel.append(importCaption);
  importLabel.title = trUi("导入 LRC / TXT");
  const importInput = element("input");
  importInput.type = "file";
  importInput.accept = ".lrc,.txt,text/plain,application/x-subrip";
  importLabel.append(importInput);
  const searchMessage = element("p", "lyrics-help", searchStatus);
  searchMessage.setAttribute("role", "status");
  const sourceOutcomes = element("div", "lyrics-search-outcomes");
  const candidateList = element("div", "lyrics-candidate-list");
  const searchFields = element("div", "lyrics-search-fields");
  searchFields.append(queryTitle, queryArtist, queryAlbum, searchButton);
  sourceSection.append(sourceSectionHeading, searchFields, searchMessage, sourceOutcomes, candidateList);
  headerActions.append(trackPreferenceButton);

  const preferenceDialog = element("div", "lyrics-preference-backdrop");
  preferenceDialog.id = "lyrics-options-dialog";
  preferenceDialog.hidden = true;
  preferenceDialog.setAttribute("data-lyrics-preference-dialog", "true");
  preferenceDialog.setAttribute("aria-hidden", "true");
  const preferencePanel = element("section", "lyrics-preference-dialog");
  preferencePanel.setAttribute("role", "dialog");
  preferencePanel.setAttribute("aria-modal", "true");
  preferencePanel.setAttribute("aria-labelledby", "lyrics-preference-title");
  const preferenceDialogHeader = element("div", "lyrics-preference-header");
  const preferenceDialogTitle = element("h2", "", trUi("歌词选项"));
  preferenceDialogTitle.id = "lyrics-preference-title";
  const preferenceCloseButton = element("button", "lyrics-preference-close", "×");
  preferenceCloseButton.type = "button";
  preferenceCloseButton.setAttribute("aria-label", trUi("关闭歌词选项"));
  preferenceDialogHeader.append(preferenceDialogTitle, preferenceCloseButton);
  const preferenceTrack = element("p", "lyrics-preference-track", trUi("未选择曲目"));
  const preferenceTabs = element("div", "lyrics-dialog-toolbar");
  const preferenceTabList = element("div", "lyrics-dialog-tabs");
  preferenceTabList.setAttribute("role", "tablist");
  preferenceTabList.setAttribute("aria-label", trUi("歌词来源"));
  const localTabButton = element("button", "lyrics-dialog-tab", trUi("本地歌词"));
  localTabButton.type = "button";
  localTabButton.id = "lyrics-options-local-tab";
  localTabButton.setAttribute("role", "tab");
  localTabButton.setAttribute("aria-selected", "false");
  localTabButton.setAttribute("aria-controls", "lyrics-local-panel");
  preferenceTabList.append(localTabButton, cloudTabButton);
  preferenceTabs.append(preferenceTabList);
  const localPanel = element("section", "lyrics-local-panel");
  localPanel.id = "lyrics-local-panel";
  localPanel.setAttribute("role", "tabpanel");
  localPanel.setAttribute("aria-labelledby", "lyrics-options-local-tab");
  localPanel.hidden = true;
  const localStatus = element("p", "lyrics-help");
  localPanel.append(localStatus, importLabel);
  const currentSourceLabel = element("p", "lyrics-current-source lyrics-help");
  const preferenceDialogStatus = element("p", "lyrics-help lyrics-options-status");
  preferenceDialogStatus.setAttribute("role", "status");
  preferencePanel.append(preferenceDialogHeader, preferenceTrack, preferenceTabs, currentSourceLabel, localPanel, sourceSection, offsetSection, preferenceDialogStatus);
  preferenceDialog.append(preferencePanel);

  rightBody.append(archiveProfile, coverFrame, albumTitle, albumArtist, albumMeta);
  right.append(rightBody);
  archiveLayout.append(left, main, right);
  workspace.append(archiveLayout, preferenceDialog);
  host.replaceChildren(workspace);

  const setPair = (row: HTMLElement, label: string, value: string) => {
    if (row.children.length === 2 && row.children[0].textContent === label && row.children[1].textContent === value) return;
    row.replaceChildren(element("span", "lyrics-data-label", label), element("span", "lyrics-data-value", value));
  };

  const setArchivePair = (row: HTMLElement, label: string, value: string) => {
    if (row.children.length === 2 && row.children[0].textContent === label && row.children[1].textContent === value) return;
    row.replaceChildren(element("span", "lyrics-archive-key", label), element("span", "lyrics-archive-value", value));
  };

  function renderArchiveReadouts(latestSpectrum?: SpectrumSnapshot, provided = false): void {
    const state = latestState;
    const track = state?.currentTrack;
    let spectrum = latestSpectrum;
    if (!provided) {
      try { spectrum = callbacks.spectrum(); } catch { spectrum = undefined; }
    }
    const db = (value?: number) => typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "—";
    setPair(sourcePeak, trUi("峰值"), db(spectrum?.peakDb));
    setPair(sourceRms, "RMS", db(spectrum?.rmsDb));
    setPair(sourceStereo, trUi("立体声"), "—");
    setPair(sourceRate, trUi("源采样率"), track ? `${formatRate(track.sampleRate)}${track.bitsPerSample ? ` / ${track.bitsPerSample} bit` : ""}` : "—");

    const gain = track?.replayGain?.trackGainDb;
    const gainText = typeof gain === "number" && Number.isFinite(gain) ? `${gain.toFixed(2)} dB` : "—";
    const lyricText = lyricDocument && lyricDocument.trackId === track?.id
      ? `${lyricDocument.source.name} · ${parsedLyrics?.lines.length ?? 0} ${trUi("行")}${parsedLyrics?.lines.some((line) => line.translation) ? " · 2 LANG" : ""}`
      : track ? trUi("未载入") : "—";
    const output = state?.nativeOutputStatus;
    const backend = state?.backend === "asio" ? "ASIO" : state?.backend === "wasapi" ? "WASAPI" : state?.backend === "browser" ? trUi("浏览器") : "—";
    const outputStages = output?.processingStages?.filter((stage) => stage.active).map(audioStageName) ?? [];
    const outputText = state ? [backend, output?.mode?.toUpperCase(), ...outputStages].filter(Boolean).join(" · ") || trUi("未报告") : "—";
    const queueIndex = state ? state.currentIndex >= 0 ? state.currentIndex : state.queue.findIndex((item) => item.id === state.currentTrack?.id) : -1;
    const nextTrack = state?.queue[queueIndex + 1];
    const decodeText = track ? [track.codec || track.format, track.bitsPerSample ? `${track.bitsPerSample} bit` : "", track.sampleRate ? formatRate(track.sampleRate) : ""].filter(Boolean).join(" · ") : "—";
    setArchivePair(sourceAnalysisRows[0], "DECODE", decodeText);
    setArchivePair(sourceAnalysisRows[1], "REPLAYGAIN", gainText);
    setArchivePair(sourceAnalysisRows[2], "LYRICS", lyricText);
    setArchivePair(sourceAnalysisRows[3], "OUTPUT", outputText);
    setArchivePair(sourceAnalysisRows[4], "NEXT", nextTrack ? `${String(queueIndex + 2).padStart(3, "0")}  ${nextTrack.title}` : trUi("END OF QUEUE"));
  }

  function renderArchiveProfile(): void {
    const state = latestState;
    const track = state?.currentTrack;
    const queue = state?.queue ?? [];
    const reportedIndex = state?.currentIndex ?? -1;
    const trackIndex = reportedIndex >= 0 ? reportedIndex : queue.findIndex((item) => item.id === track?.id);
    archiveFileChip.textContent = trackIndex >= 0 ? `QUEUE ${String(trackIndex + 1).padStart(3, "0")}` : "QUEUE —";
    archiveTransportTag.textContent = state?.transport === "playing"
      ? trUi("播放中")
      : state?.transport === "paused"
        ? trUi("已暂停")
        : state?.transport === "loading"
          ? trUi("载入中")
          : state?.transport === "error"
            ? trUi("错误")
            : trUi("待机");
    archiveTransportTag.dataset.state = state?.transport ?? "idle";
    const hiRes = track?.lossless === true && ((track.bitsPerSample ?? 0) > 16 || (track.sampleRate ?? 0) > 48000);
    archiveFormatTag.textContent = hiRes ? "HI-RES" : track?.lossless === true ? "LOSSLESS" : track?.lossless === false ? "LOSSY" : track?.format || "—";
    archiveTrackTag.textContent = track?.trackNumber
      ? `TRACK ${String(track.trackNumber).padStart(2, "0")}${latestAlbum?.tracks.length ? ` / ${String(latestAlbum.tracks.length).padStart(2, "0")}` : ""}`
      : "TRACK —";
    archiveTitle.textContent = track?.title || trUi("暂无信号");
    archiveArtist.textContent = track?.artist || "";
    archiveLoadedValue.textContent = track
      ? [track.artist, latestAlbum?.title, latestAlbum?.year].filter(Boolean).join(" · ") || trUi("曲目信息已载入")
      : trUi("等待播放");
    archiveCoverButton.disabled = !track;
    archiveCurrent.disabled = !track;
    archivePrevious.disabled = queue.length === 0;
    archiveNext.disabled = trackIndex < 0 || trackIndex >= queue.length - 1;

    const cover = localCoverUrl(latestAlbum?.coverUrl);
    if (cover) {
      if (archiveCoverImage.src !== cover) archiveCoverImage.src = cover;
      archiveCoverImage.hidden = false;
      archiveCoverPlaceholder.hidden = true;
    } else {
      archiveCoverImage.removeAttribute("src");
      archiveCoverImage.hidden = true;
      archiveCoverPlaceholder.hidden = false;
    }

    const gain = track?.replayGain?.trackGainDb;
    const profileValues = [
      [trUi("格式"), track ? [track.codec, track.format].filter(Boolean).join(" · ") || "—" : "—"],
      [trUi("码率"), track?.bitrate ? `${Math.round(track.bitrate / 1000)} kb/s` : "—"],
      [trUi("播放次数"), "—"],
      ["REPLAYGAIN", typeof gain === "number" && Number.isFinite(gain) ? `${gain.toFixed(2)} dB` : "—"],
    ];
    profileValues.forEach(([key, value], index) => {
      const row = archiveProfileValues[index];
      if (row.children.length === 2 && row.children[0].textContent === key && row.children[1].textContent === value) return;
      row.replaceChildren(element("span", "lyrics-archive-key", key), element("span", "lyrics-archive-value", value));
    });

    const nextTracks = trackIndex >= 0 ? queue.slice(trackIndex + 1) : queue;
    const queueSignature = `${trackIndex}|${nextTracks.map((item) => `${item.id}:${item.title}:${item.duration}`).join("|")}`;
    if (archiveQueueCount.textContent !== String(nextTracks.length).padStart(2, "0")) archiveQueueCount.textContent = String(nextTracks.length).padStart(2, "0");
    if (archiveQueueSignature !== queueSignature) {
      archiveQueueSignature = queueSignature;
      archiveQueueList.replaceChildren();
      if (!nextTracks.length) {
        archiveQueueList.append(element("p", "lyrics-archive-queue-empty", trUi("END OF QUEUE")));
      } else {
        nextTracks.forEach((item, offset) => {
          const index = Math.max(0, trackIndex + 1) + offset;
          const button = element("button", "lyrics-queue-row");
          button.type = "button";
          button.dataset.track = item.id;
          button.dataset.queueIndex = String(index);
          button.setAttribute("aria-label", ui`播放队列中的第 ${index + 1} 首：${item.title}`);
          button.append(
            element("span", "lyrics-queue-position", String(index + 1).padStart(3, "0")),
            element("span", "lyrics-queue-title", item.title),
            element("span", "lyrics-queue-duration", formatTime(item.duration)),
          );
          archiveQueueList.append(button);
        });
      }
    }
    renderArchiveReadouts();
  }

  function syncArchiveLayout(): void {
    const archive = musicApp?.dataset.design === "archive";
    workspace.dataset.design = archive ? "archive" : "rhine";
    // Punk now uses the complete existing Future workspace; only its skin differs.
    archiveLayout.style.display = "contents";
    leftSummaryLabel.textContent = trUi("播放与解码");
    rightSummaryLabel.textContent = trUi("曲目信息");
    lyricsEyebrow.textContent = trUi("02 / 同步文本");
    sourceReadouts.hidden = true;
    sourceAnalysis.hidden = true;
    archiveLineIndex.hidden = true;
    archiveProfile.hidden = true;
    coverFrame.hidden = false;
    albumTitle.hidden = false;
    albumArtist.hidden = false;
    albumMeta.hidden = false;
    const compact = activeMobileQuery?.matches ?? window.matchMedia("(max-width: 980px)").matches;
    left.open = !compact;
    right.open = !compact;
    renderArchiveProfile();
  }

  function renderPlayerInfo(): void {
    const state = latestState;
    const track = state?.currentTrack;
    trackPreferenceButton.disabled = !track;
    cloudTabButton.disabled = !track;
    localTabButton.disabled = !track;
    const playing = !!state?.playing;
    transportText.textContent = playing ? trUi("播放中") : track ? state?.transport === "loading" ? trUi("载入中") : trUi("已暂停") : trUi("空闲");
    transportDot.classList.toggle("is-playing", playing);
    transportDot.classList.toggle("is-error", state?.transport === "error");
    leftTrack.textContent = track ? `${track.title} · ${track.artist}` : trUi("未选择曲目");
    const sourceFormat = `${track?.codec ?? ""} ${track?.format ?? ""}`;
    const isDsd = /\bDSD\b|DSD\d+|\bDSF\b|\bDFF\b/iu.test(sourceFormat);
    setPair(decodeCodec, trUi("编码"), track ? processingStageLabel(track.codec || track.format || trUi("未知")) : "—");
    setPair(decodeRate, trUi("源采样率 / 位深"), track ? isDsd ? formatDsdRate(track.sampleRate) : `${formatRate(track.sampleRate)} / ${track.bitsPerSample ? ui`${track.bitsPerSample} 位` : "—"}` : "—");
    setPair(decodeChannels, trUi("声道 / 码率"), track ? `${track.numberOfChannels ? ui`${track.numberOfChannels} 声道` : "—"} / ${track.bitrate ? `${Math.round(track.bitrate / 1000)} kb/s` : "—"}` : "—");
    setPair(decodeFormat, trUi("格式 / 无损"), track ? `${track.format || "—"} / ${track.lossless ? trUi("无损") : "—"}` : "—");

    const output = state?.nativeOutputStatus;
    const backendLabel = state?.backend === "asio" ? "ASIO" : state?.backend === "wasapi" ? "WASAPI" : state?.backend === "browser" ? trUi("浏览器输出") : trUi("等待播放");
    setPair(outputBackend, trUi("后端"), backendLabel);
    const deviceLabel = state?.backend === "browser" ? trUi("跟随系统，设备名不可读取") : output?.deviceName || output?.deviceId || "—";
    setPair(outputDevice, trUi("设备"), deviceLabel);
    const outputRate = output?.mode === "native" ? formatDsdRate(output.dsdRate ?? output.sampleRate) : formatRate(output?.sampleRate);
    const storageBits = output?.bitsPerSample;
    const validBits = output?.validBitsPerSample;
    const outputBits = output?.mode === "native" ? trUi("1 位") : output?.sampleFormat === "float" && storageBits
      ? ui`${storageBits} 位浮点` : validBits && storageBits && validBits !== storageBits
        ? ui`${validBits} 位整数（${storageBits} 位容器）` : storageBits ? ui`${storageBits} 位整数` : "";
    setPair(outputFormat, output?.mode === "dop" ? trUi("DoP 传输格式") : output?.mode === "native" ? trUi("DSD 输出格式") : trUi("播放流格式"), [outputRate, outputBits, output?.channels ? ui`${output.channels} 声道` : ""].filter(Boolean).join(" · "));
    const stages = output?.processingStages?.filter((stage) => stage.active).map(audioStageName);
    outputStages.textContent = state?.error || (output?.capabilities?.bitPerfectActive ? ui`解码直通 · 校验${pcmConsistencyStatus(output)}` : stages?.length ? ui`实际链路 · ${stages.join(" · ")}` : state?.backend === "browser" ? trUi("浏览器音频输出") : trUi("链路 · 未报告"));

    const title = track?.title || latestAlbum?.title || trUi("未选择曲目");
    const artist = track?.artist || latestAlbum?.artist || "";
    albumTitle.textContent = title;
    albumArtist.textContent = artist;
    albumMeta.textContent = [latestAlbum?.year, track?.format, track?.duration ? formatTime(track.duration) : undefined].filter(Boolean).join(" · ") || trUi("Rhine 音乐档案");
    const cover = localCoverUrl(latestAlbum?.coverUrl);
    if (cover) {
      if (coverImage.src !== cover) coverImage.src = cover;
      coverImage.hidden = false;
      coverPlaceholder.hidden = true;
    } else {
      coverImage.removeAttribute("src");
      coverImage.hidden = true;
      coverPlaceholder.hidden = false;
    }
    currentTimeLabel.textContent = `${formatTime(state?.currentTime ?? 0)} / ${formatTime(state?.duration ?? 0)}`;
    renderArchiveProfile();
  }

  function setLyricsNotice(state: LyricsNoticeState, message: string): void {
    const presentation: Record<LyricsNoticeState, { code: string; eyebrow: string; title: string; footLabel: string; footValue: string }> = {
      standby: { code: "PLAYBACK · 03", eyebrow: trUi("未载入曲目"), title: "STANDBY", footLabel: trUi("输出链路"), footValue: trUi("等待曲目") },
      loading: { code: "LYRICS · 03", eyebrow: trUi("正在匹配歌词"), title: trUi("读取中"), footLabel: trUi("歌词记录"), footValue: trUi("缓存优先 · 自动匹配") },
      missing: { code: "LYRICS · 03", eyebrow: trUi("同步文本"), title: trUi("暂无歌词"), footLabel: trUi("歌词记录"), footValue: trUi("无可用文本") },
      error: { code: "LYRICS · 03", eyebrow: trUi("歌词暂时不可用"), title: trUi("读取失败"), footLabel: trUi("请求状态"), footValue: trUi("可重试或手动查找") },
    };
    const view = presentation[state];
    lyricNoticeState = state;
    lyricStatus = message;
    lyricsNotice.dataset.state = state;
    noticeCode.textContent = view.code;
    noticeEyebrow.textContent = view.eyebrow;
    noticeTitle.textContent = view.title;
    noticeText.textContent = message;
    noticeFootLabel.textContent = view.footLabel;
    noticeFootValue.textContent = view.footValue;
    retryLyricsButton.hidden = !latestState?.currentTrack || !!lyricDocument || (activeKind === "local" && lyricVariants.local) || (state !== "missing" && state !== "error");
  }

  function renderLyrics(): void {
    const editable=!!lyricDocument && lyricDocument.trackId === latestState?.currentTrack?.id && kindOfLyric(lyricDocument) === optionsKind && !variantBusy;
    offsetInput.disabled=!editable;
    for(const button of [offsetApply,offsetMinus,offsetPlus,offsetReset])button.disabled=!editable;
    renderArchiveProfile();
    lyricsList.replaceChildren();
    archiveLineIndex.replaceChildren();
    activeLineIndex = -2;
    lineCounter.textContent = "— / —";
    if (!latestState?.currentTrack) {
      setLyricsNotice("standby", trUi("未载入曲目"));
      lyricsNotice.hidden = false;
      return;
    }
    if (!lyricDocument || lyricDocument.trackId !== latestState.currentTrack.id || !parsedLyrics) {
      setLyricsNotice(lyricNoticeState, lyricStatus || trUi("正在检查这首曲目的本机歌词缓存。"));
      lyricsNotice.hidden = false;
      return;
    }
    lyricsNotice.hidden = true;
    if (!parsedLyrics.lines.length) {
      setLyricsNotice("missing", lyricStatus || trUi("歌词记录为空"));
      lyricsNotice.hidden = false;
      return;
    }
    const markerCount = Math.min(64, parsedLyrics.lines.length);
    for (let marker = 0; marker < markerCount; marker += 1) {
      const mark = element("i", "lyrics-archive-line-mark");
      mark.dataset.lineMark = String(marker);
      archiveLineIndex.append(mark);
    }
    parsedLyrics.lines.forEach((line, index) => {
      const row = element("div", "lyrics-line");
      row.dataset.line = String(index);
      if (line.time !== null) {
        const button = element("button", "lyrics-line-button");
        button.type = "button";
        button.append(element("span", "lyrics-line-time", formatTime(line.time)), element("span", "lyrics-line-text", line.text));
        if (line.translation) button.append(element("span", "lyrics-line-translation", line.translation));
        button.addEventListener("click", () => {
          const doc = lyricDocument;
          if (!doc || line.time === null) return;
          callbacks.seek(Math.max(0, line.time - (doc.offsetInText ? 0 : doc.offsetMs) / 1000));
        });
        row.append(button);
      } else {
        const content = element("div", "lyrics-untimed-line");
        content.append(element("span", "lyrics-line-time", "··"), element("span", "lyrics-line-text", line.text));
        if (line.translation) content.append(element("span", "lyrics-line-translation", line.translation));
        row.append(content);
      }
      lyricsList.append(row);
    });
    noticeText.textContent = "";
    updateActiveLine(true);
  }

  function updateArchiveLineIndex(activeIndex: number): void {
    const total = parsedLyrics?.lines.length ?? 0;
    const markerCount = archiveLineIndex.childElementCount;
    archiveLineIndex.querySelectorAll<HTMLElement>(".lyrics-archive-line-mark").forEach((mark) => {
      const marker = Number(mark.dataset.lineMark);
      const activeMarker = activeIndex >= 0 && total > 0 ? Math.min(markerCount - 1, Math.floor(activeIndex * markerCount / total)) : -1;
      mark.dataset.state = marker === activeMarker ? "active" : activeIndex >= 0 && marker < activeMarker ? "passed" : "";
    });
  }

  function updateActiveLine(allowScroll: boolean, force = false): void {
    const state = latestState;
    if (!visible || !state || !parsedLyrics || !lyricDocument || !parsedLyrics.timed) {
      if (!parsedLyrics?.timed) lineCounter.textContent = parsedLyrics?.lines.length ? `— / ${parsedLyrics.lines.length}` : "— / —";
      updateArchiveLineIndex(-1);
      return;
    }
    const current = Math.max(0, state.currentTime + (lyricDocument.offsetInText ? 0 : lyricDocument.offsetMs) / 1000);
    let index = -1;
    for (let i = 0; i < parsedLyrics.lines.length; i += 1) {
      const time = parsedLyrics.lines[i].time;
      if (time !== null && time <= current) index = i;
    }
    if (index === activeLineIndex && !force) return;
    activeLineIndex = index;
    updateArchiveLineIndex(index);
    lineCounter.textContent = index >= 0 ? `${String(index + 1).padStart(2, "0")} / ${String(parsedLyrics.lines.length).padStart(2, "0")}` : `— / ${String(parsedLyrics.lines.length).padStart(2, "0")}`;
    lyricsList.querySelectorAll<HTMLElement>(".lyrics-line").forEach((row) => {
      const active = Number(row.dataset.line) === index;
      row.classList.toggle("is-active", active);
      if (active && allowScroll && followEnabled) {
        row.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }

  function setLyricStatus(message: string): void {
    setLyricsNotice("error", message);
    if (!lyricDocument || lyricDocument.trackId !== latestState?.currentTrack?.id) {
      lyricsNotice.hidden = false;
    }
  }

  function abortTrackOperations(includeAutomatic = true): void {
    if (includeAutomatic) {
      lyricRequest?.abort();
      lyricRequest = undefined;
      lyricRequestTrackId = "";
    }
    for (const controller of trackOperationControllers) {
      if (includeAutomatic || controller !== variantRequest) controller.abort();
    }
    if (includeAutomatic) {
      if (variantBusy) lyricAttemptSignature = "";
      variantRequest = undefined;
      variantBusy = false;
      trackOperationControllers = [];
    } else {
      // A chosen source is a save operation. Leaving the page must not cancel
      // that choice and let the previous source reappear on return.
      trackOperationControllers = trackOperationControllers.filter(controller => controller === variantRequest);
    }
    activeSearch = undefined;
    searchBusy = false;
  }

  async function loadCurrentLyric(force = false): Promise<void> {
    const trackId = latestState?.currentTrack?.id;
    if (!trackId || disposed || variantBusy) return;
    if (!force && (lyricDocument?.trackId === trackId || lyricRequestTrackId === trackId || lyricAttemptSignature === activeMetadataSignature)) return;
    lyricRequest?.abort();
    const controller = new AbortController();
    lyricRequest = controller;
    lyricRequestTrackId = trackId;
    const signature = activeMetadataSignature;
    const generation = ++currentTrackRequestGeneration;
    setLyricsNotice("loading", trUi("正在读取缓存并自动匹配歌词…"));
    try {
      const response = await fetch("/api/lyrics/resolve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId }), signal: controller.signal,
      });
      const payload = await responseJson<LyricsStatePayload & { sources?: Array<{ status: "ok" | "empty" | "error" }> }>(response);
      if (disposed || controller.signal.aborted || generation !== currentTrackRequestGeneration || latestState?.currentTrack?.id !== trackId) return;
      lyricDocument = payload.lyric?.trackId === trackId ? payload.lyric : null;
      activeKind = payload.activeKind ?? (lyricDocument ? kindOfLyric(lyricDocument) : "cloud");
      lyricVariants = payload.variants ?? { local: !!lyricDocument && activeKind === "local", cloud: !!lyricDocument && activeKind === "cloud" };
      confirmedState = { ...payload, lyric: lyricDocument, activeKind, variants: lyricVariants };
      selectOptionsKind(activeKind);
      parsedLyrics = lyricDocument ? parseLyrics(lyricDocument.lrc, lyricDocument.translation ?? "") : null;
      if (lyricDocument) {
        setLyricsNotice("missing", trUi("歌词记录为空"));
        offsetInput.value = (lyricDocument.offsetMs / 1000).toFixed(1);
        searchStatus = ui`当前歌词源：${lyricSourceLabel(lyricDocument.source) || trUi("未知来源")}`;
        searchMessage.textContent = searchStatus;
      } else {
        const unavailable = !!payload.sources?.length && payload.sources.every(source => source.status === "error");
        setLyricsNotice(unavailable ? "error" : "missing", activeKind === "local" ? trUi("无本地歌词，也暂无可用的云歌词。") : unavailable
          ? trUi("歌词来源暂时不可用，可重新匹配或手动查找。")
          : trUi("未找到可靠匹配，可重新匹配或手动选择其他版本。"));
      }
      renderLyrics();
      renderPreferenceDialog();
    } catch (error) {
      if (controller.signal.aborted || disposed || generation !== currentTrackRequestGeneration || latestState?.currentTrack?.id !== trackId) return;
      lyricDocument = null;
      parsedLyrics = null;
      setLyricStatus(ui`匹配歌词失败：${error instanceof Error ? error.message : trUi("未知错误")}`);
      renderLyrics();
    } finally {
      if (lyricRequest === controller) {
        lyricRequest = undefined;
        lyricRequestTrackId = "";
        if (!controller.signal.aborted) lyricAttemptSignature = signature;
      }
    }
  }

  function cancelAutomaticLyric(): void {
    lyricRequest?.abort();
    lyricRequest = undefined;
    lyricRequestTrackId = "";
    lyricAttemptSignature = activeMetadataSignature;
    currentTrackRequestGeneration += 1;
    if (!lyricDocument) {
      setLyricsNotice("missing", trUi("可手动选择歌词，或重新自动匹配。"));
      renderLyrics();
    }
  }

  function renderSourceChoices(): void {
    sourceSelect.replaceChildren();
    const available = sourceList.filter((source) => source.enabled);
    if (!available.length) {
      const option = element("option", "", sourceLoaded ? trUi("没有已启用的来源") : trUi("正在读取来源…"));
      option.value = "";
      sourceSelect.append(option);
      sourceSelect.disabled = true;
      searchButton.disabled = true;
      return;
    }
    for (const source of available) {
      const option = element("option", "", `${lyricSourceLabel(source)}${source.builtin ? trUi(" · 内置") : trUi(" · 自定义")}`);
      option.value = source.id;
      sourceSelect.append(option);
    }
    const automatic = element("option", "", trUi("多来源搜索"));
    automatic.value = "auto";
    sourceSelect.prepend(automatic);
    sourceSelect.disabled = searchBusy;
    const preferredId = temporarySearchSourceId ?? globalSettings?.defaultSourceId;
    sourceSelect.value = preferredId === "auto" || available.some((source) => source.id === preferredId) ? preferredId! : available[0].id;
    if (temporarySearchSourceId && temporarySearchSourceId !== "auto" && !available.some((source) => source.id === temporarySearchSourceId)) temporarySearchSourceId = undefined;
    searchButton.disabled = searchBusy;
  }

  function sourceName(sourceId?: string): string {
    return lyricSourceLabel(sourceList.find((source) => source.id === sourceId)) || trUi("未配置可用来源");
  }

  function renderPreferenceDialog(): void {
    const track = latestState?.currentTrack;
    preferenceTrack.textContent = track ? `${track.title} · ${track.artist}` : trUi("未选择曲目");
    currentSourceLabel.textContent = lyricDocument
      ? kindOfLyric(lyricDocument) === "local" ? trUi("当前使用：本地歌词") : ui`当前使用：云歌词 · ${lyricSourceLabel(lyricDocument.source)}`
      : trUi("当前暂无歌词");
    localStatus.textContent = lyricVariants.local
      ? trUi("本地副本已保留。重新导入只替换本地歌词，云歌词及其校准保持不变。")
      : trUi("无本地歌词，使用云歌词。");
    importCaption.textContent = lyricVariants.local ? trUi("重新导入本地歌词") : trUi("导入本地歌词");
    offsetHeading.textContent = optionsKind === "local" ? trUi("本地歌词校准") : trUi("云歌词校准");
    offsetHint.textContent = optionsKind === "local"
      ? trUi("仅保存本地副本的校准，不改原文件或云歌词。正值让歌词提前。")
      : trUi("仅保存云歌词的校准，不改变本地歌词。正值让歌词提前。");
    const current = lyricDocument && kindOfLyric(lyricDocument) === optionsKind ? lyricDocument : null;
    if (document.activeElement !== offsetInput) offsetInput.value = current ? (current.offsetMs / 1000).toFixed(1) : "0.0";
    const disabled = !track || !current || variantBusy;
    offsetInput.disabled = disabled;
    for (const button of [offsetApply, offsetMinus, offsetPlus, offsetReset]) button.disabled = disabled;
  }

  function closePreferenceDialog(restoreFocus = true): void {
    if (preferenceDialog.hidden) return;
    cancelActiveSearch();
    preferenceDialog.hidden = true;
    sourceSection.hidden = true;
    trackPreferenceButton.setAttribute("aria-expanded", "false");
    preferenceDialog.setAttribute("aria-hidden", "true");
    preferenceDialogTrackId = "";
    const opener = preferenceDialogOpener;
    preferenceDialogOpener = null;
    if (restoreFocus && opener?.isConnected) opener.focus();
  }

  function openPreferenceDialog(): void {
    const trackId = latestState?.currentTrack?.id;
    if (!trackId) {
      callbacks.notify(trUi("请先选择一首曲目，再设置本曲歌词来源。"));
      return;
    }
    preferenceDialogTrackId = trackId;
    preferenceDialogOpener = trackPreferenceButton;
    preferenceDialog.hidden = false;
    trackPreferenceButton.setAttribute("aria-expanded", "true");
    preferenceDialog.setAttribute("aria-hidden", "false");
    preferenceDialogStatus.textContent = "";
    renderPreferenceDialog();
    selectOptionsKind(activeKind);
    (activeKind === "local" ? localTabButton : cloudTabButton).focus();
    if (!sourceLoaded) void loadSources(true);
  }

  async function loadSources(force = false): Promise<void> {
    if (!visible || disposed || (sourceLoaded && !force)) return;
    sourceRequest?.abort();
    const controller = new AbortController();
    sourceRequest = controller;
    try {
      const response = await fetch("/api/lyrics/settings", { signal: controller.signal });
      const payload = await responseJson<{ settings: LyricsGlobalSettings; sources: LyricsSource[] }>(response);
      if (controller.signal.aborted || disposed) return;
      globalSettings = payload.settings;
      sourceList = Array.isArray(payload.sources) ? payload.sources : [];
      sourceLoaded = true;
      renderSourceChoices();
      renderPreferenceDialog();
    } catch (error) {
      if (controller.signal.aborted || disposed) return;
      sourceLoaded = false;
      searchMessage.textContent = ui`读取歌词设置失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
      renderSourceChoices();
      renderPreferenceDialog();
    } finally {
      if (sourceRequest === controller) sourceRequest = undefined;
    }
  }

  function beginTrackOperation(): { controller: AbortController; trackId: string; generation: number } | null {
    const trackId = latestState?.currentTrack?.id;
    if (!trackId || !visible) {
      callbacks.notify(trUi("请先选择一首曲目。"));
      return null;
    }
    const controller = new AbortController();
    trackOperationControllers.push(controller);
    return { controller, trackId, generation: currentTrackRequestGeneration };
  }

  function isCurrentOperation(operation: { controller: AbortController; trackId: string; generation: number }, requireVisible = true): boolean {
    return !disposed && (!requireVisible || visible) && !operation.controller.signal.aborted && latestState?.currentTrack?.id === operation.trackId && currentTrackRequestGeneration === operation.generation;
  }

  async function acceptLyric(payload: LyricsStatePayload, trackId: string, operation?: { controller: AbortController; trackId: string; generation: number }, clearCandidates = false, allowHidden = false): Promise<void> {
    if (latestState?.currentTrack?.id !== trackId || (operation && !isCurrentOperation(operation, !allowHidden))) return;
    lyricRequest?.abort();
    lyricRequest = undefined;
    lyricRequestTrackId = "";
    lyricAttemptSignature = activeMetadataSignature;
    lyricDocument = payload.lyric?.trackId === trackId ? payload.lyric : null;
    activeKind = payload.activeKind;
    lyricVariants = payload.variants;
    confirmedState = { ...payload, lyric: lyricDocument };
    parsedLyrics = lyricDocument ? parseLyrics(lyricDocument.lrc, lyricDocument.translation ?? "") : null;
    selectOptionsKind(activeKind);
    setLyricsNotice("missing", lyricDocument ? trUi("歌词记录为空") : activeKind === "local"
      ? trUi("无本地歌词，也暂无可用的云歌词。") : trUi("搜索并选择一个云歌词版本。"));
    searchStatus = lyricDocument ? ui`当前歌词源：${lyricSourceLabel(lyricDocument.source) || trUi("来源未知")}` : trUi("搜索并选择一个云歌词版本。");
    searchMessage.textContent = searchStatus;
    preferenceDialogStatus.textContent = "";
    if (clearCandidates) { candidateList.replaceChildren(); sourceOutcomes.replaceChildren(); }
    renderLyrics();
    renderPreferenceDialog();
  }

  function selectOptionsKind(kind: LyricsKind): void {
    optionsKind = kind;
    sourceSection.hidden = kind !== "cloud";
    localPanel.hidden = kind !== "local";
    cloudTabButton.setAttribute("aria-selected", String(kind === "cloud"));
    localTabButton.setAttribute("aria-selected", String(kind === "local"));
    cloudTabButton.tabIndex = kind === "cloud" ? 0 : -1;
    localTabButton.tabIndex = kind === "local" ? 0 : -1;
    renderPreferenceDialog();
  }

  async function activateVariant(kind: LyricsKind, runSearch = false): Promise<void> {
    const previous = confirmedState;
    cancelAutomaticLyric();
    variantRequest?.abort();
    variantRequest = undefined;
    variantBusy = false;
    abortTrackOperations(false);
    activeKind = kind;
    selectOptionsKind(kind);
    const keepCloud = kind === "local" && !lyricVariants.local && lyricVariants.cloud && lyricDocument && kindOfLyric(lyricDocument) === "cloud";
    if (lyricDocument && kindOfLyric(lyricDocument) !== kind && !keepCloud) { lyricDocument = null; parsedLyrics = null; }
    setLyricsNotice("loading", trUi("正在切换歌词来源…"));
    renderLyrics();
    const operation = beginTrackOperation();
    if (!operation) return;
    variantRequest = operation.controller;
    variantBusy = true;
    preferenceDialogStatus.textContent = trUi("正在切换歌词来源…");
    renderPreferenceDialog();
    let accepted = false;
    try {
      const response = await fetch("/api/lyrics/variant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: operation.trackId, kind }), signal: operation.controller.signal,
      });
      const payload = await responseJson<LyricsStatePayload>(response);
      if (!isCurrentOperation(operation, false)) return;
      await acceptLyric(payload, operation.trackId, operation, true, true);
      preferenceDialogStatus.textContent = "";
      accepted = true;
    } catch (error) {
      if (!isCurrentOperation(operation, false)) return;
      activeKind = previous.activeKind;
      lyricDocument = previous.lyric;
      parsedLyrics = lyricDocument ? parseLyrics(lyricDocument.lrc, lyricDocument.translation ?? "") : null;
      lyricVariants = previous.variants;
      selectOptionsKind(activeKind);
      preferenceDialogStatus.textContent = ui`切换歌词来源失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
      setLyricStatus(preferenceDialogStatus.textContent);
      renderLyrics();
    } finally {
      trackOperationControllers = trackOperationControllers.filter(controller => controller !== operation.controller);
      if (variantRequest === operation.controller) {
        variantRequest = undefined;
        variantBusy = false;
        if (!disposed) renderPreferenceDialog();
      }
    }
    if (accepted && runSearch && isCurrentOperation(operation) && optionsKind === "cloud") await openSearch();
    if (accepted && isCurrentOperation(operation, false) && activeKind === "local" && !lyricVariants.local && !lyricVariants.cloud) await loadCurrentLyric(true);
  }

  function cancelActiveSearch(): void {
    activeSearch?.abort();
    activeSearch = undefined;
    searchBusy = false;
    renderSourceChoices();
  }

  async function openSearch(run = true): Promise<void> {
    const trackId = latestState?.currentTrack?.id;
    const generation = currentTrackRequestGeneration;
    if (!trackId) { searchMessage.textContent = trUi("请先选择一首歌曲。"); return; }
    if (!sourceLoaded) {
      searchMessage.textContent = trUi("正在读取歌词来源…");
      await loadSources();
    }
    if (!visible || disposed || preferenceDialog.hidden || optionsKind !== "cloud" || generation !== currentTrackRequestGeneration || latestState?.currentTrack?.id !== trackId) return;
    if (run && !searchBusy && !candidateList.children.length) await searchLyrics();
  }

  async function searchLyrics(): Promise<void> {
    if (searchBusy || optionsKind !== "cloud") return;
    const sourceId = sourceSelect.value;
    if (!sourceId) { searchMessage.textContent = trUi("没有已启用的来源，请到“管理来源”添加或启用。"); return; }
    if (lyricRequest && visible) cancelAutomaticLyric();
    const operation = beginTrackOperation();
    if (!operation) return;
    activeSearch = operation.controller;
    searchBusy = true;
    renderSourceChoices();
    candidateList.replaceChildren();
    sourceOutcomes.replaceChildren();
    searchMessage.textContent = sourceId === "auto" ? trUi("正在检索已启用的歌词来源…") : ui`正在搜索${sourceName(sourceId)}…`;
    try {
      const response = await fetch("/api/lyrics/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: operation.trackId, sourceId, query: { title: queryTitle.value.trim(), artist: queryArtist.value.trim(), album: queryAlbum.value.trim() } }),
        signal: operation.controller.signal,
      });
      const payload = await responseJson<{ candidates: LyricsCandidate[]; sourceName: string; sources?: Array<{sourceId: string; name: string; status: "ok"|"empty"|"error"; count?: number; message?: string}> }>(response);
      if (!isCurrentOperation(operation)) return;
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      const outcomes = Array.isArray(payload.sources) ? payload.sources : [];
      for (const source of outcomes) {
        const row = element("div", "lyrics-search-outcome");
        row.dataset.status = source.status;
        row.append(element("strong", "", lyricSourceLabel(source)), element("span", "", source.status === "ok" ? ui`${source.count ?? 0} 个候选` : source.status === "empty" ? trUi("未找到匹配") : source.message || trUi("暂时不可用")));
        sourceOutcomes.append(row);
      }
      searchMessage.textContent = candidates.length ? ui`找到 ${candidates.length} 个候选 · 选择对应版本` : outcomes.length && outcomes.every(source=>source.status === "error") ? trUi("歌词来源暂时不可用，可换源或导入本地歌词。") : trUi("未找到匹配，试试只保留曲名和歌手，或换一个来源。");
      candidateList.replaceChildren();
      candidates.forEach((candidate) => {
        const card = element("article", "lyrics-candidate-card");
        const text = element("div", "lyrics-candidate-text");
        text.append(element("strong", "", candidate.title || trUi("未知曲名")), element("span", "", `${candidate.artist || trUi("未知歌手")} · ${candidate.album || trUi("专辑未知")}`));
        const meta = element("small", "", [sourceName(candidate.sourceId), candidate.duration ? formatTime(candidate.duration) : ""].filter(Boolean).join(" · "));
        const select = element("button", "lyrics-quiet-button", trUi("使用"));
        select.type = "button";
        select.addEventListener("click", () => { void selectCandidate(candidate, operation.trackId); });
        card.append(text, meta, select);
        candidateList.append(card);
      });
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      searchMessage.textContent = ui`搜索失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
    } finally {
      trackOperationControllers = trackOperationControllers.filter((controller) => controller !== operation.controller);
      if (activeSearch === operation.controller) {
        activeSearch = undefined;
        searchBusy = false;
        if (!disposed && visible) renderSourceChoices();
      }
    }
  }

  async function selectCandidate(candidate: LyricsCandidate, trackId: string): Promise<void> {
    if (latestState?.currentTrack?.id !== trackId || !visible || optionsKind !== "cloud") return;
    cancelAutomaticLyric();
    const operation = beginTrackOperation();
    if (!operation || operation.trackId !== trackId) return;
    searchMessage.textContent = ui`正在保存候选歌词：${candidate.title} · ${candidate.artist}…`;
    try {
      const response = await fetch("/api/lyrics/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId, sourceId: candidate.sourceId, candidateId: candidate.id }),
        signal: operation.controller.signal,
      });
      const payload = await responseJson<LyricsStatePayload>(response);
      if (!isCurrentOperation(operation)) return;
      await acceptLyric(payload, trackId, operation, true);
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      searchMessage.textContent = ui`保存候选失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
    } finally {
      trackOperationControllers = trackOperationControllers.filter((controller) => controller !== operation.controller);
    }
  }

  async function importLyrics(file?: File): Promise<void> {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      searchMessage.textContent = trUi("文件超过 96 KiB，请选择更小的 LRC / TXT 文件。");
      preferenceDialogStatus.textContent = searchMessage.textContent;
      importInput.value = "";
      return;
    }
    if (!latestState?.currentTrack || !visible || optionsKind !== "local") return;
    cancelAutomaticLyric();
    variantRequest?.abort();
    variantRequest = undefined;
    variantBusy = false;
    const operation = beginTrackOperation();
    if (!operation) return;
    searchMessage.textContent = ui`正在读取 ${file.name}…`;
    preferenceDialogStatus.textContent = searchMessage.textContent;
    try {
      const bytes = await file.arrayBuffer();
      let lrc: string;
      try {
        lrc = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new Error(trUi("请选择 UTF-8 编码的 LRC / TXT 文件。"));
      }
      if (!isCurrentOperation(operation)) return;
      if (new Blob([lrc]).size > MAX_IMPORT_BYTES) throw new Error(trUi("文件超过 96 KiB。"));
      const response = await fetch("/api/lyrics/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: operation.trackId, lrc }),
        signal: operation.controller.signal,
      });
      const payload = await responseJson<LyricsStatePayload>(response);
      if (!isCurrentOperation(operation)) return;
      await acceptLyric(payload, operation.trackId, operation, true);
    } catch (error) {
      if (isCurrentOperation(operation)) {
        searchMessage.textContent = ui`导入失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
        preferenceDialogStatus.textContent = searchMessage.textContent;
      }
    } finally {
      trackOperationControllers = trackOperationControllers.filter((controller) => controller !== operation.controller);
      if (!disposed && visible) importInput.value = "";
    }
  }

  async function saveOffset(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < -30 || seconds > 30) {
      callbacks.notify(trUi("歌词偏移需为 -30 至 30 秒的数字。"));
      return;
    }
    if (!lyricDocument || !latestState?.currentTrack || kindOfLyric(lyricDocument) !== optionsKind || variantBusy) {
      callbacks.notify(trUi("先为当前曲目载入或保存歌词，再设置偏移。"));
      return;
    }
    const operation = beginTrackOperation();
    if (!operation) return;
    const offsetMs = Math.round(clamp(seconds, -30, 30) * 1000);
    offsetApply.disabled = true;
    try {
      const response = await fetch("/api/lyrics/offset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: operation.trackId, offsetMs, kind: optionsKind }),
        signal: operation.controller.signal,
      });
      const payload = await responseJson<LyricsStatePayload>(response);
      if (!isCurrentOperation(operation)) return;
      await acceptLyric(payload, operation.trackId, operation);
    } catch (error) {
      if (isCurrentOperation(operation)) searchMessage.textContent = ui`保存偏移失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
    } finally {
      trackOperationControllers = trackOperationControllers.filter((controller) => controller !== operation.controller);
      if (!disposed && visible) renderPreferenceDialog();
    }
  }

  function handlePreferenceEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape" || preferenceDialog.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    closePreferenceDialog();
  }

  function renderSpectrum(): void {
    if (!visible || disposed) return;
    let snapshot: SpectrumSnapshot | undefined;
    try { snapshot = callbacks.spectrum(); } catch { snapshot = undefined; }
    if (!snapshot?.available || !Array.isArray(snapshot.bands) || snapshot.bands.length === 0) {
      spectrumSection.classList.add("is-unavailable");
      const reasons:Record<string,string>={paused:trUi("已暂停"),stopped:trUi("未播放"),buffering:trUi("缓冲中"),"raw DSD/DoP data is not PCM spectrum":trUi("DSD 位流 · 无 PCM 频谱")};
      const reason=snapshot?.reason??'';
      spectrumMeta.textContent = reasons[reason] || reason || trUi("频谱暂不可用");
      barNodes.forEach((bar) => { bar.style.transform = "scaleY(0)"; });
      renderArchiveReadouts(snapshot, true);
      return;
    }
    spectrumSection.classList.remove("is-unavailable");
    const bands = snapshot.bands;
    for (let index = 0; index < barNodes.length; index += 1) {
      const sourceIndex = Math.min(bands.length - 1, Math.floor(index * bands.length / barNodes.length));
      const value = Number.isFinite(bands[sourceIndex]) ? clamp(bands[sourceIndex], 0, 1) : 0;
      barNodes[index].style.transform = `scaleY(${value.toFixed(3)})`;
    }
    const rate=snapshot.sampleRate;
    spectrumMeta.textContent = rate&&Number.isFinite(rate)&&rate>0?`20 Hz — ${Math.min(20000,rate/2)/1000} kHz · ${formatRate(rate)}`:trUi("32 个实时频段");
    renderArchiveReadouts(snapshot, true);
  }

  function startVisibleRefresh(): void {
    if (!visible || disposed || spectrumTimer) return;
    renderSpectrum();
    updateActiveLine(true, true);
    spectrumTimer = window.setInterval(() => {
      renderSpectrum();
      updateActiveLine(true);
    }, 100);
  }

  function stopVisibleRefresh(): void {
    if (spectrumTimer) window.clearInterval(spectrumTimer);
    spectrumTimer = 0;
  }

  followInput.addEventListener("change", () => {
    followEnabled = followInput.checked;
    resumeFollow.hidden = followEnabled;
    if (followEnabled) updateActiveLine(true, true);
  });
  resumeFollow.addEventListener("click", () => {
    followEnabled = true;
    followInput.checked = true;
    resumeFollow.hidden = true;
    updateActiveLine(true, true);
  });
  function resetFollow(): void {
    followEnabled = true;
    followInput.checked = true;
    resumeFollow.hidden = true;
  }
  function pauseFollow(): void {
    if (!visible) return;
    followEnabled = false;
    followInput.checked = false;
    resumeFollow.hidden = false;
  }
  // Native smooth scrolling may continue for more than one frame. Only user
  // scroll gestures suspend following; layout and playback scrolling never do.
  lyricsScroller.addEventListener("wheel", event => {
    if (event.deltaY || event.deltaX) pauseFollow();
  }, { passive: true });
  lyricsScroller.addEventListener("touchmove", pauseFollow, { passive: true });
  lyricsScroller.addEventListener("pointerdown", event => {
    const bounds = lyricsScroller.getBoundingClientRect();
    if (event.target === lyricsScroller && event.clientX >= bounds.left + lyricsScroller.clientWidth) pauseFollow();
  });
  lyricsScroller.addEventListener("keydown", event => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key) &&
        !(event.target instanceof Element && event.target.closest("button, input, select, textarea, a"))) pauseFollow();
  }, { passive: true });
  retryLyricsButton.addEventListener("click", () => { void loadCurrentLyric(true); });
  searchButton.addEventListener("click", () => { void searchLyrics(); });
  cloudTabButton.addEventListener("click", () => { void activateVariant("cloud", true); });
  localTabButton.addEventListener("click", () => {
    void activateVariant("local");
  });
  preferenceTabList.addEventListener("keydown", event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const target = event.key === "Home" ? localTabButton : event.key === "End" ? cloudTabButton : document.activeElement === localTabButton ? cloudTabButton : localTabButton;
    localTabButton.tabIndex = target === localTabButton ? 0 : -1;
    cloudTabButton.tabIndex = target === cloudTabButton ? 0 : -1;
    target.focus();
  });
  for (const input of [queryTitle, queryArtist, queryAlbum]) input.addEventListener("keydown", event => {
    if(event.key === "Enter" && !event.isComposing) { event.preventDefault(); void searchLyrics(); }
  });
  sourceSelect.addEventListener("change", () => { temporarySearchSourceId = sourceSelect.value || undefined; });
  globalSettingsLink.addEventListener("click", () => callbacks.openSettings());
  trackPreferenceButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPreferenceDialog();
  });
  preferenceCloseButton.addEventListener("click", () => closePreferenceDialog());
  preferenceDialog.addEventListener("click", (event) => {
    if (event.target === preferenceDialog) closePreferenceDialog();
  });
  preferencePanel.addEventListener("click", (event) => event.stopPropagation());
  window.addEventListener("keydown", handlePreferenceEscape, true);
  importInput.addEventListener("change", () => { void importLyrics(importInput.files?.[0]); });
  offsetApply.addEventListener("click", () => {
    if (!offsetInput.value.trim()) { callbacks.notify(trUi("请填写歌词偏移秒数。")); return; }
    void saveOffset(Number(offsetInput.value));
  });
  offsetMinus.addEventListener("click", () => { const next = clamp((Number(offsetInput.value) || 0) - 0.5, -30, 30); offsetInput.value = next.toFixed(1); void saveOffset(next); });
  offsetPlus.addEventListener("click", () => { const next = clamp((Number(offsetInput.value) || 0) + 0.5, -30, 30); offsetInput.value = next.toFixed(1); void saveOffset(next); });
  offsetReset.addEventListener("click", () => { offsetInput.value = "0.0"; void saveOffset(0); });
  activeMobileQuery = window.matchMedia("(max-width: 980px)");
  const syncResponsiveDetails = () => {
    if (!activeMobileQuery) return;
    left.open = !activeMobileQuery.matches;
    right.open = !activeMobileQuery.matches;
  };
  syncResponsiveDetails();
  activeMobileQuery.addEventListener("change", syncResponsiveDetails);
  const designObserver = musicApp ? new MutationObserver(syncArchiveLayout) : undefined;
  designObserver?.observe(musicApp!, { attributes: true, attributeFilter: ["data-design"] });
  syncArchiveLayout();

  return {
    update(state, album) {
      if (disposed) return;
      const nextTrackId = state.currentTrack?.id ?? "";
      const trackChanged = nextTrackId !== activeTrackId;
      const signature = JSON.stringify([nextTrackId, state.currentTrack?.title ?? "", state.currentTrack?.artist ?? "", album?.title ?? ""]);
      const metadataChanged = signature !== activeMetadataSignature;
      activeMetadataSignature = signature;
      latestState = state;
      latestAlbum = album;
      renderPlayerInfo();
      if (trackChanged) {
        activeTrackId = nextTrackId;
        currentTrackRequestGeneration += 1;
        abortTrackOperations();
        lyricAttemptSignature = "";
        resetFollow();
        candidateList.replaceChildren();
        sourceOutcomes.replaceChildren();
        searchMessage.textContent = trUi("按曲名与歌手搜索，专辑用于区分版本。");
        activeKind = "cloud";
        optionsKind = "cloud";
        lyricVariants = { local: false, cloud: false };
        confirmedState = { lyric: null, activeKind: "cloud", variants: lyricVariants };
        temporarySearchSourceId = undefined;
        if (preferenceDialogTrackId) closePreferenceDialog();
        renderSourceChoices();
        lyricDocument = null;
        parsedLyrics = null;
        offsetInput.value = "0";
        if (nextTrackId) {
          queryTitle.value = state.currentTrack?.title ?? "";
          queryArtist.value = state.currentTrack?.artist ?? "";
          queryAlbum.value = album?.title ?? "";
          setLyricsNotice("loading", trUi("正在读取缓存并自动匹配歌词…"));
        } else {
          setLyricsNotice("standby", trUi("未载入曲目"));
        }
        renderLyrics();
        if (nextTrackId) {
          void loadCurrentLyric();
        }
      } else if (album) {
        latestAlbum = album;
        if(!queryAlbum.value && document.activeElement !== queryAlbum)queryAlbum.value = album.title;
      }
      if (!trackChanged && metadataChanged && nextTrackId && !lyricDocument) void loadCurrentLyric(true);
      if (visible) updateActiveLine(true);
    },
    setVisible(nextVisible) {
      if (disposed || visible === nextVisible) return;
      visible = nextVisible;
      if (visible) {
        resetFollow();
        startVisibleRefresh();
        importInput.value = "";
        renderSourceChoices();
        offsetApply.disabled = !lyricDocument;
        void loadSources(true);
        if (!variantBusy && latestState?.currentTrack?.id && latestState.currentTrack.id !== lyricDocument?.trackId) void loadCurrentLyric();
      } else {
        stopVisibleRefresh();
        closePreferenceDialog(false);
        abortTrackOperations(false);
        sourceRequest?.abort();
        sourceRequest = undefined;
      }
      renderArchiveProfile();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      stopVisibleRefresh();
      sourceRequest?.abort();
      abortTrackOperations();
      window.removeEventListener("keydown", handlePreferenceEscape, true);
      activeMobileQuery?.removeEventListener("change", syncResponsiveDetails);
      designObserver?.disconnect();
      host.replaceChildren();
    },
  };
}
