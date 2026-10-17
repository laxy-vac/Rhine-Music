import { trUi } from "./i18n";

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function directChild<T extends HTMLElement>(parent: HTMLElement, selector: string): T | null {
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && child.matches(selector)) return child as T;
  }
  return null;
}

function annotateSettings(root: HTMLElement): void {
  const settingsPage = root.matches("#music-settings")
    ? root
    : root.closest<HTMLElement>("#music-settings");
  const content = root.matches("#settings-page-content")
    ? root
    : settingsPage?.querySelector<HTMLElement>("#settings-page-content") ?? root;
  const categories = Array.from(content.querySelectorAll<HTMLElement>(".settings-category"));

  const nav = settingsPage?.querySelector<HTMLElement>(".settings-page-nav")
    ?? root.querySelector<HTMLElement>(".settings-page-nav");
  if (nav) nav.dataset.settingsCount = twoDigits(categories.length);

  categories.forEach((category, categoryIndex) => {
    const categoryNumber = twoDigits(categoryIndex + 1);
    const categoryId = category.dataset.settingsCategory;
    category.dataset.settingsIndex = categoryNumber;
    const categoryHeading = directChild<HTMLHeadingElement>(category, "h2");
    if (categoryHeading) categoryHeading.dataset.settingsIndex = categoryNumber;

    if (categoryId && !category.id) category.id = `settings-category-panel-${categoryId}`;
    if (categoryId) {
      const button = nav?.querySelector<HTMLElement>(
        `[data-settings-category-target="${categoryId}"]`,
      );
      // The audio button already controls its quick-jump group.
      if (button && !button.hasAttribute("aria-controls") && category.id) {
        button.setAttribute("aria-controls", category.id);
      }
    }

    const panels = Array.from(category.querySelectorAll<HTMLElement>(
      ".panel-section, .quality-settings, .future-window-settings, .gpu-settings, .lyrics-settings-card",
    )).filter((panel) => !panel.matches("#graphics-display-settings, #lyrics-global-settings")
      && panel.closest(".settings-category") === category
      && !panel.parentElement?.closest(".panel-section:not(#graphics-display-settings):not(#lyrics-global-settings)"));
    let panelIndex = 0;
    for (const panel of panels) {
      const heading = panel.querySelector<HTMLHeadingElement>(
        ":scope > h3, :scope > .gpu-settings-heading > h3, :scope > .quality-heading > h3, :scope > .graphics-window-settings > .window-aspect-settings > h3",
      );
      if (!heading) continue;
      panelIndex += 1;
      heading.dataset.settingsSectionIndex = `${categoryNumber}.${twoDigits(panelIndex)}`;
    }
  });
}

function enhanceInterfaceSettings(root: HTMLElement): void {
  const section = root.querySelector<HTMLElement>("#interface-settings");
  if (!section || section.querySelector(":scope > .future-style-shortcut")) return;

  const heading = directChild<HTMLHeadingElement>(section, "h3");
  const language = section.querySelector<HTMLSelectElement>("#ui-language")?.closest("label");
  const applyLanguage = section.querySelector<HTMLElement>('[data-action="apply-language"]');
  const styleHint = directChild<HTMLParagraphElement>(section, "p");
  const openStyle = section.querySelector<HTMLElement>(':scope > [data-action="theme"]');

  if (
    !heading || !language || !applyLanguage || !styleHint || !openStyle
    || language.parentElement !== section
    || applyLanguage.parentElement !== section
  ) return;

  const shortcut = document.createElement("div");
  shortcut.className = "future-style-shortcut";
  shortcut.append(styleHint, openStyle);

  heading.insertAdjacentElement("afterend", language);
  language.insertAdjacentElement("afterend", applyLanguage);
  section.append(shortcut);
}

