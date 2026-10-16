type PopoverMenu = HTMLDivElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

type OptionSnapshot = {
  value: string;
  label: string;
  disabled: boolean;
};

type SelectLabel = {
  element: HTMLLabelElement;
  originalFor: string | null;
};

type SelectControl = {
  select: HTMLSelectElement;
  label: HTMLLabelElement | null;
  labels: SelectLabel[];
  originalSelectTabIndex: string | null;
  originalSelectAriaHidden: string | null;
  hadRowClass: boolean;
  trigger: HTMLButtonElement;
  valueText: HTMLSpanElement;
  menu: PopoverMenu;
  options: HTMLDivElement[];
  activeIndex: number;
  activeValue: string | null;
  open: boolean;
  usingPopover: boolean;
  lastDisabled: boolean;
  lastValue: string;
  lastSelectedIndex: number;
  lastOptionsSignature: string;
};

const SELECTOR = "select:not([multiple]):not([data-keep-native-select])";
const NATIVE_CLASS = "settings-select-native";
const ROW_CLASS = "settings-select-row";
let uniqueId = 0;

function restoreAttribute(element: Element, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function makeId(document: Document, base: string) {
  let id = `${base}-${++uniqueId}`;
  while (document.getElementById(id)) id = `${base}-${++uniqueId}`;
  return id;
}

function optionLabel(option: HTMLOptionElement) {
  return option.label || option.textContent?.trim() || option.value;
}

function optionDisabled(option: HTMLOptionElement) {
  const parent = option.parentElement;
  return option.disabled || (parent?.tagName.toLowerCase() === "optgroup" && (parent as HTMLOptGroupElement).disabled);
}

function selectedText(select: HTMLSelectElement) {
  const option = select.selectedOptions[0];
  return option ? optionLabel(option) : select.value;
}

function optionSnapshot(select: HTMLSelectElement) {
  const options = Array.from(select.options, (option): OptionSnapshot => ({
    value: option.value,
    label: optionLabel(option),
    disabled: optionDisabled(option),
  }));
  return { options, signature: JSON.stringify(options.map(({ value, label, disabled }) => [value, label, disabled])) };
}

function findEnabledOption(select: HTMLSelectElement, start: number, direction: 1 | -1 = 1) {
  const count = select.options.length;
  if (!count) return -1;

  const initial = start < 0
    ? (direction === 1 ? 0 : count - 1)
    : Math.max(0, Math.min(count - 1, start));
  for (let offset = 0; offset < count; offset += 1) {
    const index = (initial + offset * direction + count * 2) % count;
    if (!optionDisabled(select.options[index])) return index;
  }
  return -1;
}

function selectedOrFirstEnabled(select: HTMLSelectElement) {
  const selected = select.selectedIndex;
  if (selected >= 0 && !optionDisabled(select.options[selected])) return selected;
  return findEnabledOption(select, 0);
}

function findEnabledOptionByValue(select: HTMLSelectElement, value: string) {
  for (let index = 0; index < select.options.length; index += 1) {
    const option = select.options[index];
    if (option.value === value && !optionDisabled(option)) return index;
  }
  return -1;
}

export function enhanceSettingsSelectControls(container: HTMLElement, options: { menuMinWidth?: number } = {}): {
  sync(): void;
  close(): void;
  destroy(): void;
} {
  const document = container.ownerDocument;
  const window = document.defaultView;
  const listenerController = new AbortController();
  const controls: SelectControl[] = [];
  let openControl: SelectControl | null = null;

  const revealActiveOption = (control: SelectControl) => {
    if (!control.open || control.menu.hidden) return;
    const option = control.options[control.activeIndex];
    if (!option) return;
    const menuBox = control.menu.getBoundingClientRect();
    const optionBox = option.getBoundingClientRect();
    if (!menuBox.height) return;
    if (optionBox.bottom > menuBox.bottom - 6) control.menu.scrollTop += optionBox.bottom - menuBox.bottom + 6;
    else if (optionBox.top < menuBox.top + 6) control.menu.scrollTop -= menuBox.top + 6 - optionBox.top;
  };

  const setActive = (control: SelectControl, index: number) => {
    if (index < 0 || index >= control.options.length || !control.select.options[index] || optionDisabled(control.select.options[index])) return;
    control.activeIndex = index;
    control.activeValue = control.select.options[index].value;
    control.options.forEach((option, optionIndex) => {
      option.classList.toggle("is-active", optionIndex === index);
    });
    control.trigger.setAttribute("aria-activedescendant", control.options[index].id);
    revealActiveOption(control);
  };

  const positionMenu = (control: SelectControl) => {
    if (!control.open) return;
    const rect = control.trigger.getBoundingClientRect();
    const content = control.trigger.closest(".settings-page-content");
    const contentBox = content?.getBoundingClientRect();
    if (contentBox && (rect.bottom <= contentBox.top || rect.top >= contentBox.bottom)) {
      closeControl(control);
      return;
    }
    const viewportWidth = window?.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window?.innerHeight || document.documentElement.clientHeight;
    const edge = 12;
    const gap = 7;
    const menuWidth = Math.max(0, Math.min(Math.max(rect.width, Math.min(options.menuMinWidth ?? 296, viewportWidth - edge * 2)), viewportWidth - edge * 2));
    control.menu.style.width = `${menuWidth}px`;

    const above = Math.max(0, rect.top - edge - gap);
    const below = Math.max(0, viewportHeight - rect.bottom - edge - gap);
    const naturalHeight = control.menu.scrollHeight || 180;
    const openAbove = below < Math.min(naturalHeight, 240) && above > below;
    const available = openAbove ? above : below;
    control.menu.style.maxHeight = `${Math.max(80, Math.min(320, available))}px`;

    const menuHeight = control.menu.getBoundingClientRect().height || Math.min(naturalHeight, 320);
    const left = Math.max(edge, Math.min(rect.left, viewportWidth - menuWidth - edge));
    const preferredTop = openAbove ? rect.top - menuHeight - gap : rect.bottom + gap;
    const top = Math.max(edge, Math.min(preferredTop, viewportHeight - menuHeight - edge));
    control.menu.style.left = `${left}px`;
    control.menu.style.top = `${top}px`;
    revealActiveOption(control);
  };

  const closeControl = (control: SelectControl) => {
    if (!control.open) return;
    control.open = false;
    control.trigger.setAttribute("aria-expanded", "false");
    control.trigger.removeAttribute("aria-activedescendant");
    if (control.usingPopover) {
      try {
        control.menu.hidePopover?.();
      } catch {
        // A menu may already have been closed by the browser during navigation.
      }
    }
    control.menu.hidden = true;
    if (openControl === control) openControl = null;
  };

  const closeAll = () => {
    if (openControl) closeControl(openControl);
  };

  const renderOptions = (control: SelectControl, snapshot: OptionSnapshot[]) => {
    control.menu.replaceChildren();
    control.options = snapshot.map((source, index) => {
      const option = document.createElement("div");
      option.className = "settings-select-option";
      option.id = `${control.trigger.id}-option-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === control.select.selectedIndex));
      option.dataset.optionIndex = String(index);
      if (source.disabled) option.setAttribute("aria-disabled", "true");
      option.textContent = source.label;
      control.menu.append(option);
      return option;
    });
  };

  const syncOptionList = (control: SelectControl) => {
    const snapshot = optionSnapshot(control.select);
    if (snapshot.signature === control.lastOptionsSignature) return false;

    const activeValue = control.open ? control.activeValue : null;
    control.lastOptionsSignature = snapshot.signature;
    renderOptions(control, snapshot.options);

    if (control.open) {
      const firstEnabled = findEnabledOption(control.select, 0);
      if (control.select.disabled || snapshot.options.length === 0 || firstEnabled < 0) {
        closeControl(control);
      } else {
        const preserved = activeValue === null ? -1 : findEnabledOptionByValue(control.select, activeValue);
        setActive(control, preserved >= 0 ? preserved : selectedOrFirstEnabled(control.select));
      }
    } else {
      control.activeIndex = selectedOrFirstEnabled(control.select);
      control.activeValue = control.select.options[control.activeIndex]?.value ?? null;
    }
    return true;
  };

  const updateControl = (control: SelectControl, force = false) => {
    const optionsChanged = syncOptionList(control);
    const valueChanged = force || optionsChanged || control.lastValue !== control.select.value;
    const selectionChanged = force || optionsChanged || control.lastSelectedIndex !== control.select.selectedIndex;
    const disabledChanged = force || control.lastDisabled !== control.select.disabled;
    if (!valueChanged && !selectionChanged && !disabledChanged) return optionsChanged;

    if (valueChanged) control.valueText.textContent = selectedText(control.select);
    if (selectionChanged) {
      control.options.forEach((option, index) => {
        option.setAttribute("aria-selected", String(index === control.select.selectedIndex));
      });
    }
    if (disabledChanged) control.trigger.disabled = control.select.disabled;

    if (control.select.disabled) closeControl(control);
    else if (control.open && selectionChanged && !optionsChanged) {
      const next = selectedOrFirstEnabled(control.select);
      if (next >= 0) setActive(control, next);
      else closeControl(control);
    }

    control.lastValue = control.select.value;
    control.lastSelectedIndex = control.select.selectedIndex;
    control.lastDisabled = control.select.disabled;
    return optionsChanged;
  };

  const dispatchChange = (select: HTMLSelectElement) => {
    const EventConstructor = document.defaultView?.Event;
    select.dispatchEvent(EventConstructor
      ? new EventConstructor("change", { bubbles: true })
      : new Event("change", { bubbles: true }));
  };

  const chooseOption = (control: SelectControl, index: number) => {
    if (control.select.disabled || index < 0 || index >= control.select.options.length) return;
    const source = control.select.options[index];
    if (!source || optionDisabled(source)) return;
    const changed = control.select.selectedIndex !== index;
    control.select.selectedIndex = index;
    if (changed) dispatchChange(control.select);
    control.trigger.focus({ preventScroll: true });
    closeControl(control);
    updateControl(control);
  };

  const openMenu = (control: SelectControl, firstMove: 0 | 1 | -1 = 0) => {
    updateControl(control);
    if (control.select.disabled || !control.options.length) return;
    const firstEnabled = findEnabledOption(control.select, 0);
    if (firstEnabled < 0) return;
    if (openControl && openControl !== control) closeControl(openControl);
    if (control.open) return;

    control.open = true;
    openControl = control;
    control.menu.hidden = false;
    control.trigger.setAttribute("aria-expanded", "true");
    let next = selectedOrFirstEnabled(control.select);
    if (firstMove !== 0) {
      let candidate = control.select.selectedIndex >= 0 ? control.select.selectedIndex : (firstMove === 1 ? -1 : 0);
      for (let count = 0; count < control.select.options.length; count += 1) {
        candidate = (candidate + firstMove + control.select.options.length) % control.select.options.length;
        if (!optionDisabled(control.select.options[candidate])) {
          next = candidate;
          break;
        }
      }
    }
    if (typeof control.menu.showPopover === "function") {
      try {
        control.menu.showPopover();
        control.usingPopover = true;
      } catch {
        control.usingPopover = false;
        control.menu.removeAttribute("popover");
        control.menu.style.display = "flex";
      }
    } else {
      control.usingPopover = false;
      control.menu.removeAttribute("popover");
      control.menu.style.display = "flex";
    }
    setActive(control, next);
    positionMenu(control);
  };

  const onTriggerKeyDown = (control: SelectControl, event: KeyboardEvent) => {
    updateControl(control);
    if (event.key === "Escape") {
      if (control.open) {
        event.preventDefault();
        event.stopPropagation();
        closeControl(control);
      }
      return;
    }
    if (event.key === "Tab") {
      closeControl(control);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!control.open) openMenu(control, direction);
      else {
        let next = control.activeIndex;
        for (let count = 0; count < control.options.length; count += 1) {
          next = (next + direction + control.options.length) % control.options.length;
          if (!optionDisabled(control.select.options[next])) break;
        }
        setActive(control, next);
      }
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!control.open) openMenu(control);
      const start = event.key === "Home" ? 0 : control.options.length - 1;
      const direction = event.key === "Home" ? 1 : -1;
      setActive(control, findEnabledOption(control.select, start, direction));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!control.open) openMenu(control);
      else chooseOption(control, control.activeIndex);
    }
  };

  for (const select of Array.from(container.querySelectorAll<HTMLSelectElement>(SELECTOR))) {
    if (select.classList.contains(NATIVE_CLASS)) continue;
    const label = select.closest("label");
    const labels = Array.from(select.labels, (element): SelectLabel => ({
      element,
      originalFor: element.getAttribute("for"),
    }));
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "settings-select-trigger";
    trigger.id = makeId(document, `settings-select-${select.id || "select"}`);
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", `${trigger.id}-listbox`);

    const valueText = document.createElement("span");
    valueText.className = "settings-select-value";
    trigger.append(valueText);

    const menu = document.createElement("div") as PopoverMenu;
    menu.className = "settings-select-menu";
    menu.id = `${trigger.id}-listbox`;
    menu.setAttribute("role", "listbox");
    const selectLabel = select.getAttribute("aria-label");
    if (selectLabel) {
      menu.setAttribute("aria-label", selectLabel);
      trigger.setAttribute("aria-label", selectLabel);
    }
    menu.setAttribute("popover", "manual");
    menu.hidden = true;
    container.append(menu);

    const control: SelectControl = {
      select,
      label,
      labels,
      originalSelectTabIndex: select.getAttribute("tabindex"),
      originalSelectAriaHidden: select.getAttribute("aria-hidden"),
      hadRowClass: label?.classList.contains(ROW_CLASS) ?? false,
      trigger,
      valueText,
      menu,
      options: [],
      activeIndex: -1,
      activeValue: null,
      open: false,
      usingPopover: false,
      lastDisabled: !select.disabled,
      lastValue: "",
      lastSelectedIndex: -1,
      lastOptionsSignature: "",
    };
    controls.push(control);

    select.classList.add(NATIVE_CLASS);
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;
    if (label) label.classList.add(ROW_CLASS);
    for (const associatedLabel of labels) associatedLabel.element.htmlFor = trigger.id;
    select.insertAdjacentElement("afterend", trigger);

    trigger.addEventListener("click", () => {
      updateControl(control);
      if (control.open) closeControl(control);
      else openMenu(control);
    }, { signal: listenerController.signal });
    trigger.addEventListener("keydown", (event) => onTriggerKeyDown(control, event), {
      signal: listenerController.signal,
    });
    select.addEventListener("change", () => updateControl(control), { signal: listenerController.signal });
    menu.addEventListener("pointermove", (event) => {
      const target = (event.target as Element | null)?.closest<HTMLDivElement>(".settings-select-option");
      if (!target || !menu.contains(target) || updateControl(control)) return;
      const index = control.options.indexOf(target);
      const source = index >= 0 ? control.select.options[index] : null;
      if (source && !optionDisabled(source)) setActive(control, index);
    }, { signal: listenerController.signal });
    menu.addEventListener("click", (event) => {
      const target = (event.target as Element | null)?.closest<HTMLDivElement>(".settings-select-option");
      if (!target || !menu.contains(target) || updateControl(control)) return;
      const index = control.options.indexOf(target);
      if (index >= 0) chooseOption(control, index);
    }, { signal: listenerController.signal });

    updateControl(control, true);
  }

  document.addEventListener("pointerdown", (event) => {
    if (!openControl) return;
    const path = event.composedPath();
    if (path.includes(openControl.trigger)
      || openControl.labels.some(({ element }) => path.includes(element))
      || path.includes(openControl.menu)) return;
    closeControl(openControl);
  }, { capture: true, signal: listenerController.signal });

  document.addEventListener("scroll", (event) => {
    if (openControl && !openControl.menu.contains(event.target as Node)) positionMenu(openControl);
  }, { capture: true, passive: true, signal: listenerController.signal });

  window?.addEventListener("resize", () => {
    if (openControl) positionMenu(openControl);
  }, { passive: true, signal: listenerController.signal });

  window?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !openControl) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeControl(openControl);
  }, { capture: true, signal: listenerController.signal });

  return {
    sync() {
      controls.forEach((control) => updateControl(control));
    },
    close() {
      closeAll();
    },
    destroy() {
      closeAll();
      listenerController.abort();
      controls.forEach((control) => {
        control.menu.remove();
        control.trigger.remove();
        control.select.classList.remove(NATIVE_CLASS);
        restoreAttribute(control.select, "tabindex", control.originalSelectTabIndex);
        restoreAttribute(control.select, "aria-hidden", control.originalSelectAriaHidden);
        for (const associatedLabel of control.labels) {
          restoreAttribute(associatedLabel.element, "for", associatedLabel.originalFor);
        }
        if (control.label && !control.hadRowClass) control.label.classList.remove(ROW_CLASS);
      });
    },
  };
}
