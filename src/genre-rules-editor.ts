import { escapeHtml as esc } from "./html";
import { uiLanguage } from "./i18n";
import type { GenreRules, MusicAlbum } from "./music-types";
import {
  parseGenreRulesJson, removeGenreRule, renameGenreRule,
  setAlbumGenreOverride, validateGenreRules,
} from "./music-genre-rules.mjs";
import "./genre-rules-editor.css";

type Options = {
  rules: GenreRules;
  albums: readonly MusicAlbum[];
  save: (rules: GenreRules) => Promise<GenreRules>;
  reload: () => Promise<GenreRules>;
  applied: () => Promise<void>;
  back?: () => void;
};

const t = (zh: string, en: string) => uiLanguage() === "en" ? en : zh;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const normalizedAlias = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
let genreRulesEditorInstance = 0;

/** Both views edit one rule draft; invalid JSON never replaces the valid draft. */
export function setupGenreRulesEditor(host: HTMLElement, options: Options) {
  let draft = validateGenreRules(options.rules);
  let baseline = JSON.stringify(draft);
  let expandedGenreId: string | undefined = draft.genres[0]?.id;
  const editorId = ++genreRulesEditorInstance;
  let jsonError = "";
  let pendingDelete: string | undefined;
  let pendingNavigation: "back" | "reload" | undefined;
  let newOverride = { album: "", id: "", genre: "unclassified" };
  let saving = false, destroyed = false;
  const events = new AbortController();
  const albums = new Map(options.albums.map(album => [album.id, album]));
  host.innerHTML = `<section class="genre-rules-editor" aria-label="${t("本地分类规则", "Local classification rules")}">
    <p class="panel-intro">${t("管理展示流派、标签别名和专辑人工分类。保存后重新归并本地索引，不扫描音乐，也不修改音频标签。", "Manage display genres, tag aliases and album overrides. Saving reclassifies the cached library without scanning music or changing audio tags.")}</p>
    <fieldset class="genre-rules-form"><legend class="genre-rules-sr-only">${t("图形规则编辑", "Visual rule editor")}</legend></fieldset>
    <div class="genre-rules-toolbar"><button type="button" data-genre-action="save" class="primary-button">${t("保存并应用", "Save and apply")}</button><button type="button" data-genre-action="back"${options.back ? "" : " hidden"}>${t("返回目录管理", "Back to folders")}</button><button type="button" data-genre-action="reload">${t("重新读取已保存规则", "Reload saved rules")}</button></div>
    <div class="genre-rules-reload-confirm" hidden><p>${t("重新读取会放弃这里尚未保存的修改。", "Reloading discards the unsaved changes in this editor.")}</p><button type="button" data-genre-action="confirm-reload">${t("放弃修改并读取", "Discard and reload")}</button><button type="button" data-genre-action="cancel-reload">${t("继续编辑", "Keep editing")}</button></div>
    <p class="genre-rules-feedback" role="status" aria-live="polite"></p>
    <details class="genre-rules-json"><summary>${t("打开规则 JSON（批量管理）", "Open rule JSON (bulk editing)")}</summary><p>${t("JSON 与上方编辑内容同步，修改后点击“保存并应用”。格式错误时会保留原有内容。", "JSON stays in sync with the controls above. Save and apply to use your changes. Invalid JSON leaves the existing content intact.")}</p><label class="genre-rules-sr-only" for="genre-json">${t("规则 JSON", "Rule JSON")}</label><textarea id="genre-json" class="json-editor" spellcheck="false"></textarea><button type="button" data-genre-action="discard-json">${t("从图形草稿恢复 JSON", "Restore JSON from visual draft")}</button></details>
  </section>`;
  const root = host.querySelector<HTMLElement>(".genre-rules-editor")!;
  const form = root.querySelector<HTMLFieldSetElement>(".genre-rules-form")!;
  const json = root.querySelector<HTMLTextAreaElement>("#genre-json")!;
  const feedback = root.querySelector<HTMLElement>(".genre-rules-feedback")!;
  const details = root.querySelector<HTMLDetailsElement>(".genre-rules-json")!;
  const reloadConfirm = root.querySelector<HTMLElement>(".genre-rules-reload-confirm")!;
  const button = (action: string) => root.querySelector<HTMLButtonElement>(`[data-genre-action="${action}"]`)!;

  function report(message: string, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle("is-error", error);
    feedback.setAttribute("role", error ? "alert" : "status");
  }
  function syncControls() {
    form.disabled = saving || !!jsonError;
    json.disabled = saving;
    for (const action of ["save", "back", "reload", "discard-json", "confirm-reload", "cancel-reload"]) button(action).disabled = saving;
    try { validateGenreRules(draft); button("save").disabled = saving || !!jsonError; }
    catch { button("save").disabled = true; }
    json.setAttribute("aria-invalid", String(!!jsonError));
  }
  function changed() {
    jsonError = "";
    json.value = JSON.stringify(draft, null, 2);
    reloadConfirm.hidden = true;
    pendingNavigation = undefined;
    try {
      validateGenreRules(draft);
      report(JSON.stringify(draft) === baseline ? t("所有修改已保存。", "All changes are saved.") : t("草稿已同步；点击“保存并应用”后生效。", "Draft synchronized. Save and apply to use these changes."));
    } catch (error) { report(errorText(error), true); }
    syncControls();
  }
  function genreOptions(selected: string, automatic = false) {
    return `${automatic ? `<option value=""${selected === "" ? " selected" : ""}>${t("自动归类", "Automatic")}</option>` : ""}${draft.genres.map(genre => `<option value="${esc(genre.id)}"${genre.id === selected ? " selected" : ""}>${esc(genre.name || t("未命名流派", "Unnamed genre"))} · ${esc(genre.id)}</option>`).join("")}`;
  }
  function albumOptions(selected = "") {
    return `<option value="">${t("选择曲库中的专辑…", "Choose a library album…")}</option>${options.albums.map(album => `<option value="${esc(album.id)}"${selected === album.id ? " selected" : ""}>${esc(album.title)} · ${esc(album.artist)}</option>`).join("")}`;
  }
  function aliasConflicts() {
    const seen = new Map<string, string>();
    const conflicts = new Set<string>();
    for (const genre of draft.genres) for (const value of [genre.id, genre.name, ...(genre.aliases ?? [])]) {
      const key = normalizedAlias(value);
      if (!key) continue;
      const previous = seen.get(key);
      if (previous && previous !== genre.id) conflicts.add(value);
      else seen.set(key, genre.id);
    }
    return [...conflicts];
  }
  function renderWarnings() {
    const warning = form.querySelector<HTMLElement>(".genre-rules-warning")!;
    const conflicts = aliasConflicts();
    warning.hidden = !conflicts.length;
    warning.textContent = conflicts.length ? `${t("有相同的名称或别名，匹配时优先使用排在前面的流派：", "Names or aliases overlap; the first genre in the list wins: ")}${conflicts.join("、")}` : "";
  }
  function render() {
    if (!draft.genres.some(genre => genre.id === newOverride.genre)) newOverride.genre = "unclassified";
    if (expandedGenreId && !draft.genres.some(genre => genre.id === expandedGenreId)) expandedGenreId = draft.genres[0]?.id;
    form.innerHTML = `<section class="genre-rules-section"><div class="genre-rules-heading"><h3>${t("展示流派", "Display genres")}</h3><small>${draft.genres.length} / 1000</small><button type="button" data-genre-action="add-genre"${draft.genres.length >= 1000 ? " disabled" : ""}>${t("＋ 添加流派", "+ Add genre")}</button></div><p>${t("别名会与音乐标签中的流派名称进行归并。使用上下按钮调整匹配优先级；同名别名优先匹配排在前面的流派。", "Aliases merge matching genre tags. Move genres up or down to set priority when aliases overlap.")}</p><p class="genre-rules-warning" hidden></p><div class="genre-rules-list">${draft.genres.map((genre, index) => {
      const references = Object.values(draft.albumOverrides).filter(id => id === genre.id).length;
      const isExpanded = expandedGenreId === genre.id;
      const panelId = `genre-rules-card-${editorId}-${index}`;
      const aliasCount = genre.aliases?.length ?? 0;
      return `<article class="genre-rule" data-genre-index="${index}"><div class="genre-rule-header"><button type="button" class="genre-rule-toggle" data-genre-action="toggle-genre" aria-expanded="${isExpanded}" aria-controls="${panelId}"><strong>${String(index + 1).padStart(2, "0")}</strong><span class="genre-rule-title">${esc(genre.name || t("未命名流派", "Unnamed genre"))}</span><small>${aliasCount} ${t("个别名", "aliases")}</small></button><div class="genre-rule-row-actions"><button type="button" data-genre-action="genre-up" aria-label="${t("上移流派", "Move genre up")}"${index === 0 ? " disabled" : ""}>↑</button><button type="button" data-genre-action="genre-down" aria-label="${t("下移流派", "Move genre down")}"${index === draft.genres.length - 1 ? " disabled" : ""}>↓</button><button type="button" data-genre-action="delete-genre"${genre.id === "unclassified" ? " disabled" : ""}>${t("删除流派", "Remove genre")}</button></div></div><div class="genre-rule-panel" id="${panelId}"${isExpanded ? "" : " hidden"}><div class="genre-rule-fields"><label class="genre-rule-field">${t("显示名称", "Display name")}<input type="text" data-genre-field="name" value="${esc(genre.name)}" aria-label="${t("流派名称", "Genre name")} ${index + 1}"></label><label class="genre-rule-field">${t("分类标识", "Genre ID")}<input type="text" data-genre-field="id" value="${esc(genre.id)}" maxlength="100" spellcheck="false"${genre.id === "unclassified" ? " readonly" : ""} aria-label="${t("流派标识", "Genre ID")} ${index + 1}"><small>${genre.id === "unclassified" ? t("未分类保留项；可调整名称和别名。", "Reserved fallback; its name and aliases remain editable.") : t("字母、数字、下划线或短横线；修改时同步更新专辑指定分类。", "Letters, digits, underscores or hyphens. Renaming also updates album overrides.")}</small></label></div><div class="genre-rule-aliases"><span>${t("标签别名", "Tag aliases")}</span>${(genre.aliases ?? []).map((alias, aliasIndex) => `<div class="genre-rule-alias" data-alias-index="${aliasIndex}"><input type="text" data-genre-field="alias" value="${esc(alias)}" aria-label="${t("流派", "Genre")} ${index + 1} ${t("别名", "alias")} ${aliasIndex + 1}"><div class="genre-rule-row-actions"><button type="button" data-genre-action="alias-up" aria-label="${t("上移别名", "Move alias up")}"${aliasIndex === 0 ? " disabled" : ""}>↑</button><button type="button" data-genre-action="alias-down" aria-label="${t("下移别名", "Move alias down")}"${aliasIndex === (genre.aliases?.length ?? 0) - 1 ? " disabled" : ""}>↓</button><button type="button" data-genre-action="delete-alias" aria-label="${t("删除别名", "Remove alias")}">−</button></div></div>`).join("")}<button type="button" data-genre-action="add-alias">${t("＋ 添加别名", "+ Add alias")}</button></div>${pendingDelete === genre.id ? `<div class="genre-rule-delete"><p>${t("此流派被以下数量的专辑指定分类使用：", "Album overrides using this genre: ")}${references}${t("。删除前请选择接收这些专辑的流派。", ". Choose a replacement before removing it.")}</p><select data-keep-native-select data-delete-replacement aria-label="${t("删除后的接收流派", "Replacement genre")}">${draft.genres.filter(other => other.id !== genre.id).map(other => `<option value="${esc(other.id)}"${other.id === "unclassified" ? " selected" : ""}>${esc(other.name)} · ${esc(other.id)}</option>`).join("")}</select><button type="button" data-genre-action="confirm-delete">${t("删除并迁移指定分类", "Remove and reassign overrides")}</button><button type="button" data-genre-action="cancel-delete">${t("取消", "Cancel")}</button></div>` : ""}</div></article>`;
    }).join("")}</div></section>
    <section class="genre-rules-section"><div class="genre-rules-heading"><h3>${t("专辑指定分类", "Album overrides")}</h3><small>${Object.keys(draft.albumOverrides).length}</small></div><p>${t("指定分类优先于自动匹配。删除一项即可恢复自动归类；未在当前曲库中找到的专辑规则也会保留，并可在这里编辑。", "Overrides take priority over automatic matching. Remove an override to restore automatic classification. Rules for albums absent from this library are also retained and editable.")}</p><div class="genre-overrides-list">${Object.entries(draft.albumOverrides).map(([id, genreId], index) => {
      const album = albums.get(id);
      return `<div class="genre-override" data-override-index="${index}"><div class="genre-override-album"><strong>${esc(album ? `${album.title} · ${album.artist}` : t("未在当前曲库中找到的专辑", "Album absent from this library"))}</strong><label class="genre-rule-field">${t("从曲库选择专辑", "Choose a library album")}<select data-keep-native-select data-override-field="album">${albumOptions(id)}</select></label><details${!album ? " open" : ""}><summary>${t("专辑标识", "Album ID")}</summary><label class="genre-rule-field">${t("编辑专辑标识", "Edit album ID")}<input type="text" data-override-field="id" value="${esc(id)}" spellcheck="false"></label></details></div><label class="genre-rule-field">${t("指定流派", "Genre override")}<select data-keep-native-select data-override-field="genre">${genreOptions(genreId, true)}</select></label><button type="button" data-genre-action="delete-override">${t("恢复自动分类", "Restore automatic")}</button></div>`;
    }).join("") || `<p>${t("尚未指定专辑分类，当前使用自动归类。", "No overrides. Albums use automatic classification.")}</p>`}</div><div class="genre-override-add"><label class="genre-rule-field">${t("选择专辑", "Select album")}<select data-keep-native-select data-add-album>${albumOptions(newOverride.album)}</select></label><label class="genre-rule-field">${t("或输入专辑标识", "Or enter an album ID")}<input type="text" data-add-id value="${esc(newOverride.id)}" spellcheck="false" placeholder="${t("可管理尚未入库的专辑", "Also supports albums not yet in the library")}"></label><label class="genre-rule-field">${t("指定流派", "Genre override")}<select data-keep-native-select data-add-genre>${genreOptions(newOverride.genre)}</select></label><button type="button" data-genre-action="add-override">${t("添加指定分类", "Add override")}</button></div></section>`;
    renderWarnings();
    syncControls();
  }
  function focus(selector: string) { form.querySelector<HTMLElement>(selector)?.focus(); }
  function updateGenreLabels() {
    for (const select of form.querySelectorAll<HTMLSelectElement>('[data-override-field="genre"], [data-add-genre]')) {
      for (const option of select.options) {
        const genre = draft.genres.find(item => item.id === option.value);
        if (genre) option.textContent = `${genre.name || t("未命名流派", "Unnamed genre")} · ${genre.id}`;
      }
    }
    renderWarnings();
  }
  function replaceOverrideId(oldId: string, newId: string) {
    newId = newId.trim();
    if (newId === oldId) return;
    if (Object.hasOwn(draft.albumOverrides, newId)) throw new Error(t("该专辑已有指定分类，请编辑现有条目。", "This album already has an override. Edit the existing entry."));
    const genre = draft.albumOverrides[oldId];
    const next = setAlbumGenreOverride(draft, oldId, undefined);
    draft = setAlbumGenreOverride(next, newId, genre);
  }
  async function save() {
    if (saving || jsonError) return;
    let persisted = false;
    try {
      const valid = validateGenreRules(draft);
      saving = true; syncControls();
      const saved = await options.save(valid);
      persisted = true;
      if (destroyed) { await options.applied(); return; }
      draft = validateGenreRules(saved);
      baseline = JSON.stringify(draft);
      pendingDelete = undefined;
      json.value = JSON.stringify(draft, null, 2);
      render();
      await options.applied();
      if (!destroyed) report(t("分类规则已保存并应用。", "Classification rules saved and applied."));
    } catch (error) { if (!destroyed) report(`${persisted ? t("规则已保存，但曲库刷新失败：", "Rules saved, but the library could not be refreshed: ") : ""}${errorText(error)}`, true); }
    finally { saving = false; if (!destroyed) syncControls(); }
  }
  async function reload() {
    saving = true; syncControls();
    try {
      const next = validateGenreRules(await options.reload());
      if (destroyed) return;
      draft = next; baseline = JSON.stringify(next); pendingDelete = undefined;
      reloadConfirm.hidden = true;
      render(); changed();
    } catch (error) { if (!destroyed) report(errorText(error), true); }
    finally { saving = false; if (!destroyed) syncControls(); }
  }
  root.addEventListener("input", event => {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (input === json) {
      try {
        draft = parseGenreRulesJson(json.value); jsonError = ""; pendingDelete = undefined;
        if (!draft.genres.some(genre => genre.id === expandedGenreId)) expandedGenreId = draft.genres[0]?.id;
        render(); report(t("JSON 已同步到图形界面；保存后生效。", "JSON synchronized to the visual editor. Save to apply."));
      } catch (error) { jsonError = errorText(error); report(`${t("JSON 未应用：", "JSON not applied: ")}${jsonError}`, true); }
      syncControls();
      return;
    }
    const index = Number(input.closest<HTMLElement>("[data-genre-index]")?.dataset.genreIndex);
    if (input.dataset.genreField === "name") {
      draft.genres[index].name = input.value;
      input.closest<HTMLElement>("[data-genre-index]")?.querySelector<HTMLElement>(".genre-rule-title")?.replaceChildren(document.createTextNode(input.value || t("未命名流派", "Unnamed genre")));
      updateGenreLabels(); changed();
    } else if (input.dataset.genreField === "alias") {
      const alias = Number(input.closest<HTMLElement>("[data-alias-index]")?.dataset.aliasIndex);
      draft.genres[index].aliases![alias] = input.value; renderWarnings(); changed();
    } else if (input.matches("[data-add-id]")) {
      newOverride.id = input.value;
      newOverride.album = "";
      form.querySelector<HTMLSelectElement>("[data-add-album]")!.value = "";
    }
  }, { signal: events.signal });
  root.addEventListener("change", event => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const index = Number(input.closest<HTMLElement>("[data-genre-index]")?.dataset.genreIndex);
    const overrideIndex = Number(input.closest<HTMLElement>("[data-override-index]")?.dataset.overrideIndex);
    const oldId = Object.keys(draft.albumOverrides)[overrideIndex];
    try {
      if (input.dataset.genreField === "id") {
        draft = renameGenreRule(draft, draft.genres[index].id, input.value.trim());
        expandedGenreId = draft.genres[index].id;
      } else if (input.dataset.overrideField === "id" || input.dataset.overrideField === "album") {
        if (!input.value.trim()) throw new Error(t("请选择专辑或填写专辑标识。", "Choose an album or enter its ID."));
        replaceOverrideId(oldId, input.value);
      } else if (input.dataset.overrideField === "genre") {
        draft = setAlbumGenreOverride(draft, oldId, input.value || undefined);
      } else if (input.matches("[data-add-album]")) {
        newOverride.album = input.value;
        newOverride.id = input.value;
        form.querySelector<HTMLInputElement>("[data-add-id]")!.value = input.value;
        return;
      } else if (input.matches("[data-add-genre]")) {
        newOverride.genre = input.value;
        return;
      } else return;
      render(); changed();
    } catch (error) {
      if (input.dataset.genreField === "id") input.value = draft.genres[index].id;
      else if (input.dataset.overrideField) input.value = input.dataset.overrideField === "genre" ? draft.albumOverrides[oldId] : input.dataset.overrideField === "album" && !albums.has(oldId) ? "" : oldId;
      report(errorText(error), true);
    }
  }, { signal: events.signal });
  root.addEventListener("click", event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-genre-action]");
    if (!target || target.disabled || saving) return;
    const action = target.dataset.genreAction;
    if (action === "save") { void save(); return; }
    if (action === "toggle-genre") {
      const index = Number(target.closest<HTMLElement>("[data-genre-index]")?.dataset.genreIndex);
      const id = draft.genres[index]?.id;
      if (!id) return;
      expandedGenreId = expandedGenreId === id ? undefined : id;
      render();
      focus(`[data-genre-index="${index}"] [data-genre-action="toggle-genre"]`);
      return;
    }
    if (action === "back" || action === "reload") {
      if (jsonError || JSON.stringify(draft) !== baseline) {
        pendingNavigation = action;
        reloadConfirm.querySelector("p")!.textContent = action === "back"
          ? t("返回会放弃这里尚未保存的修改。", "Going back discards the unsaved changes in this editor.")
          : t("重新读取会放弃这里尚未保存的修改。", "Reloading discards the unsaved changes in this editor.");
        button("confirm-reload").textContent = action === "back" ? t("放弃修改并返回", "Discard and go back") : t("放弃修改并读取", "Discard and reload");
        reloadConfirm.hidden = false;
      } else if (action === "back") options.back?.();
      else void reload();
      return;
    }
    if (action === "confirm-reload") { if (pendingNavigation === "back") options.back?.(); else void reload(); return; }
    if (action === "cancel-reload") { reloadConfirm.hidden = true; pendingNavigation = undefined; return; }
    if (action === "discard-json") { changed(); return; }
    const index = Number(target.closest<HTMLElement>("[data-genre-index]")?.dataset.genreIndex);
    const aliasIndex = Number(target.closest<HTMLElement>("[data-alias-index]")?.dataset.aliasIndex);
    const overrideIndex = Number(target.closest<HTMLElement>("[data-override-index]")?.dataset.overrideIndex);
    try {
      let selector = "";
      if (action === "add-genre") {
        if (draft.genres.length >= 1000) return;
        let number = 1;
        while (draft.genres.some(genre => genre.id === `genre-${number}`)) number++;
        draft.genres.push({ id: `genre-${number}`, name: t("新流派", "New genre"), aliases: [] });
        expandedGenreId = draft.genres[draft.genres.length - 1].id;
        selector = `[data-genre-index="${draft.genres.length - 1}"] [data-genre-field="name"]`;
      } else if (action === "genre-up" || action === "genre-down") {
        const next = index + (action === "genre-up" ? -1 : 1);
        if (next < 0 || next >= draft.genres.length) return;
        [draft.genres[index], draft.genres[next]] = [draft.genres[next], draft.genres[index]];
        selector = `[data-genre-index="${next}"] [data-genre-field="name"]`;
      } else if (action === "delete-genre") {
        const id = draft.genres[index].id;
        if (Object.values(draft.albumOverrides).includes(id)) { pendingDelete = id; expandedGenreId = id; render(); focus("[data-delete-replacement]"); return; }
        draft = removeGenreRule(draft, id);
      } else if (action === "confirm-delete") {
        draft = removeGenreRule(draft, draft.genres[index].id, form.querySelector<HTMLSelectElement>("[data-delete-replacement]")!.value);
        pendingDelete = undefined;
      } else if (action === "cancel-delete") { pendingDelete = undefined; render(); return; }
      else if (action === "add-alias") {
        expandedGenreId = draft.genres[index].id;
        (draft.genres[index].aliases ??= []).push("");
        selector = `[data-genre-index="${index}"] [data-alias-index="${draft.genres[index].aliases!.length - 1}"] input`;
      } else if (action === "delete-alias") draft.genres[index].aliases!.splice(aliasIndex, 1);
      else if (action === "alias-up" || action === "alias-down") {
        const aliases = draft.genres[index].aliases!;
        const next = aliasIndex + (action === "alias-up" ? -1 : 1);
        if (next < 0 || next >= aliases.length) return;
        [aliases[aliasIndex], aliases[next]] = [aliases[next], aliases[aliasIndex]];
        selector = `[data-genre-index="${index}"] [data-alias-index="${next}"] input`;
      } else if (action === "delete-override") {
        draft = setAlbumGenreOverride(draft, Object.keys(draft.albumOverrides)[overrideIndex], undefined);
      } else if (action === "add-override") {
        const id = form.querySelector<HTMLInputElement>("[data-add-id]")!.value.trim();
        if (!id) throw new Error(t("请选择专辑或填写专辑标识。", "Choose an album or enter its ID."));
        if (Object.hasOwn(draft.albumOverrides, id)) throw new Error(t("该专辑已有指定分类，请编辑现有条目。", "This album already has an override. Edit the existing entry."));
        draft = setAlbumGenreOverride(draft, id, form.querySelector<HTMLSelectElement>("[data-add-genre]")!.value);
        newOverride = { album: "", id: "", genre: "unclassified" };
      } else return;
      render(); changed();
      if (selector) focus(selector);
    } catch (error) { report(errorText(error), true); }
  }, { signal: events.signal });
  json.addEventListener("blur", () => { if (!jsonError) json.value = JSON.stringify(draft, null, 2); }, { signal: events.signal });
  details.addEventListener("toggle", () => { if (!details.open && jsonError) details.open = true; }, { signal: events.signal });
  render(); changed();
  return {
    destroy() { destroyed = true; events.abort(); },
    hasUnsavedChanges() { return !!jsonError || JSON.stringify(draft) !== baseline; },
  };
}