function enhanceFeedbackSettings(root: HTMLElement): void {
  const section = root.querySelector<HTMLElement>("#interface-sound-settings");
  if (!section || section.querySelector(":scope > .future-feedback-grid")) return;

  const heading = directChild<HTMLHeadingElement>(section, "h3");
  const status = section.querySelector<HTMLElement>("#interface-sound-status");
  const effectsToggle = section.querySelector<HTMLInputElement>("#sound-setting")?.closest("label");
  const effectsVolume = section.querySelector<HTMLInputElement>("#sound-volume")?.closest("label");
  const effectsPreview = section.querySelector<HTMLElement>('[data-action="sound-preview"]');
  const ambienceStatus = section.querySelector<HTMLElement>("#interface-bgm-status");
  const ambienceToggle = section.querySelector<HTMLInputElement>("#bgm-setting")?.closest("label");
  const ambienceVolume = section.querySelector<HTMLInputElement>("#bgm-volume")?.closest("label");
  const expectedNodes = [
    status, effectsToggle, effectsVolume, effectsPreview,
    ambienceStatus, ambienceToggle, ambienceVolume,
  ];
  if (!heading || expectedNodes.some((node) => !node || node.parentElement !== section)) return;

  const grid = document.createElement("div");
  grid.className = "future-feedback-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", heading.textContent?.trim() || trUi("界面声音与氛围"));

  const effects = document.createElement("div");
  effects.className = "future-feedback-channel";
  effects.dataset.feedback = "effects";
  effects.append(effectsToggle!, effectsVolume!, effectsPreview!);

  const ambience = document.createElement("div");
  ambience.className = "future-feedback-channel";
  ambience.dataset.feedback = "ambience";
  ambience.append(ambienceStatus!, ambienceToggle!, ambienceVolume!);

  grid.append(effects, ambience);
  status!.insertAdjacentElement("afterend", grid);
}

function enhanceDisplaySettings(root: HTMLElement): void {
  const section = root.querySelector<HTMLElement>("#graphics-display-settings");
  if (!section || section.querySelector(":scope > .future-display-columns")) return;

  const heading = directChild<HTMLHeadingElement>(section, "h3");
  const windowSettings = directChild<HTMLElement>(section, ".graphics-window-settings");
  const gpuSettings = directChild<HTMLElement>(section, "[data-gpu-settings]");
  if (!heading || !windowSettings || !gpuSettings) return;

  const windowColumn = document.createElement("div");
  windowColumn.className = "future-window-settings";
  windowColumn.append(windowSettings);

  const columns = document.createElement("div");
  columns.className = "future-display-columns";
  columns.append(windowColumn, gpuSettings);
  heading.insertAdjacentElement("afterend", columns);
}

function enhanceFtpSettings(root: HTMLElement): void {
  const section = root.querySelector<HTMLElement>("#ftp-settings");
  if (!section || section.querySelector(":scope > .future-connection-grid")) return;

  const heading = directChild<HTMLHeadingElement>(section, "h3");
  const ftpFields = directChild<HTMLDivElement>(section, ".ftp-fields");
  if (!heading || !ftpFields) return;

  const fieldIds = ["ftp-host", "ftp-user", "ftp-password", "ftp-root"] as const;
  const pairedFields = fieldIds.map((id) => {
    const control = section.querySelector<HTMLInputElement>(`#${id}`);
    const label = section.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
    return control && label && control.parentElement === section && label.parentElement === section
      ? { control, label }
      : null;
  });
  if (pairedFields.some((field) => !field)) return;

  const networkFields = ["ftp-port", "ftp-security"] as const;
  const networkPairs = networkFields.map((id) => {
    const control = section.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    const field = control?.parentElement;
    const label = field ? directChild<HTMLLabelElement>(field, "label") : null;
    // The select enhancer associates this label with its trigger instead of
    // the hidden native select; keep both controls in their existing field.
    const trigger = control?.nextElementSibling;
    const labelledControl = label?.htmlFor === id
      || (trigger?.matches(".settings-select-trigger") && label?.htmlFor === trigger.id);
    return control && label && labelledControl && field && field.parentElement === ftpFields
      ? { control, label, field }
      : null;
  });
  if (networkPairs.some((field) => !field)) return;

  const grid = document.createElement("div");
  grid.className = "future-connection-grid";

  const wrapField = (label: HTMLLabelElement, control: HTMLInputElement): HTMLElement => {
    const field = document.createElement("div");
    field.className = "future-connection-field";
    section.insertBefore(field, label);
    field.append(label, control);
    return field;
  };

  for (const pair of networkPairs) pair!.field.classList.add("future-connection-field");
  const host = wrapField(pairedFields[0]!.label, pairedFields[0]!.control);
  const user = wrapField(pairedFields[1]!.label, pairedFields[1]!.control);
  const password = wrapField(pairedFields[2]!.label, pairedFields[2]!.control);
  const path = wrapField(pairedFields[3]!.label, pairedFields[3]!.control);

  grid.append(host, ftpFields, user, password, path);
  heading.insertAdjacentElement("afterend", grid);
}

/** Add Future-only structural hooks while preserving the existing controls and state owners. */
export function enhanceFutureSettings(root: HTMLElement): void {
  if (!root.closest('.music-app[data-design="rhine"]')) return;

  enhanceInterfaceSettings(root);
  enhanceFeedbackSettings(root);
  enhanceDisplaySettings(root);
  enhanceFtpSettings(root);
  annotateSettings(root);
}
