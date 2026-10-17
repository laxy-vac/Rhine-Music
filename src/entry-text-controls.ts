import { ENTRY_TEXT_MAX_LENGTH, defaultEntryWelcome, defaultEntryIdentity, sanitizeEntryInput, normalizeEntryText } from "./entry-preferences.mjs";
import { trUi } from "./i18n";

type EntryTextKey = "entryWelcome" | "entryIdentity";
type Ports = {
  read(key: EntryTextKey): string;
  write(key: EntryTextKey, value: string): void;
  enabled(): boolean;
};

/** Keep typing, paste, IME commits and programmatic input inside one boundary. */
export function setupEntryTextControls(root: HTMLElement, ports: Ports) {
  const field = (target: EventTarget | null) => target instanceof HTMLInputElement &&
    target.matches("input[data-entry-text]") &&
    ["entryWelcome", "entryIdentity"].includes(target.dataset.entryText ?? "") ? target : undefined;
  const key = (input: HTMLInputElement) => input.dataset.entryText as EntryTextKey;
  const message = (text: string) => {
    const status = root.querySelector<HTMLElement>("#entry-text-status");
    if (status) status.textContent = text;
  };
  const count = (input: HTMLInputElement) => {
    const output = root.querySelector<HTMLOutputElement>(`[data-entry-count="${key(input)}"]`);
    if (output) output.textContent = `${input.value.length} / ${ENTRY_TEXT_MAX_LENGTH}`;
  };
  const lettersOnly = () => message(trUi("仅接受英文字母 A–Z/a–z 和单词间空格。"));
  const limit = () => message(trUi("最多 24 个字符（含空格），超出部分不能输入。"));
  const commit = (input: HTMLInputElement) => {
    if (!ports.enabled() || input.disabled) { sync(); return; }
    if (/[^A-Za-z ]/.test(input.value) || input.value.length > ENTRY_TEXT_MAX_LENGTH) {
      const tooLong = input.value.length > ENTRY_TEXT_MAX_LENGTH;
      sync();
      if (tooLong) limit(); else lettersOnly();
      return;
    }
    const fallback = key(input) === "entryWelcome" ? defaultEntryWelcome : defaultEntryIdentity;
    const normalized = normalizeEntryText(input.value, fallback);
    const wasEmpty = !input.value.trim();
    input.value = normalized;
    input.setCustomValidity("");
    count(input);
    if (normalized !== ports.read(key(input))) ports.write(key(input), normalized);
    message(trUi(wasEmpty ? "留空已恢复默认内容。" : "已保存，将在下次入场或手动重播时使用。"));
  };
  root.addEventListener("beforeinput", event => {
    const input = field(event.target);
    if (!input || input.disabled) return;
    const change = event as InputEvent;
    if (!change.inputType.startsWith("insert") || change.data === null) return;
    if (/[^A-Za-z ]/.test(change.data)) {
      if (event.cancelable) event.preventDefault();
      lettersOnly();
      return;
    }
    const next = input.value.slice(0, input.selectionStart ?? input.value.length) + change.data +
      input.value.slice(input.selectionEnd ?? input.value.length);
    if (next.length > ENTRY_TEXT_MAX_LENGTH) {
      if (event.cancelable) event.preventDefault();
      limit();
    }
  });
  root.addEventListener("paste", event => {
    const input = field(event.target);
    if (!input || input.disabled) return;
    const clipboard = (event as ClipboardEvent).clipboardData?.getData("text/plain");
    if (clipboard === undefined) return;
    const next = input.value.slice(0, input.selectionStart ?? input.value.length) + clipboard +
      input.value.slice(input.selectionEnd ?? input.value.length);
    if (/[^A-Za-z ]/.test(clipboard)) { event.preventDefault(); lettersOnly(); }
    else if (next.length > ENTRY_TEXT_MAX_LENGTH) { event.preventDefault(); limit(); }
  });
  root.addEventListener("input", event => {
    const input = field(event.target);
    if (!input) return;
    if (!ports.enabled() || input.disabled) { sync(); return; }
    const previous = input.value;
    const caret = input.selectionStart ?? previous.length;
    const clean = sanitizeEntryInput(previous);
    if (clean !== previous) {
      input.value = clean;
      const position = Math.min(clean.length, sanitizeEntryInput(previous.slice(0, caret)).length);
      input.setSelectionRange(position, position);
      if (previous.length > ENTRY_TEXT_MAX_LENGTH) limit();
      else lettersOnly();
    } else message("");
    input.setCustomValidity("");
    count(input);
  });
  root.addEventListener("change", event => {
    const input = field(event.target);
    if (input) commit(input);
  });
  root.addEventListener("keydown", event => {
    const input = field(event.target);
    if (input && event.key === "Enter") { event.preventDefault(); commit(input); }
  });
  function sync() {
    root.querySelectorAll<HTMLInputElement>("input[data-entry-text]").forEach(input => {
      input.value = ports.read(key(input));
      count(input);
    });
  }
  return { sync };
}
