import { trUi, ui, lyricSourceLabel } from "./i18n";
import type { LyricsCustomSourceConfig, LyricsSource, LyricsSourceMapping } from "./lyrics-page";

interface LyricsGlobalSettings {
  defaultSourceId: string;
  cacheDirectory: string;
  defaultCacheDirectory: string;
}

export interface LyricsSettingsCallbacks {
  chooseDirectory: () => Promise<string | null>;
  notify: (message: string) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function responseJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!response.ok) throw new Error(typeof record.error === "string" ? record.error : ui`本机歌词服务返回 ${response.status}`);
  return body as T;
}

function normalizeCustom(source: LyricsSource): LyricsCustomSourceConfig {
  return {
    id: source.id,
    name: source.name,
    searchUrl: source.searchUrl ?? "",
    lyricUrl: source.lyricUrl ?? "",
    ...(source.mapping ? { mapping: source.mapping } : {}),
  };
}

export function setupLyricsSettings(
  host: HTMLElement,
  callbacks: LyricsSettingsCallbacks,
): { refresh(): Promise<void>; destroy(): void } {
  let disposed = false;
  let savingSettings = false;
  let savingSources = false;
  let settings: LyricsGlobalSettings | undefined;
  let pendingCacheDirectory = "";
  let sources: LyricsSource[] = [];
  let customSources: LyricsCustomSourceConfig[] = [];
  let editingSourceId: string | undefined;
  let settingsRequest: AbortController | undefined;
  let sourcesRequest: AbortController | undefined;
  let settingsSaveRequest: AbortController | undefined;
  let sourcesSaveRequest: AbortController | undefined;

  const page = element("div", "lyrics-global-settings");
  const heading = element("div", "lyrics-global-settings-heading");
  heading.append(element("small", "lyrics-global-eyebrow", trUi("歌词 · 全局设置")), element("h2", "", trUi("默认来源与缓存")));
  const intro = element("p", "lyrics-global-intro", trUi("此处管理应用共享的歌词服务器和默认行为。单曲可以单独指定来源，也可以跟随这里的默认来源。"));

  const defaultsSection = element("section", "lyrics-settings-card");
  defaultsSection.append(element("div", "lyrics-settings-section-heading", trUi("默认设置")));
  const defaultSourceLabel = element("label", "lyrics-settings-field");
  defaultSourceLabel.append(element("span", "", trUi("全局默认歌词来源")));
  const defaultSourceSelect = element("select", "lyrics-settings-select");
  defaultSourceSelect.setAttribute("aria-label", trUi("全局默认歌词来源"));
  defaultSourceLabel.append(defaultSourceSelect);
  const cacheLabel = element("label", "lyrics-settings-field");
  cacheLabel.append(element("span", "", trUi("歌词缓存目录")));
  const cachePath = element("input", "lyrics-settings-input");
  cachePath.type = "text";
  cachePath.readOnly = true;
  cachePath.setAttribute("aria-label", trUi("歌词缓存目录，只读"));
  const cacheActions = element("div", "lyrics-settings-cache-actions");
  const chooseCacheButton = element("button", "lyrics-settings-button", trUi("选择文件夹"));
  chooseCacheButton.type = "button";
  const restoreCacheButton = element("button", "lyrics-settings-button", trUi("恢复默认"));
  restoreCacheButton.type = "button";
  cacheActions.append(chooseCacheButton, restoreCacheButton);
  cacheLabel.append(cachePath, cacheActions);
  const cacheHint = element("p", "lyrics-settings-hint", trUi("更换目录后，新歌词写入新目录；旧缓存保留并可继续读取，不会移动或删除文件。恢复默认将使用播放器的标准缓存目录。"));
  const settingsActions = element("div", "lyrics-settings-actions");
  const settingsStatus = element("p", "lyrics-settings-status", trUi("正在读取歌词设置…"));
  const saveSettingsButton = element("button", "lyrics-settings-primary", trUi("保存默认设置"));
  saveSettingsButton.type = "button";
  settingsActions.append(settingsStatus, saveSettingsButton);
  defaultsSection.append(defaultSourceLabel, cacheLabel, cacheHint, settingsActions);

  const sourcesSection = element("section", "lyrics-settings-card lyrics-settings-sources");
  const sourcesHeader = element("div", "lyrics-settings-sources-header");
  const sourcesTitle = element("div", "lyrics-settings-section-heading", trUi("全局共享服务器"));
  const sourceCounts = element("p", "lyrics-settings-hint", trUi("内置网易云、QQ 音乐和自定义服务器供所有曲目共用。"));
  const sourceRefreshButton = element("button", "lyrics-settings-button", trUi("刷新列表"));
  sourceRefreshButton.type = "button";
  sourcesHeader.append(sourcesTitle, sourceRefreshButton);
  const sourceStatus = element("p", "lyrics-settings-status", trUi("正在读取共享服务器…"));
  const sourceList = element("div", "lyrics-settings-source-list");

  const sourceForm = element("div", "lyrics-settings-source-form");
  const sourceFormTitle = element("div", "lyrics-settings-section-heading", trUi("新增自定义服务器"));
  const sourceNameInput = element("input", "lyrics-settings-input");
  sourceNameInput.placeholder = trUi("服务器名称");
  sourceNameInput.setAttribute("aria-label", trUi("自定义歌词服务器名称"));
  const sourceSearchUrlInput = element("input", "lyrics-settings-input");
  sourceSearchUrlInput.placeholder = trUi("搜索 URL 模板，含 {query} 或 {title}");
  sourceSearchUrlInput.setAttribute("aria-label", trUi("自定义歌词服务器搜索 URL 模板"));
  const sourceLyricUrlInput = element("input", "lyrics-settings-input");
  sourceLyricUrlInput.placeholder = trUi("歌词 URL 模板，含 {id}");
  sourceLyricUrlInput.setAttribute("aria-label", trUi("自定义歌词服务器歌词 URL 模板"));
  const sourceMappingInput = element("textarea", "lyrics-settings-input lyrics-settings-mapping");
  sourceMappingInput.placeholder = trUi("高级 JSON 映射，例如 {\"results\":\"results\",\"lrc\":\"lrc\"}");
  sourceMappingInput.setAttribute("aria-label", trUi("自定义歌词服务器高级 JSON 映射"));
  sourceMappingInput.rows = 4;
  const sourceFormHint = element("p", "lyrics-settings-hint", trUi("地址支持 {query}、{title}、{artist}、{album}、{id}。默认搜索结果字段为 results、歌词字段为 lrc，可在高级映射中调整。"));
  const sourceFormActions = element("div", "lyrics-settings-actions");
  const sourceFormStatus = element("p", "lyrics-settings-status", "");
  const sourceSaveButton = element("button", "lyrics-settings-primary", trUi("保存共享服务器"));
  sourceSaveButton.type = "button";
  const sourceCancelButton = element("button", "lyrics-settings-button", trUi("取消编辑"));
  sourceCancelButton.type = "button";
  sourceCancelButton.hidden = true;
  sourceFormActions.append(sourceFormStatus, sourceCancelButton, sourceSaveButton);
  sourceForm.append(sourceFormTitle, sourceNameInput, sourceSearchUrlInput, sourceLyricUrlInput, sourceMappingInput, sourceFormHint, sourceFormActions);
  sourcesSection.append(sourcesHeader, sourceCounts, sourceStatus, sourceList, sourceForm);
  page.append(heading, intro, defaultsSection, sourcesSection);
  host.replaceChildren(page);

  function emitSettingsUpdated(): void {
    host.dispatchEvent(new CustomEvent("lyrics-settings-updated", { bubbles: true }));
  }

  function renderDefaultSources(): void {
    const previous = settings?.defaultSourceId ?? defaultSourceSelect.value;
    defaultSourceSelect.replaceChildren();
    const available = sources.filter((source) => source.enabled);
    const selectedSource = sources.find((source) => source.id === previous);
    if (selectedSource && !selectedSource.enabled) available.push(selectedSource);
    if (!available.length) {
      const option = element("option", "", trUi("暂无可用服务器"));
      option.value = "";
      defaultSourceSelect.append(option);
      defaultSourceSelect.disabled = true;
      return;
    }
    for (const source of available) {
      const option = element("option", "", `${lyricSourceLabel(source)}${source.builtin ? trUi(" · 内置") : trUi(" · 自定义")}${source.enabled ? "" : trUi(" · 已停用")}`);
      option.value = source.id;
      defaultSourceSelect.append(option);
    }
    defaultSourceSelect.disabled = savingSettings;
    defaultSourceSelect.value = available.some((source) => source.id === previous) ? previous : available[0].id;
  }

  function renderCachePath(): void {
    cachePath.value = pendingCacheDirectory || settings?.defaultCacheDirectory || trUi("默认缓存目录尚未返回");
    cachePath.title = pendingCacheDirectory ? trUi("已选择自定义缓存目录") : trUi("当前使用默认缓存目录");
    restoreCacheButton.disabled = savingSettings || !pendingCacheDirectory;
    chooseCacheButton.disabled = savingSettings;
  }

  function clearSourceForm(): void {
    editingSourceId = undefined;
    sourceNameInput.value = "";
    sourceSearchUrlInput.value = "";
    sourceLyricUrlInput.value = "";
    sourceMappingInput.value = "";
    sourceFormTitle.textContent = trUi("新增自定义服务器");
    sourceCancelButton.hidden = true;
    sourceFormStatus.textContent = "";
  }

  function renderSources(): void {
    sourceList.replaceChildren();
    if (!sources.length) {
      sourceList.append(element("p", "lyrics-settings-hint", trUi("没有读取到歌词服务器。")));
      sourceCounts.textContent = trUi("内置网易云、QQ 音乐和自定义服务器供所有曲目共用。");
      return;
    }
    const builtins = sources.filter((source) => source.builtin);
    const custom = sources.filter((source) => !source.builtin);
    sourceCounts.textContent = ui`${builtins.length} 个内置服务器 · ${custom.length} 个自定义服务器；此列表在全应用共享。`;
    for (const source of sources) {
      const row = element("article", "lyrics-settings-source-row");
      const info = element("div", "lyrics-settings-source-info");
      const title = element("strong", "", lyricSourceLabel(source));
      const detail = element("small", "", `${source.builtin ? trUi("内置服务器") : trUi("自定义服务器")} · ${source.enabled ? trUi("已启用") : trUi("已停用")}${source.id ? ` · ${source.id}` : ""}`);
      info.append(title, detail);
      row.append(info);
      if (!source.builtin) {
        const actions = element("div", "lyrics-settings-source-actions");
        const config = normalizeCustom(source);
        const edit = element("button", "lyrics-settings-button", trUi("编辑"));
        edit.type = "button";
        edit.disabled = savingSources;
        edit.addEventListener("click", () => {
          editingSourceId = config.id;
          sourceNameInput.value = config.name;
          sourceSearchUrlInput.value = config.searchUrl;
          sourceLyricUrlInput.value = config.lyricUrl;
          sourceMappingInput.value = config.mapping ? JSON.stringify(config.mapping, null, 2) : "";
          sourceFormTitle.textContent = ui`编辑服务器：${config.name}`;
          sourceCancelButton.hidden = false;
          sourceFormStatus.textContent = "";
          sourceNameInput.focus();
        });
        const remove = element("button", "lyrics-settings-button", trUi("删除"));
        remove.type = "button";
        remove.disabled = savingSources;
        remove.addEventListener("click", () => {
          if (!config.id) return;
          const next = customSources.filter((item) => item.id !== config.id);
          void saveCustomSources(next);
        });
        actions.append(edit, remove);
        row.append(actions);
      }
      sourceList.append(row);
    }
    renderDefaultSources();
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    settingsRequest?.abort();
    sourcesRequest?.abort();
    const controller = new AbortController();
    settingsRequest = controller;
    sourcesRequest = controller;
    settingsStatus.textContent = trUi("正在读取歌词设置…");
    sourceStatus.textContent = trUi("正在读取共享服务器…");
    try {
      const response = await fetch("/api/lyrics/settings", { signal: controller.signal });
      const payload = await responseJson<{ settings: LyricsGlobalSettings; sources: LyricsSource[] }>(response);
      if (disposed || controller.signal.aborted) return;
      settings = payload.settings;
      pendingCacheDirectory = payload.settings.cacheDirectory || "";
      sources = Array.isArray(payload.sources) ? payload.sources : [];
      customSources = sources.filter((source) => !source.builtin).map(normalizeCustom);
      settingsStatus.textContent = trUi("歌词默认设置已读取。");
      sourceStatus.textContent = trUi("共享服务器列表已读取。");
      renderDefaultSources();
      renderCachePath();
      renderSources();
      emitSettingsUpdated();
    } catch (error) {
      if (disposed || controller.signal.aborted) return;
      settingsStatus.textContent = ui`读取歌词设置失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
      sourceStatus.textContent = settingsStatus.textContent;
    } finally {
      if (settingsRequest === controller) settingsRequest = undefined;
      if (sourcesRequest === controller) sourcesRequest = undefined;
    }
  }

  async function saveGlobalSettings(): Promise<void> {
    if (!settings || savingSettings) return;
    savingSettings = true;
    saveSettingsButton.disabled = true;
    settingsStatus.textContent = trUi("正在保存歌词默认设置…");
    const controller = new AbortController();
    settingsSaveRequest?.abort();
    settingsSaveRequest = controller;
    try {
      const response = await fetch("/api/lyrics/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultSourceId: defaultSourceSelect.value, cacheDirectory: pendingCacheDirectory }),
        signal: controller.signal,
      });
      const payload = await responseJson<{ settings: LyricsGlobalSettings; sources: LyricsSource[] }>(response);
      if (disposed || controller.signal.aborted) return;
      settings = payload.settings;
      pendingCacheDirectory = payload.settings.cacheDirectory || "";
      sources = Array.isArray(payload.sources) ? payload.sources : sources;
      settingsStatus.textContent = trUi("歌词默认设置已保存。新缓存会写入所选目录，旧缓存仍保留。");
      renderDefaultSources();
      renderCachePath();
      emitSettingsUpdated();
      callbacks.notify(trUi("歌词默认设置已保存。"));
    } catch (error) {
      if (disposed || controller.signal.aborted) return;
      settingsStatus.textContent = ui`保存歌词设置失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
    } finally {
      savingSettings = false;
      if (settingsSaveRequest === controller) settingsSaveRequest = undefined;
      if (!disposed) {
        saveSettingsButton.disabled = false;
        renderDefaultSources();
        renderCachePath();
      }
    }
  }

  async function saveCustomSources(next: LyricsCustomSourceConfig[]): Promise<void> {
    if (savingSources) return;
    savingSources = true;
    sourceSaveButton.disabled = true;
    sourceStatus.textContent = trUi("正在保存共享歌词服务器…");
    const controller = new AbortController();
    sourcesSaveRequest?.abort();
    sourcesSaveRequest = controller;
    try {
      const response = await fetch("/api/lyrics/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: next }),
        signal: controller.signal,
      });
      const payload = await responseJson<{ sources: LyricsSource[] }>(response);
      if (disposed || controller.signal.aborted) return;
      sources = Array.isArray(payload.sources) ? payload.sources : [];
      const returned = sources.filter((source) => !source.builtin);
      customSources = next.map((config, index) => {
        const source = returned.find((item) => config.id && item.id === config.id)
          ?? returned.find((item) => item.name === config.name)
          ?? returned[index];
        return {
          ...config,
          ...(source?.id ? { id: source.id } : {}),
          name: source?.name || config.name,
          searchUrl: source?.searchUrl || config.searchUrl,
          lyricUrl: source?.lyricUrl || config.lyricUrl,
          ...(source?.mapping ? { mapping: source.mapping } : config.mapping ? { mapping: config.mapping } : {}),
        };
      });
      sourceStatus.textContent = trUi("共享服务器已保存。");
      sourceFormStatus.textContent = trUi("服务器列表已保存并供全应用共用。");
      renderSources();
      clearSourceForm();
      emitSettingsUpdated();
    } catch (error) {
      if (disposed || controller.signal.aborted) return;
      sourceStatus.textContent = ui`保存共享服务器失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
      sourceFormStatus.textContent = sourceStatus.textContent;
    } finally {
      savingSources = false;
      if (sourcesSaveRequest === controller) sourcesSaveRequest = undefined;
      if (!disposed) {
        sourceSaveButton.disabled = false;
        renderSources();
      }
    }
  }

  async function chooseCacheDirectory(): Promise<void> {
    try {
      const directory = await callbacks.chooseDirectory();
      if (!directory || disposed) return;
      pendingCacheDirectory = directory;
      renderCachePath();
      settingsStatus.textContent = trUi("目录已选择；保存后应用新目录。");
    } catch (error) {
      settingsStatus.textContent = ui`选择缓存目录失败：${error instanceof Error ? error.message : trUi("未知错误")}`;
    }
  }

  function saveSourceForm(): void {
    const name = sourceNameInput.value.trim();
    const searchUrl = sourceSearchUrlInput.value.trim();
    const lyricUrl = sourceLyricUrlInput.value.trim();
    if (!name || !searchUrl || !lyricUrl) {
      sourceFormStatus.textContent = trUi("请填写服务器名称、搜索 URL 模板和歌词 URL 模板。");
      return;
    }
    let mapping: LyricsSourceMapping | undefined;
    if (sourceMappingInput.value.trim()) {
      try {
        const parsed: unknown = JSON.parse(sourceMappingInput.value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(trUi("映射必须是 JSON 对象。"));
        mapping = parsed as LyricsSourceMapping;
      } catch (error) {
        sourceFormStatus.textContent = ui`高级映射 JSON 无效：${error instanceof Error ? error.message : trUi("解析失败")}`;
        return;
      }
    }
    const entry: LyricsCustomSourceConfig = {
      ...(editingSourceId ? { id: editingSourceId } : {}),
      name,
      searchUrl,
      lyricUrl,
      ...(mapping ? { mapping } : {}),
    };
    const next = editingSourceId
      ? customSources.map((config) => config.id === editingSourceId ? entry : config)
      : [...customSources, entry];
    void saveCustomSources(next);
  }

  chooseCacheButton.addEventListener("click", () => { void chooseCacheDirectory(); });
  restoreCacheButton.addEventListener("click", () => {
    pendingCacheDirectory = "";
    renderCachePath();
    settingsStatus.textContent = trUi("已选择恢复默认目录；保存后生效。");
  });
  saveSettingsButton.addEventListener("click", () => { void saveGlobalSettings(); });
  sourceRefreshButton.addEventListener("click", () => { void refresh(); });
  sourceSaveButton.addEventListener("click", saveSourceForm);
  sourceCancelButton.addEventListener("click", clearSourceForm);
  defaultSourceSelect.addEventListener("change", () => {
    settingsStatus.textContent = trUi("默认来源已更改；保存后生效。");
  });

  return {
    refresh,
    destroy() {
      if (disposed) return;
      disposed = true;
      settingsRequest?.abort();
      sourcesRequest?.abort();
      settingsSaveRequest?.abort();
      sourcesSaveRequest?.abort();
      host.replaceChildren();
    },
  };
}
