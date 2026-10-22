import { uiLanguage } from "./i18n.ts";

export type LibrarySettingsSection =
  | "folders"
  | "classification"
  | "metadata"
  | "providers";

type LibrarySettingsSectionInfo = {
  id: LibrarySettingsSection;
  title: string;
  intro: string;
};

const text = (zh: string, en: string) => (uiLanguage() === "en" ? en : zh);

export const librarySettingsSections: readonly LibrarySettingsSectionInfo[] = [
  {
    id: "folders",
    title: text("音乐文件夹", "Folders"),
    intro: text("管理音乐目录、扫描状态和封面演示。", "Manage music folders, scan status, and the cover preview."),
  },
  {
    id: "classification",
    title: text("分类与排列", "Classification & order"),
    intro: text("管理自动归类、专辑指定分类和浏览排列方式。", "Manage automatic classification, album overrides, and browse order."),
  },
  {
    id: "metadata",
    title: text("专辑资料", "Album metadata"),
    intro: text("更新自动继承的专辑资料，查看查询进度。", "Update inherited album information and view lookup progress."),
  },
  {
    id: "providers",
    title: text("资料来源", "Data providers"),
    intro: text("管理全局来源优先级、自定义来源和覆盖范围。", "Manage global source priority, custom providers, and overwrite scope."),
  },
];

const isLibrarySettingsSection = (value: string): value is LibrarySettingsSection =>
  librarySettingsSections.some((section) => section.id === value);

type AttributeSnapshot = {
  name: string;
  value: string | null;
};

type PanelSnapshot = {
  panel: HTMLElement;
  hidden: boolean;
  attributes: AttributeSnapshot[];
  tabIndex: string | null;
};

function snapshotAttributes(element: HTMLElement, names: string[]): AttributeSnapshot[] {
  return names.map((name) => ({ name, value: element.getAttribute(name) }));
}

function restoreAttributes(element: HTMLElement, attributes: AttributeSnapshot[]) {
  for (const { name, value } of attributes) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
}

export function setupLibrarySettingsNavigation(
  root: HTMLElement,
  initial: LibrarySettingsSection,
  onChange: (section: LibrarySettingsSection) => void,
): {
  select(next: LibrarySettingsSection, focus?: boolean): void;
  destroy(): void;
} {
  const document = root.ownerDocument;
  const panels = new Map<LibrarySettingsSection, HTMLElement>();
  const panelSnapshots: PanelSnapshot[] = [];

  for (const panel of root.querySelectorAll<HTMLElement>("[data-library-section]")) {
    const id = panel.dataset.librarySection;
    if (!id || !isLibrarySettingsSection(id)) continue;
    if (panels.has(id)) throw new Error(`Duplicate library settings panel: ${id}`);
    panels.set(id, panel);
  }
  for (const section of librarySettingsSections) {
    if (!panels.has(section.id)) {
      throw new Error(`Missing library settings panel: ${section.id}`);
    }
  }

  const nav = document.createElement("nav");
  nav.className = "library-settings-nav";
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", text("音乐库设置分区", "Music library settings sections"));
  nav.setAttribute("aria-orientation", "horizontal");

  const tabs = new Map<LibrarySettingsSection, HTMLButtonElement>();
  for (const section of librarySettingsSections) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "library-settings-tab";
    tab.dataset.libraryTab = section.id;
    tab.id = `library-settings-tab-${section.id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `library-settings-${section.id}`);
    tab.setAttribute("aria-selected", "false");
    tab.tabIndex = -1;
    tab.textContent = section.title;
    nav.append(tab);
    tabs.set(section.id, tab);
  }

  const context = document.createElement("div");
  context.className = "library-settings-context";
  context.setAttribute("aria-live", "polite");
  context.setAttribute("aria-atomic", "true");
  const breadcrumb = document.createElement("p");
  breadcrumb.className = "library-settings-breadcrumb";
  const currentIntro = document.createElement("p");
  currentIntro.className = "library-settings-current-intro";
  context.append(breadcrumb, currentIntro);

  const firstPanel = panels.get(librarySettingsSections[0].id)!;
  root.insertBefore(nav, firstPanel);
  root.insertBefore(context, firstPanel);

  for (const section of librarySettingsSections) {
    const panel = panels.get(section.id)!;
    panelSnapshots.push({
      panel,
      hidden: panel.hidden,
      attributes: snapshotAttributes(panel, ["id", "role", "aria-labelledby"]),
      tabIndex: panel.getAttribute("tabindex"),
    });
    panel.id = `library-settings-${section.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `library-settings-tab-${section.id}`);
    panel.tabIndex = 0;
  }

  const controller = new AbortController();
  let current: LibrarySettingsSection | undefined;
  let destroyed = false;

  function select(next: LibrarySettingsSection, focus = false) {
    if (destroyed || !isLibrarySettingsSection(next)) return;
    const panel = panels.get(next);
    const tab = tabs.get(next);
    if (!panel || !tab) return;

    const changed = current !== next;
    current = next;
    for (const section of librarySettingsSections) {
      const isCurrent = section.id === next;
      panels.get(section.id)!.hidden = !isCurrent;
      const sectionTab = tabs.get(section.id)!;
      sectionTab.setAttribute("aria-selected", String(isCurrent));
      sectionTab.tabIndex = isCurrent ? 0 : -1;
    }

    breadcrumb.textContent = `${text("音乐库", "Music library")} / ${librarySettingsSections.find((section) => section.id === next)!.title}`;
    currentIntro.textContent = librarySettingsSections.find((section) => section.id === next)!.intro;
    if (focus) tab.focus({ preventScroll: true });
    if (changed) onChange(next);
  }

  nav.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-library-tab]");
    if (!target || !nav.contains(target)) return;
    const next = target.dataset.libraryTab;
    if (next && isLibrarySettingsSection(next)) select(next);
  }, { signal: controller.signal });

  nav.addEventListener("keydown", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-library-tab]");
    if (!target || !nav.contains(target)) return;
    const currentIndex = librarySettingsSections.findIndex((section) => section.id === target.dataset.libraryTab);
    if (currentIndex < 0) return;

    let nextIndex = -1;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % librarySettingsSections.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex + librarySettingsSections.length - 1) % librarySettingsSections.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = librarySettingsSections.length - 1;
    if (nextIndex < 0) return;

    event.preventDefault();
    select(librarySettingsSections[nextIndex].id, true);
  }, { signal: controller.signal });

  select(initial);

  return {
    select,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort();
      nav.remove();
      context.remove();
      for (const snapshot of panelSnapshots) {
        snapshot.panel.hidden = snapshot.hidden;
        restoreAttributes(snapshot.panel, snapshot.attributes);
        if (snapshot.tabIndex === null) snapshot.panel.removeAttribute("tabindex");
        else snapshot.panel.setAttribute("tabindex", snapshot.tabIndex);
      }
    },
  };
}
