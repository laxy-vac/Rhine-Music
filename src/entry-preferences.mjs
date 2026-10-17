export const ENTRY_TEXT_MAX_LENGTH = 24;
export const defaultEntryWelcome = "Internal DataBase";
export const defaultEntryIdentity = "Kristen Wright";

const entryTextPattern = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

export function isEntryTextValid(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= ENTRY_TEXT_MAX_LENGTH &&
    entryTextPattern.test(value);
}

export function sanitizeEntryInput(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^A-Za-z ]/g, "")
    .replace(/ +/g, " ")
    .replace(/^ /, "")
    .slice(0, ENTRY_TEXT_MAX_LENGTH);
}

export function normalizeEntryText(value, fallback) {
  const safeFallback = isEntryTextValid(fallback)
    ? fallback
    : defaultEntryWelcome;
  if (typeof value !== "string") return safeFallback;
  const normalized = value.replace(/^ +| +$/g, "").replace(/ +/g, " ");
  return isEntryTextValid(normalized) ? normalized : safeFallback;
}
