import { trUi, ui, uiLanguage } from "./i18n";
import { escapeHtml as esc } from "./html";
import { parseStandardEqPresetFile, serializeStandardEqPresetFile } from "./standard-eq-preset-format.mjs";
import type { ProcessingSettings } from "./audio-processing-model.mjs";

export type StandardEqFile = {
  fileName: string;
  name: string;
  revision: string;
  format?: "poweramp" | "rhine-standard";
};
export type StandardEqFileResult = {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
  directory?: string;
  presets?: StandardEqFile[];
  issues?: string[];
  selected?: StandardEqFile & { sourceText: string };
  savedOutside?: boolean;
  filePath?: string;
  message?: string;
};
export type StandardEqFileRequest = {
  action: "list" | "choose-directory" | "import" | "read" | "save" | "save-copy" | "save-as" | "rename" | "open-directory";
  language?: "zh-CN" | "en";
  fileName?: string;
  revision?: string;
  name?: string;
  content?: string;
};
export type StandardEqPresetState = {
  directory: string;
  entries: StandardEqFile[];
  selected?: StandardEqFile & { sourceText: string };
  restored?: { directory: string; fileName: string; revision: string };
  name: string;
};

const selectionKey = "rhine-standard-eq-file-selection-v1";
export function createStandardEqPresetState(): StandardEqPresetState {
  let restored: StandardEqPresetState["restored"];
  try {
    const value = JSON.parse(localStorage.getItem(selectionKey) || "null");
    if (value && typeof value.directory === "string" && typeof value.fileName === "string" && typeof value.revision === "string") restored = value;
  } catch { /* The working settings remain available without a file binding. */ }
  return { directory: "", entries: [], name: "", restored };
}

export function standardEqPresetMarkup() {
  return ui`<div class="processing-presets standard-eq-presets" id="standard-eq-presets">
    <div class="standard-eq-folder"><span data-standard-eq-directory></span><button type="button" data-standard-eq-action="choose-directory">选择预设文件夹</button><button type="button" data-standard-eq-action="open-directory">打开文件夹</button><button type="button" data-standard-eq-action="refresh">刷新</button></div>
    <div class="processing-preset-fields">
      <label class="settings-row"><span>入门预设</span><select data-standard-eq-select aria-label="入门预设"><option value="">当前设置</option></select></label>
      <label class="settings-row"><span>预设名称<small>名称对应预设文件名</small></span><input type="text" maxlength="120" data-standard-eq-name aria-label="入门预设名称"></label>
    </div>
    <div class="processing-preset-actions">
      <button type="button" data-standard-eq-action="save">保存</button>
      <button type="button" data-standard-eq-action="save-copy">另存</button>
      <button type="button" data-standard-eq-action="save-as">另存为</button>
      <button type="button" data-standard-eq-action="rename">重命名</button>
      <button type="button" data-standard-eq-action="import">导入预设</button>
      <button type="button" data-standard-eq-action="restore">恢复默认</button>
      <button type="button" data-standard-eq-action="undo">撤销</button>
    </div>
    <p class="processing-preset-status" data-standard-eq-status role="status" aria-live="polite"></p>
    <details class="standard-eq-legacy" hidden><summary>旧入门预设</summary><select data-standard-eq-legacy-select aria-label="旧入门预设"></select><button type="button" data-standard-eq-action="load-legacy">载入旧预设</button><p>载入后可通过“另存”保存为独立的本机预设文件，原预设保留。</p></details>
  </div>`;
}

type Hooks = {
  request?: (request: StandardEqFileRequest) => Promise<StandardEqFileResult>;
  getSettings: () => ProcessingSettings;
  apply: (value: ReturnType<typeof parseStandardEqPresetFile>) => void | Promise<void>;
  restore: () => void | Promise<void>;
  undo: () => void | Promise<void>;
  canUndo: () => boolean;
  legacy: () => { id: string; name: string }[];
  loadLegacy: (id: string) => void | Promise<void>;
  changed: () => void;
};

