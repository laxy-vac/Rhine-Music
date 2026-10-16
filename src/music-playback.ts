import { trUi, ui } from "./i18n";
import type { MusicPlayerState } from "./music-player";
import type { MusicTrack } from "./music-types";
import { enhanceSettingsSelectControls } from "./settings-select-controls";
import "./playback-select.css";

const glyph = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const icon = (path: string, extra = "") =>
  `<span class="playback-glyph ${extra}" aria-hidden="true">${glyph(path)}</span>`;

export const playbackMarkup = () => ui`
<section id="music-playback" class="music-playback" aria-label="当前歌曲播放控制" hidden>
  <div class="playback-glass" aria-hidden="true"><i class="playback-glint"></i></div>
  <div class="playback-buttons" role="group" aria-label="切换与播放">
    <button data-action="track-previous" aria-label="上一曲或回到开头" title="上一曲／回到开头">${icon('<path d="M4 5v14m15-14L8 12l11 7Z" fill="currentColor" stroke="none"/><path d="M4 5v14"/>')}</button>
    <button id="playback-toggle" data-action="play-pause" aria-label="播放" aria-pressed="false">
      ${icon('<path d="m8 4.5 12 7.5-12 7.5Z" fill="currentColor" stroke="none"/>', "playback-play")}
      ${icon('<rect x="7" y="5" width="3" height="14" rx=".8" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3" height="14" rx=".8" fill="currentColor" stroke="none"/>', "playback-pause")}
    </button>
    <button data-action="track-next" aria-label="下一曲" title="下一曲">${icon('<path d="m5 5 11 7-11 7Z" fill="currentColor" stroke="none"/><path d="M20 5v14"/>')}</button>
    <button type="button" id="playback-stop" data-action="stop" aria-label="停止播放" title="停止播放">${icon('<rect x="6" y="6" width="12" height="12" rx=".7" fill="currentColor" stroke="none"/>')}</button>
  </div>
  <button class="playback-song" data-action="locate-playing" aria-label="定位当前歌曲">
    <span class="playback-cover" aria-hidden="true">${glyph('<path d="M15 5v11a3 3 0 1 1-2-2.83V7l6-1v8a3 3 0 1 1-2-2.83V5"/>')}<img class="playback-cover-image" alt=""><img class="playback-cover-image" alt=""></span>
    <span class="playback-song-copy"><strong id="playback-title"></strong><span class="playback-subtitle"><small id="playback-artist"></small><small id="playback-state"></small></span></span>
  </button>
  <div class="playback-timeline">
    <span class="playback-current-lyric" aria-label="当前歌词"></span>
    <output id="playback-elapsed" aria-label="已播放时间">0:00</output>
    <div class="playback-seek"><div class="playback-rail" aria-hidden="true"><i class="playback-buffer"></i><i class="playback-fill"></i><i class="playback-loading"></i></div><input id="playback-progress" type="range" min="0" max="1" value="0" step="0.1" aria-label="播放进度" aria-describedby="playback-state" disabled></div>
    <output id="playback-duration" aria-label="总时长">0:00</output>
  </div>
  <div class="playback-utilities">
    <label class="playback-volume">${icon('<path d="M11 5 6 9H3v6h3l5 4ZM15 8a5 5 0 0 1 0 8M18 5a9 9 0 0 1 0 14"/>')}<span class="playback-volume-slider"><i class="playback-volume-rail" aria-hidden="true"></i><input id="playback-volume" type="range" min="0" max="100" step="1" value="65" aria-label="歌曲音量"></span><output id="playback-volume-value">65%</output></label>
    <button class="playback-info-trigger" data-action="audio-info" aria-label="音频信息" title="音频信息与处理链路" aria-expanded="false" aria-controls="music-audio-info">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>')}</button>
    <button class="playback-queue" data-action="playback-queue" aria-label="当前专辑播放队列" title="当前专辑播放队列" aria-expanded="false">${icon('<path d="M4 6h11M4 11h11M4 16h7M19 10v9a2 2 0 1 1-2-2v-7l4-1"/>')}</button>
  </div>
  <button type="button" class="playback-shuffle foobar-shuffle" data-action="foobar-shuffle" aria-label="打乱全部歌曲并播放" title="打乱全部歌曲并播放">▪ SHUFFLE ALL</button>
  <label class="playback-order foobar-order">ORDER <select aria-label="播放顺序"><option value="default">DEFAULT</option><option value="repeat-queue">REPEAT QUEUE</option><option value="repeat-track">REPEAT TRACK</option><option value="random">RANDOM</option><option value="shuffle-tracks">SHUFFLE TRACKS</option><option value="shuffle-albums">SHUFFLE ALBUMS</option><option value="shuffle-folders">SHUFFLE FOLDERS</option></select></label>
</section>`;

