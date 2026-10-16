import type { MusicPlayerState } from "./music-player";
import { playbackTime } from "./music-playback";
import { musicCatalogToolsMarkup } from "./music-catalog-markup";
import { getMusicCatalogOptions, getMusicCatalogRecords } from "./music-catalog";
import { musicApplication } from "./music-application-state";
import { legacyCatalogOptions } from "./music-view-settings";

type Callbacks = {
  search: (query: string) => void;
};

// Adapted from RhinE js/lib/emblem.js (MIT). Its arc-length centreline and
// twisting slats remain vector geometry; no replacement logo asset is used.
function emblem(time: number) {
  const radius = 1, cx = 1.42, th = Math.asin(radius / cx), tangent = Math.sqrt(cx * cx - 1);
  const ct = Math.cos(th), st = Math.sin(th), sweep = Math.PI + 2 * th;
  const pieces = [[0, 0, 0, tangent * ct, tangent * st], [1, cx, 0, Math.PI / 2 + th, -sweep],
    [0, tangent * ct, -tangent * st, 0, 0], [0, 0, 0, -tangent * ct, tangent * st],
    [1, -cx, 0, Math.PI / 2 - th, sweep], [0, -tangent * ct, -tangent * st, 0, 0]];
  const lengths = pieces.map(p => p[0] === 0 ? tangent : Math.abs(p[4]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const samples = Array.from({ length: 1440 }, (_, i) => {
    let s = i / 1440 * total, k = 0;
    while (s > lengths[k] && k < 5) s -= lengths[k++];
    const p = pieces[k], f = s / lengths[k];
    return p[0] === 0 ? [p[1] + (p[3] - p[1]) * f, -(p[2] + (p[4] - p[2]) * f)]
      : [p[1] + Math.cos(p[3] + p[4] * f), -(p[2] + Math.sin(p[3] + p[4] * f))];
  });
  const tau = Math.PI * 2, cy = Math.cos(.5 * Math.sin(time * .2)), sy = Math.sin(.5 * Math.sin(time * .2));
  const cp = Math.cos(.32), sp = Math.sin(.32);
  const rot = (a: number, b: number, c: number) => {
    const x = a * cy + c * sy, z = -a * sy + c * cy;
    return [x, b * cp - z * sp, b * sp + z * cp];
  };
  const at = (u: number) => {
    const q = samples[Math.floor((((u / tau) % 1 + 1) % 1) * samples.length) % samples.length];
    return [q[0] * .67, -q[1] * .67, -Math.cos(u) * .55];
  };
  return Array.from({ length: 110 }, (_, i) => {
    const u = i / 110 * tau, p = at(u), p1 = at(u + .02), p0 = at(u - .02);
    let tx = p1[0] - p0[0], ty = p1[1] - p0[1], tz = p1[2] - p0[2];
    const length = Math.hypot(tx, ty, tz); tx /= length; ty /= length; tz /= length;
    let bx = ty, by = -tx; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    const nx = by * tz, ny = -bx * tz, nz = bx * ty - by * tx;
    const twist = u * 1.5 + time * .32, c = Math.cos(twist), s = Math.sin(twist);
    const dx = bx * c + nx * s, dy = by * c + ny * s, dz = nz * s;
    const a = rot(p[0] + dx * .34, p[1] + dy * .34, p[2] + dz * .34);
    const b = rot(p[0] - dx * .34, p[1] - dy * .34, p[2] - dz * .34);
    const normal = rot(ty * dz - tz * dy, tz * dx - tx * dz, tx * dy - ty * dx);
    return { a, b, z: (a[2] + b[2]) / 2, opacity: .3 + .7 * Math.pow(Math.abs(normal[2]), .7) };
  }).sort((a, b) => b.z - a.z).map(({ a, b, opacity }) =>
    `<path d="M${46 + a[0] * 12.5},${22 - a[1] * 12.5}L${46 + b[0] * 12.5},${22 - b[1] * 12.5}" opacity="${opacity.toFixed(3)}"/>`).join("");
}

export function setupFoobarShell(stage: HTMLElement, callbacks: Callbacks) {
  const shell = document.createElement("div");
  shell.className = "foobar-shell";
  shell.hidden = true;
  shell.innerHTML = `<header class="foobar-header">
    <button class="foobar-identity" data-action="foobar-home" aria-label="返回唱片主页">
      <svg class="foobar-emblem" viewBox="0 0 92 44" aria-hidden="true"><g/></svg>
      <span class="foobar-brand"><strong>AUDIO ARCHIVE</strong><small>SIGNAL · LIBRARY · PLAYBACK</small><span>LISTENING <b>TERMINAL</b></span></span>
    </button><div class="foobar-nav-slot"></div>
  </header>
  <section class="foobar-workspace" aria-label="Audio Archive">
    <div class="foobar-catalog-tools"></div><div class="foobar-grid-host" hidden></div>
    <div class="foobar-home-info"></div><div class="foobar-home-navigation"></div>
    <span class="foobar-watermark" aria-hidden="true"></span>
  </section>
  <footer class="foobar-footer"><div class="foobar-transport-slot"></div>
    <div class="foobar-status"><span class="foobar-section">ARCHIVE SECTION · BROWSE</span><span class="foobar-status-counts"></span><b>AUDIO ARCHIVE ▰</b></div>
  </footer>`;
  stage.append(shell);
  const q = <T extends Element = HTMLElement>(s: string) => shell.querySelector<T>(s)!;
  const normalNav = stage.querySelector<HTMLElement>(".music-header .music-topnav")!;
  q<HTMLElement>('.foobar-nav-slot').addEventListener('wheel',event=>{
    const slot=q<HTMLElement>('.foobar-nav-slot');
    if(slot.scrollWidth>slot.clientWidth&&event.deltaY&&!event.ctrlKey&&!event.metaKey){event.preventDefault();slot.scrollLeft+=event.deltaY;}
  },{passive:false});
  const playback = stage.querySelector<HTMLElement>("#music-playback")!;
  const labels = new Map<HTMLButtonElement, string>();
  const names: Record<string, [string, string]> = { library: ["01", "ARCHIVE"], eq: ["02", "EQ"], lyrics: ["03", "LYRICS"], signal: ["04", "SIGNAL"], theme: ["05", "STYLE"] };
  const clock = document.createElement("time"); clock.className = "foobar-clock";
  clock.setAttribute("aria-label", "当前日期和时间");
  const settingsButton = normalNav.querySelector<HTMLButtonElement>('[data-action="settings"]')!;
  normalNav.insertBefore(clock, settingsButton);
  const search = document.createElement("input"); search.type = "search"; search.className = "foobar-header-search";
  search.placeholder = "SEARCH ARCHIVE"; search.setAttribute("aria-label", "搜索音乐库");
  const searchButton = normalNav.querySelector<HTMLButtonElement>('[data-action="search"]')!;
  const utilities = document.createElement("div"); utilities.className = "foobar-transport-controls";
  utilities.innerHTML = `<button class="foobar-stop" data-action="stop" aria-label="停止播放">■</button>
    <span class="foobar-mode-slot"></span>`;
  const remaining = document.createElement("output"); remaining.className = "foobar-remaining"; remaining.textContent = "−00:00";
  const ports: { node: HTMLElement; marker: Comment; parent: Node }[] = [];
  let active = false, playing = false, lastEmblem = -Infinity;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const move = (node: HTMLElement, destination: HTMLElement) => {
    const parent = node.parentNode!;
    const marker = document.createComment("glass-player-position"); node.before(marker); ports.push({ node, marker, parent }); destination.append(node);
  };
  search.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); callbacks.search(search.value); } if (e.key === "Escape") { e.stopPropagation(); search.value = ""; callbacks.search(""); } });
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    if (active && stage.dataset.page === "music") searchTimer = setTimeout(() => { if (active) callbacks.search(search.value); }, 180);
  });
  playback.addEventListener("wheel", e => {
    if (!active || !(e.target as HTMLElement).closest(".playback-timeline")) return;
    const seek = playback.querySelector<HTMLInputElement>("#playback-progress")!;
    if (seek.disabled) return;
    e.preventDefault(); seek.value = String(Math.max(0, Math.min(Number(seek.max), Number(seek.value) + (e.deltaY > 0 ? -5 : 5))));
    seek.dispatchEvent(new Event("input", { bubbles: true })); seek.dispatchEvent(new Event("change", { bubbles: true }));
  }, { passive: false });
  const tickClock = () => {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.innerHTML = `<strong>${now.toLocaleTimeString("en-GB")}</strong><small>${now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</small>`;
  };
  tickClock();
  setInterval(tickClock, 1000);
  const updatePage = () => {
    if (!active) return;
    const page = stage.dataset.page ?? "music";
    const current = page === "music" ? "library" : page;
    normalNav.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach(button => {
      if (names[button.dataset.action!]) button.setAttribute("aria-pressed", String(button.dataset.action === current));
    });
    q(".foobar-section").textContent = `${page === "theme" ? "STYLE" : page === "music" ? "ARCHIVE" : page.toUpperCase()} SECTION · ${stage.dataset.mode === "detail" ? "INSPECT" : "BROWSE"}`;
    q(".foobar-watermark").textContent = stage.querySelector("#genre-name")?.textContent || "UNKNOWN";
  };
  new MutationObserver(updatePage).observe(stage, { attributes: true, attributeFilter: ["data-page", "data-mode"] });
  const refreshCatalog = () => {
    if (!active) return;
    q(".foobar-catalog-tools").innerHTML = musicCatalogToolsMarkup();
    const options = legacyCatalogOptions(getMusicCatalogOptions());
    if (document.activeElement !== search) search.value = musicApplication.query;
    stage.dataset.foobarEmpty = String(!getMusicCatalogRecords().length);
    stage.dataset.foobarLayout = options.layout;
  };
  return {
    setActive(next: boolean) {
      if (next === active) return;
      const infoPanel = stage.querySelector<HTMLElement>(".album-panel");
      const infoScroll = infoPanel?.querySelector<HTMLElement>(".album-panel-scroll");
      const scrollTop = infoScroll?.scrollTop;
      const focusedInfo = infoPanel?.contains(document.activeElement)
        ? document.activeElement as HTMLElement : undefined;
      active = next; shell.hidden = !active;
      if (active) {
        move(normalNav, q(".foobar-nav-slot")); move(playback, q(".foobar-transport-slot"));
        const queueButton = playback.querySelector<HTMLElement>(".playback-queue");
        if (queueButton) move(queueButton, utilities.querySelector<HTMLElement>(".foobar-mode-slot")!);
        move(stage.querySelector<HTMLElement>(".album-panel") ?? stage.querySelector<HTMLElement>(".album-callout")!, q(".foobar-home-info"));
        const badges = stage.querySelector<HTMLElement>(".album-callout .source-audio-badges");
        if (badges) move(badges, stage.querySelector<HTMLElement>(".album-callout")!);
        move(stage.querySelector<HTMLElement>(".music-navigation")!, q(".foobar-home-navigation"));
        move(stage.querySelector<HTMLElement>("#collection-line")!, q(".foobar-status-counts"));
        for (const button of normalNav.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
          const nav = names[button.dataset.action!];
          if (!nav && button !== settingsButton && button !== searchButton && button.dataset.action !== "online") continue;
          labels.set(button, button.innerHTML);
          if (nav) button.innerHTML = `<small class="foobar-nav-number">${nav[0]}</small><span>${nav[1]}</span>`;
          if (button === settingsButton) button.innerHTML = `<svg class="foobar-settings-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/></svg><span>SETTINGS</span>`;
          if (button === searchButton) button.innerHTML = "⌕";
          if (button.dataset.action === "online") button.innerHTML = "ONLINE";
        }
        normalNav.insertBefore(search, searchButton);
        playback.append(utilities); playback.querySelector(".playback-timeline")!.append(remaining);
        refreshCatalog(); updatePage();
        q<SVGGElement>(".foobar-emblem g").innerHTML = emblem(0);
      } else {
        clearTimeout(searchTimer);
        search.remove(); remaining.remove();
        for (const [button, html] of labels) button.innerHTML = html; labels.clear();
        for (const port of ports.reverse()) {
          if (port.marker.parentNode) port.marker.replaceWith(port.node);
          else port.parent.appendChild(port.node);
        } ports.length = 0;
        utilities.remove(); delete stage.dataset.foobarLayout; delete stage.dataset.foobarEmpty;
      }
      // Reparenting the shared pane can drop browser focus and scroll state.
      if (infoScroll && scrollTop !== undefined) infoScroll.scrollTop = scrollTop;
      if (focusedInfo?.isConnected) focusedInfo.focus({ preventScroll: true });
    },
    refreshCatalog,
    focusSearch() {
      if (!active || !search.getClientRects().length) return false;
      search.focus(); search.select(); return true;
    },
    updateSelection(index: number) {
      if (!active) return;
      updatePage();
    },
    updatePlayer(state: MusicPlayerState) {
      playing = state.playing;
      if (!active) return;
      remaining.textContent = `−${playbackTime(Math.max(0, state.duration - state.currentTime))}`;
      playback.querySelector("#playback-volume-value")!.textContent = String(state.volumeLocked ? 100 : Math.round(state.volume * 100));
    },
    tick(seconds: number, reduced: boolean) {
      if (!active || !playing || reduced || seconds - lastEmblem < 1 / 30) return;
      lastEmblem = seconds; q<SVGGElement>(".foobar-emblem g").innerHTML = emblem(seconds);
    },
    closeMenu() {},
    setModalOpen(open: boolean) { shell.inert = open; },
  };
}
