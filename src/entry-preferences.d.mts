export const ENTRY_TEXT_MAX_LENGTH: 24;
export const defaultEntryWelcome: "Internal DataBase";
export const defaultEntryIdentity: "Kristen Wright";

export type EntryTextCopy = {
  welcome?: string;
  identity?: string;
};

export function isEntryTextValid(value: unknown): value is string;
export function sanitizeEntryInput(value: unknown): string;
export function normalizeEntryText(value: unknown, fallback: string): string;