export function setupStandardEqPresets(root: HTMLElement, state: StandardEqPresetState, hooks: Hooks) {
  let destroyed = false;
  let busy = false;
  let refreshing: Promise<void> | undefined;
  const select = root.querySelector<HTMLSelectElement>("[data-standard-eq-select]")!;
  const name = root.querySelector<HTMLInputElement>("[data-standard-eq-name]")!;
  const status = root.querySelector<HTMLElement>("[data-standard-eq-status]")!;
  const request = async (value: StandardEqFileRequest) => {
    if (!hooks.request) throw new Error(trUi("请在桌面应用中管理预设文件。"));
    const result = await hooks.request({ ...value, language: uiLanguage() });
    if (!result?.ok) throw new Error(result?.error || trUi("预设文件操作失败。"));
    return result;
  };
  const persistSelection = () => {
    try {
      if (state.selected) localStorage.setItem(selectionKey, JSON.stringify({ directory: state.directory, fileName: state.selected.fileName, revision: state.selected.revision }));
      else localStorage.removeItem(selectionKey);
    } catch { /* A file save never depends on renderer storage. */ }
  };
  const show = (message: string, error = false) => {
    if (destroyed) return;
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const sync = () => {
    if (destroyed) return;
    const directory = root.querySelector<HTMLElement>("[data-standard-eq-directory]")!;
    directory.textContent = state.directory || trUi("尚未选择预设文件夹");
    directory.title = state.directory;
    const duplicates = new Set(state.entries.filter((entry, index, entries) => entries.findIndex(other => other.name === entry.name) !== index).map(entry => entry.name));
    select.innerHTML = ui`<option value="">当前设置</option>` + state.entries.map(entry => `<option value="${esc(entry.fileName)}">${esc(duplicates.has(entry.name) ? entry.fileName : entry.name)}</option>`).join("");
    select.value = state.selected?.fileName || "";
    if (root.ownerDocument.activeElement !== name) name.value = state.name || state.selected?.name || hooks.getSettings().eq.name;
    root.querySelectorAll<HTMLButtonElement>("[data-standard-eq-action]").forEach(button => {
      const action = button.dataset.standardEqAction;
      button.disabled = busy || (hooks.getSettings().eq.engine !== "standard") || (!hooks.request && !["restore", "undo", "load-legacy"].includes(action!))
        || (["save", "rename"].includes(action!) && !state.selected)
        || (action === "undo" && !hooks.canUndo());
    });
    select.disabled = busy || !hooks.request;
    name.disabled = busy;
    const legacy = hooks.legacy();
    root.querySelector<HTMLDetailsElement>(".standard-eq-legacy")!.hidden = !legacy.length;
    const legacySelect = root.querySelector<HTMLSelectElement>("[data-standard-eq-legacy-select]")!;
    const previous = legacySelect.value;
    legacySelect.innerHTML = legacy.map(entry => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join("");
    if (legacy.some(entry => entry.id === previous)) legacySelect.value = previous;
  };
  const acceptList = (result: StandardEqFileResult) => {
    if (result.directory !== undefined && result.directory !== state.directory) {
      if (state.directory) { state.selected = undefined; state.name = ""; persistSelection(); }
      state.directory = result.directory;
    }
    if (result.presets) state.entries = result.presets;
    if (state.selected && !state.entries.some(entry => entry.fileName === state.selected!.fileName)) {
      state.selected = undefined;
      persistSelection();
      show(trUi("当前预设文件已不在此文件夹，编辑中的参数仍保留。"));
    }
  };
  const refresh = () => {
    if (destroyed || busy || !hooks.request || hooks.getSettings().eq.engine !== "standard") return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const result = await request({ action: "list" });
        if (destroyed) return;
        acceptList(result);
        if (state.restored) {
          const restored = state.restored;
          state.restored = undefined;
          if (!state.selected && restored.directory === state.directory && state.entries.some(entry => entry.fileName === restored.fileName)) {
            const loaded = await request({ action: "read", fileName: restored.fileName });
            if (destroyed) return;
            if (loaded.selected) {
              state.selected = { ...loaded.selected, revision: restored.revision };
              state.name = loaded.selected.name;
              if (loaded.selected.revision !== restored.revision) show(trUi("预设文件已在外部更改；可重新选择载入，或另存当前修改。"), true);
            }
          }
        }
        if (result.issues?.length) show(result.issues.join("\n"), true);
        sync();
        hooks.changed();
      } catch (error) { show((error as Error).message, true); }
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  };
  const act = async (action: string) => {
    if (refreshing) await refreshing;
    if (busy || destroyed || hooks.getSettings().eq.engine !== "standard") return;
    busy = true;
    sync();
    try {
      if (action === "restore" || action === "undo") {
        await hooks[action]();
        show(action === "restore" ? trUi("已恢复默认入门设置，尚未覆盖预设文件。") : trUi("已撤销上一步设置。"));
        return;
      }
      if (action === "load-legacy") {
        await hooks.loadLegacy(root.querySelector<HTMLSelectElement>("[data-standard-eq-legacy-select]")!.value);
        state.selected = undefined;
        state.name = hooks.getSettings().eq.name;
        persistSelection();
        show(trUi("旧预设已载入，可通过“另存”保存为本机预设文件。"));
        return;
      }
      if (action === "refresh") {
        acceptList(await request({ action: "list" }));
        show(trUi("预设列表已刷新。"));
        return;
      }
      const result = await request({
        action: action as StandardEqFileRequest["action"],
        fileName: state.selected?.fileName,
        revision: state.selected?.revision,
        name: name.value.trim(),
        ...(["save", "save-copy", "save-as"].includes(action) ? { content: serializeStandardEqPresetFile(hooks.getSettings()) } : {}),
      });
      if (destroyed || result.cancelled) return;
      acceptList(result);
      if (result.selected && action !== "import" && !result.savedOutside) {
        state.selected = result.selected;
        state.name = result.selected.name;
        persistSelection();
      }
      if (action === "import") show(trUi("预设已复制到文件夹，请从列表选择载入。"));
      else if (action === "choose-directory") show(trUi("已切换预设文件夹，原文件保留。"));
      else if (action === "rename") show(trUi("预设文件已重命名。"));
      else if (result.savedOutside) show(ui`已另存到：${result.filePath || ""}`);
      else if (action !== "open-directory") show(result.message || trUi("本机预设文件已保存。"));
      if (result.issues?.length) show(result.issues.join("\n"), true);
    } catch (error) { show((error as Error).message, true); }
    finally { busy = false; sync(); hooks.changed(); }
  };
  const onClick = (event: Event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-standard-eq-action]");
    if (!button || !root.contains(button) || button.disabled) return;
    void act(button.dataset.standardEqAction!);
  };
  const onChange = async (event: Event) => {
    if (event.target !== select || busy || hooks.getSettings().eq.engine !== "standard") return;
    const fileName = select.value;
    if (refreshing) await refreshing;
    if (busy || destroyed || hooks.getSettings().eq.engine !== "standard") return;
    if (!fileName) { state.selected = undefined; persistSelection(); sync(); hooks.changed(); return; }
    busy = true;
    sync();
    try {
      const result = await request({ action: "read", fileName });
      if (destroyed || hooks.getSettings().eq.engine !== "standard") return;
      if (!result.selected) throw new Error(trUi("预设文件未返回有效内容。"));
      await hooks.apply(parseStandardEqPresetFile(result.selected.sourceText, result.selected.fileName));
      state.selected = result.selected;
      state.name = result.selected.name;
      persistSelection();
      show(ui`已载入“${result.selected.name}”。`);
    } catch (error) { show((error as Error).message, true); }
    finally { busy = false; sync(); hooks.changed(); }
  };
  const onInput = (event: Event) => { if (event.target === name) state.name = name.value; };
  const onFocus = () => { void refresh(); };
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  root.ownerDocument.defaultView?.addEventListener("focus", onFocus);
  sync();
  if (!hooks.request) show(trUi("请在桌面应用中管理预设文件。"));
  else void refresh();
  return {
    sync,
    refresh,
    show,
    destroy() {
      destroyed = true;
      root.removeEventListener("click", onClick);
      root.removeEventListener("change", onChange);
      root.removeEventListener("input", onInput);
      root.ownerDocument.defaultView?.removeEventListener("focus", onFocus);
    },
  };
}
