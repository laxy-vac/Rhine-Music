import { trUi, ui } from "./i18n";
import { setupFutureRangeInteraction } from "./future-range-interaction";
type EditableRangeRecord = {
  range: HTMLInputElement;
  valueButton: HTMLButtonElement;
  hiddenOutput?: HTMLOutputElement;
  outputWasHidden?: boolean;
  outputWasAriaHidden?: string | null;
  editor?: HTMLInputElement;
  previousTitle: string | null;
};

type RangeProgressRecord = {
  update: () => void;
  previousValue: string;
  previousPriority: string;
  lastValue: string;
};

const RANGE_SELECTOR = 'input[type="range"]';
const RANGE_PROGRESS_PROPERTY = "--range-progress";

function numberText(value: number, step: string) {
  const decimals = step === "any" ? 2 : Math.min(4, Math.max(0, (step.split(".")[1] || "").length));
  return Number(value.toFixed(decimals)).toString();
}

function rangeUnit(range: HTMLInputElement) {
  if (range.dataset.rangeUnit !== undefined) return range.dataset.rangeUnit;
  if (range.id === "playback-progress") return trUi(" 秒");
  if (range.dataset.quality !== undefined || range.id.includes("volume")) return "%";
  return "";
}

function playbackTimeText(value: number) {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const seconds = String(total % 60).padStart(2, "0");
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${String(Math.floor((total / 60) % 60)).padStart(2, "0")}:${seconds}`
    : `${Math.floor(total / 60)}:${seconds}`;
}

function valueLabel(record: EditableRangeRecord) {
  const range = record.range;
  const value = Number(range.value);
  if (range.id === "playback-progress") return playbackTimeText(value);
  const shown = Number.isFinite(value) ? numberText(value, range.step || "1") : range.value;
  return `${shown}${rangeUnit(range)}`;
}

function emit(range: HTMLInputElement, name: "input" | "change") {
  const EventConstructor = range.ownerDocument.defaultView?.Event;
  range.dispatchEvent(EventConstructor
    ? new EventConstructor(name, { bubbles: true })
    : new Event(name, { bubbles: true }));
}

function numericError(editor: HTMLInputElement, range: HTMLInputElement) {
  const value = editor.value.trim() === "" ? NaN : Number(editor.value);
  const min = range.min === "" ? -Infinity : Number(range.min);
  const max = range.max === "" ? Infinity : Number(range.max);
  const unit = rangeUnit(range);
  if (!Number.isFinite(value)) return trUi("请输入有限数字。");
  if (value < min || value > max) {
    const low = Number.isFinite(min) ? `${numberText(min, range.step || "1")}${unit}` : trUi("无下限");
    const high = Number.isFinite(max) ? `${numberText(max, range.step || "1")}${unit}` : trUi("无上限");
    return ui`数值需在 ${low} 至 ${high} 之间。`;
  }
  const step = range.step === "any" || range.step === "" ? 0 : Number(range.step);
  if (Number.isFinite(step) && step > 0 && Number.isFinite(min)) {
    const units = (value - min) / step;
    if (Math.abs(units - Math.round(units)) > 1e-7) return ui`请使用 ${numberText(step, "0.0001")}${unit} 为步长。`;
  }
  return "";
}

function setInvalid(editor: HTMLInputElement, message: string) {
  editor.setCustomValidity(message);
  editor.setAttribute("aria-invalid", String(!!message));
  editor.title = message;
}

export function setupEditableRanges(root: Document | HTMLElement = document) {
  const records = new Map<HTMLInputElement, EditableRangeRecord>();
  const progressRecords = new Map<HTMLInputElement, RangeProgressRecord>();
  const documentRef = root instanceof Document ? root : root.ownerDocument;
  const observer = new MutationObserver(() => sync());
  const futureInteraction = setupFutureRangeInteraction(root, range => {
    const record = records.get(range);
    return record ? { valueButton: record.valueButton, label: () => valueLabel(record), editing: () => !!record.editor } : undefined;
  });

  const updateRangeProgress = (range: HTMLInputElement) => {
    let progressRecord = progressRecords.get(range);
    if (!progressRecord) {
      progressRecord = {
        update: () => {},
        previousValue: range.style.getPropertyValue(RANGE_PROGRESS_PROPERTY),
        previousPriority: range.style.getPropertyPriority(RANGE_PROGRESS_PROPERTY),
        lastValue: "",
      };
      progressRecord.update = () => {
        const rawMin = range.min === "" ? 0 : Number(range.min);
        const rawMax = range.max === "" ? 100 : Number(range.max);
        const min = Number.isFinite(rawMin) ? rawMin : 0;
        const max = Number.isFinite(rawMax) ? rawMax : 100;
        const value = range.valueAsNumber;
        const ratio = Number.isFinite(value) && max > min
          ? Math.min(1, Math.max(0, (value - min) / (max - min)))
          : 0;
        const nextValue = `${Number((ratio * 100).toFixed(3))}%`;
        if (progressRecord!.lastValue === nextValue && range.style.getPropertyValue(RANGE_PROGRESS_PROPERTY) === nextValue) return;
        range.style.setProperty(RANGE_PROGRESS_PROPERTY, nextValue);
        progressRecord!.lastValue = nextValue;
      };
      progressRecords.set(range, progressRecord);
      range.addEventListener("input", progressRecord.update);
      range.addEventListener("change", progressRecord.update);
    }
    progressRecord.update();
  };

  const restoreRangeProgress = (range: HTMLInputElement, progressRecord: RangeProgressRecord) => {
    range.removeEventListener("input", progressRecord.update);
    range.removeEventListener("change", progressRecord.update);
    if (progressRecord.previousValue) {
      range.style.setProperty(RANGE_PROGRESS_PROPERTY, progressRecord.previousValue, progressRecord.previousPriority);
    } else {
      range.style.removeProperty(RANGE_PROGRESS_PROPERTY);
    }
  };

  const cancelEditor = (record: EditableRangeRecord, focus = false) => {
    const editor = record.editor;
    if (!editor) return;
    const button = record.valueButton;
    record.editor = undefined;
    editor.replaceWith(button);
    button.textContent = valueLabel(record);
    if (focus && button.isConnected) button.focus({ preventScroll: true });
  };

  const commitEditor = (record: EditableRangeRecord) => {
    const editor = record.editor;
    if (!editor || record.range.disabled) return false;
    const error = numericError(editor, record.range);
    if (error) {
      setInvalid(editor, error);
      editor.focus();
      return false;
    }
    record.range.value = String(Number(editor.value));
    record.editor = undefined;
    editor.replaceWith(record.valueButton);
    record.valueButton.textContent = valueLabel(record);
    emit(record.range, "input");
    emit(record.range, "change");
    record.valueButton.focus({ preventScroll: true });
    return true;
  };

  const startEditor = (record: EditableRangeRecord) => {
    const range = record.range;
    if (range.disabled || record.editor || !range.isConnected) return;
    const input = documentRef.createElement("input");
    input.className = "editable-range-number";
    input.type = "number";
    input.inputMode = "decimal";
    input.setAttribute("aria-label", ui`${range.getAttribute("aria-label") || range.id || trUi("范围")}数值`);
    if (range.min !== "") input.min = range.min;
    if (range.max !== "") input.max = range.max;
    input.step = range.step || "1";
    input.value = range.value;
    input.title = rangeUnit(range) ? ui`单位：${rangeUnit(range)}` : trUi("按 Enter 应用，按 Esc 取消");
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commitEditor(record);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelEditor(record, true);
      }
    });
    input.addEventListener("input", () => setInvalid(input, numericError(input, range)));
    input.addEventListener("blur", () => {
      queueMicrotask(() => {
        if (record.editor === input && documentRef.activeElement !== input) cancelEditor(record);
      });
    });
    record.editor = input;
    record.valueButton.replaceWith(input);
    input.focus();
    input.select();
  };

  const createRecord = (range: HTMLInputElement) => {
    if (range.dataset.editableRange === "false") return;
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = `editable-range-value${range.id === "playback-progress" ? " playback-progress-value" : ""}`;
    button.setAttribute("aria-label", ui`${range.getAttribute("aria-label") || range.id || trUi("范围")}数值编辑`);
    button.title = rangeUnit(range) ? ui`点击输入数值 · 单位${rangeUnit(range)}` : trUi("点击输入数值");
    button.addEventListener("click", () => startEditor(records.get(range)!));
    let hiddenOutput: HTMLOutputElement | undefined;
    if (range.id === "playback-volume" || range.id === "playback-progress" || range.dataset.quality !== undefined) {
      const outputSelector = range.id === "playback-volume" ? "#playback-volume-value" : range.id === "playback-progress" ? "#playback-elapsed" : undefined;
      hiddenOutput = outputSelector ? documentRef.querySelector<HTMLOutputElement>(outputSelector) || undefined
        : Array.from(range.parentElement?.querySelectorAll<HTMLOutputElement>('output[data-quality-output]') ?? [])
          .find(output => output.dataset.qualityOutput === range.dataset.quality);
      if (hiddenOutput) {
        const outputWasHidden = hiddenOutput.hidden;
        const outputWasAriaHidden = hiddenOutput.getAttribute("aria-hidden");
        hiddenOutput.hidden = true;
        hiddenOutput.setAttribute("aria-hidden", "true");
        hiddenOutput.insertAdjacentElement("beforebegin", button);
        observer.observe(hiddenOutput, { childList: true, characterData: true, subtree: true });
        const record: EditableRangeRecord = { range, valueButton: button, hiddenOutput, outputWasHidden, outputWasAriaHidden, previousTitle: range.getAttribute("title") };
        records.set(range, record);
        button.textContent = valueLabel(record);
        range.addEventListener("input", () => {
          if (record.editor) return;
          const label = valueLabel(record);
          if (button.textContent !== label) button.textContent = label;
        });
        range.addEventListener("change", () => {
          if (record.editor) return;
          const label = valueLabel(record);
          if (button.textContent !== label) button.textContent = label;
        });
        return;
      } else range.insertAdjacentElement("afterend", button);
    } else {
      range.insertAdjacentElement("afterend", button);
    }
    const record: EditableRangeRecord = { range, valueButton: button, hiddenOutput, previousTitle: range.getAttribute("title") };
    records.set(range, record);
    button.textContent = valueLabel(record);
    range.addEventListener("input", () => {
      if (record.editor) return;
      button.textContent = valueLabel(record);
    });
    range.addEventListener("change", () => {
      if (record.editor) return;
      button.textContent = valueLabel(record);
    });
  };

  const sync = () => {
    futureInteraction.sync();
    const candidates: HTMLInputElement[] = [];
    if (root instanceof Document) candidates.push(...root.querySelectorAll<HTMLInputElement>(RANGE_SELECTOR));
    else {
      if (root.matches(RANGE_SELECTOR)) candidates.push(root as HTMLInputElement);
      candidates.push(...root.querySelectorAll<HTMLInputElement>(RANGE_SELECTOR));
    }
    for (const range of candidates) {
      updateRangeProgress(range);
      if (!records.has(range)) createRecord(range);
      const record = records.get(range);
      if (!record) continue;
      if (record.editor) continue;
      if (record.valueButton.disabled !== range.disabled) record.valueButton.disabled = range.disabled;
      const label = valueLabel(record);
      if (record.valueButton.textContent !== label) record.valueButton.textContent = label;
    }
    for (const [range, progressRecord] of progressRecords) {
      if (range.isConnected) continue;
      restoreRangeProgress(range, progressRecord);
      progressRecords.delete(range);
    }
    for (const [range, record] of records) {
      if (range.isConnected) continue;
      record.valueButton.remove();
      if (record.hiddenOutput) {
        record.hiddenOutput.hidden = record.outputWasHidden ?? false;
        if (record.outputWasAriaHidden === null || record.outputWasAriaHidden === undefined) record.hiddenOutput.removeAttribute("aria-hidden");
        else record.hiddenOutput.setAttribute("aria-hidden", record.outputWasAriaHidden);
      }
      records.delete(range);
    }
  };

  sync();
  const observeRoot = root instanceof Document ? root.documentElement : root;
  observer.observe(observeRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ["min", "max", "step", "value", "disabled", "hidden", "inert", "open", "data-page", "data-design"] });

  return {
    sync,
    destroy() {
      observer.disconnect();
      futureInteraction.destroy();
      for (const [range, progressRecord] of progressRecords) restoreRangeProgress(range, progressRecord);
      progressRecords.clear();
      for (const [range, record] of records) {
        cancelEditor(record);
        record.valueButton.remove();
        if (record.hiddenOutput) {
          record.hiddenOutput.hidden = record.outputWasHidden ?? false;
          if (record.outputWasAriaHidden === null || record.outputWasAriaHidden === undefined) record.hiddenOutput.removeAttribute("aria-hidden");
          else record.hiddenOutput.setAttribute("aria-hidden", record.outputWasAriaHidden);
        }
        if (record.previousTitle === null) range.removeAttribute("title");
        else range.setAttribute("title", record.previousTitle);
      }
      records.clear();
    },
  };
}