export function playbackTime(value: number): string {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const seconds = String(total % 60).padStart(2, "0");
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${String(Math.floor((total / 60) % 60)).padStart(2, "0")}:${seconds}`
    : `${Math.floor(total / 60)}:${seconds}`;
}

/** Preview while dragging; commit one seek when the native range finishes. */
export function setupMusicPlayback(
  host: HTMLElement,
  callbacks: {
    seek: (seconds: number) => void;
    volume: (value: number) => void;
    cover?: (track: MusicTrack) => string | undefined;
    order?: (value: MusicPlayerState["playbackOrder"]) => void;
    currentLyric?: () => string;
  },
) {
  const query = <T extends HTMLElement = HTMLElement>(selector: string) =>
    host.querySelector<T>(selector)!;
  const progress = query<HTMLInputElement>("#playback-progress");
  const volume = query<HTMLInputElement>("#playback-volume");
  const elapsed = query("#playback-elapsed");
  const duration = query("#playback-duration");
  const toggle = query("#playback-toggle");
  const order = query<HTMLSelectElement>(".playback-order select");
  const currentLyric = query(".playback-current-lyric");
  const selectControls = enhanceSettingsSelectControls(host, { menuMinWidth: 190 });
  const coverImages = [
    ...host.querySelectorAll<HTMLImageElement>(".playback-cover-image"),
  ];
  let latest: MusicPlayerState | undefined,
    scrubbing = false;
  let pointer: number | null = null,
    trackId: string | undefined;
  let coverUrl: string | undefined,
    coverGeneration = 0,
    activeCover = 0;
  let textAnimation: Animation | undefined;
  const reduced = () =>
    host.closest(".reduce-motion") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  function draw(position: number, total: number) {
    const value = Math.max(
      0,
      Math.min(total, Number.isFinite(position) ? position : 0),
    );
    progress.value = String(value);
    host.style.setProperty(
      "--playback-progress",
      String(total > 0 ? value / total : 0),
    );
    elapsed.textContent = playbackTime(value);
    progress.setAttribute(
      "aria-valuetext",
      `${playbackTime(value)} / ${playbackTime(total)}`,
    );
  }
  function cancel() {
    scrubbing = false;
    pointer = null;
    delete host.dataset.scrubbing;
    if (latest)
      draw(
        latest.currentTime,
        Math.max(0, latest.duration || latest.currentTrack?.duration || 0),
      );
  }
  function refreshLyric() {
    const text = latest?.currentTrack ? callbacks.currentLyric?.() ?? "" : "";
    if (currentLyric.textContent !== text) currentLyric.textContent = text;
    if (currentLyric.title !== text) currentLyric.title = text;
    currentLyric.setAttribute("aria-hidden", String(!text));
  }
  function updateCover(url: string | undefined) {
    if (url === coverUrl) return;
    coverUrl = url;
    const generation = ++coverGeneration;
    if (!url) {
      coverImages.forEach((image) => image.classList.remove("visible"));
      return;
    }
    const next = 1 - activeCover,
      image = coverImages[next];
    image.onload = () => {
      if (generation !== coverGeneration) return;
      coverImages[activeCover].classList.remove("visible");
      image.classList.add("visible");
      activeCover = next;
    };
    image.onerror = () => {
      if (generation === coverGeneration)
        coverImages.forEach((item) => item.classList.remove("visible"));
    };
    image.src = url;
  }
  progress.addEventListener("pointerdown", (event) => {
    if (progress.disabled) return;
    scrubbing = true;
    pointer = event.pointerId;
    host.dataset.scrubbing = "true";
  });
  progress.addEventListener("input", () => {
    scrubbing = true;
    host.dataset.scrubbing = "true";
    draw(Number(progress.value), Number(progress.max));
  });
  progress.addEventListener("change", () => {
    const value = Number(progress.value),
      id = trackId;
    scrubbing = false;
    delete host.dataset.scrubbing;
    if (!progress.disabled && id === latest?.currentTrack?.id)
      callbacks.seek(value);
    if (latest)
      draw(
        latest.currentTime,
        Math.max(0, latest.duration || latest.currentTrack?.duration || 0),
      );
  });
  // Native range change follows the pointerup default action. Touch cancellation never seeks.
  progress.addEventListener("pointercancel", cancel);
  window.addEventListener("pointerup", (event) => {
    if (pointer === event.pointerId) {
      pointer = null;
      setTimeout(() => {
        if (scrubbing) cancel();
      }, 0);
    }
  });
  progress.addEventListener("blur", cancel);
  volume.addEventListener("input", () => {
    if (!volume.disabled) callbacks.volume(Number(volume.value) / 100);
  });
  order.addEventListener("change", () => callbacks.order?.(order.value as MusicPlayerState["playbackOrder"]));
  const resize = new ResizeObserver(() => {
    (host.closest<HTMLElement>(".music-app") ?? host.parentElement)?.style.setProperty(
      "--playback-height",
      `${Math.ceil(host.getBoundingClientRect().height)}px`,
    );
  });
  resize.observe(host);

  return {
    refreshLyric,
    closeMenu: () => selectControls.close(),
    destroy: () => { selectControls.destroy(); resize.disconnect(); textAnimation?.cancel(); },
    update(state: MusicPlayerState) {
      const changed = trackId !== state.currentTrack?.id;
      const canSeek =
        !!state.currentTrack &&
        ["playing", "paused"].includes(state.transport) &&
        state.duration > 0;
      latest = state;
      query<HTMLButtonElement>("#playback-stop").disabled = !state.currentTrack;
      order.value = state.playbackOrder;
      selectControls.sync();
      refreshLyric();
      if (changed || !canSeek) cancel();
      trackId = state.currentTrack?.id;
      const app = host.closest<HTMLElement>(".music-app") ?? host.parentElement!;
      const archive = app.dataset.design === "archive";
      const coverActive = !!state.currentTrack && ["loading", "playing", "paused"].includes(state.transport);
      host.dataset.coverActive = String(coverActive);
      if (archive) {
        query(".playback-song").removeAttribute("title");
        query(".playback-song").setAttribute("aria-label", trUi(coverActive ? "查看正在播放的专辑" : "查看所选专辑"));
      } else query(".playback-song").setAttribute("aria-label", trUi("定位当前歌曲"));
      host.hidden = !state.currentTrack && app.dataset.design !== "archive";
      if (host.hidden) selectControls.close();
      app.dataset.playbackVisible = String(!host.hidden);
      if (!state.currentTrack) {
        if (app.dataset.design === "archive") {
          query("#playback-title").textContent = "";
          query("#playback-artist").textContent = "";
          query("#playback-state").textContent = "";
          coverImages.forEach(image => image.classList.remove("visible"));
          progress.disabled = true; progress.max = "1"; progress.value = "0";
          draw(0, 0);
          host.dataset.playing = "false";
          toggle.setAttribute("aria-pressed", "false");
          volume.value = String(Math.round(state.volume * 100));
          query("#playback-volume-value").textContent = String(Math.round(state.volume * 100));
        }
        return;
      }
      const track = state.currentTrack!;
      const total = Math.max(0, state.duration || track.duration || 0);
      query("#playback-title").textContent = track.title;
      if (!archive) query(".playback-song").title = ui`定位：${track.title}`;
      query("#playback-artist").textContent = track.artist;
      query("#playback-state").textContent = state.error
        ? trUi("播放出错")
        : state.transport === "loading"
          ? trUi("准备音频")
          : state.loading
            ? trUi("缓冲中")
            : state.playing
              ? trUi("正在播放")
              : state.transport === "paused"
                ? trUi("已暂停")
                : trUi("已停止");
      host.dataset.playing = String(state.playing);
      host.dataset.buffering = String(
        state.loading || state.transport === "loading",
      );
      updateCover(callbacks.cover?.(track));
      if (changed) {
        textAnimation?.cancel();
        if (!reduced())
          textAnimation = query(".playback-song-copy").animate(
            [
              { opacity: 0, transform: "translateY(5px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: 260, easing: "linear" },
          );
      }
      progress.disabled = !canSeek;
      progress.max = String(total || 1);
      duration.textContent = playbackTime(total);
      if (!scrubbing) draw(state.currentTime, total);
      toggle.setAttribute(
        "aria-label",
        state.playing || state.transport === "loading" ? trUi("暂停") : trUi("播放"),
      );
      toggle.setAttribute(
        "aria-pressed",
        String(state.playing || state.transport === "loading"),
      );
      query<HTMLButtonElement>('[data-action="track-previous"]').disabled =
        !state.queue.length;
      query<HTMLButtonElement>('[data-action="track-next"]').disabled =
        state.currentIndex < 0 || state.currentIndex >= state.queue.length - 1;
      volume.disabled = state.volumeLocked;
      volume.value = String(
        state.volumeLocked ? 100 : Math.round(state.volume * 100),
      );
      query("#playback-volume-value").textContent = state.volumeLocked
        ? "DAC"
        : `${Math.round(state.volume * 100)}%`;
      volume.title = state.volumeLocked
        ? trUi("DSD 数字直出：请在 DAC 上调节音量")
        : trUi("歌曲音量");
      host.style.setProperty(
        "--playback-volume",
        String(state.volumeLocked ? 1 : state.volume),
      );
      const processing = state.sonyProcessing;
      const offset = Math.max(0, processing.positionOffset ?? 0);
      const buffered = Math.max(0, processing.bufferedSeconds ?? 0);
      host.style.setProperty(
        "--playback-buffer-start",
        `${total > 0 ? Math.min(1, offset / total) * 100 : 0}%`,
      );
      host.style.setProperty(
        "--playback-buffer-size",
        `${total > 0 && processing.streaming ? (Math.max(0, Math.min(total - offset, buffered)) / total) * 100 : 0}%`,
      );
    },
  };
}
