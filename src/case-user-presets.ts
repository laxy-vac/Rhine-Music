import { normalizeCaseSettings, type CaseAppearance } from "./case-settings";

export type CaseUserPreset = {
  id: string;
  name: string;
  appearance: CaseAppearance;
};

export const CASE_USER_PRESET_LIMIT = 50;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizePunkAppearance(value: unknown): CaseAppearance | undefined {
  if (!isRecord(value) || !isRecord(value.surfaces)) return undefined;

  const settings = normalizeCaseSettings({
    structure: "punk",
    appearances: {
      punk: {
        ...value,
        preset: "custom",
        presetRevision: 4,
      },
    },
  }, "rhine");

  return structuredClone({
    ...settings.appearances.punk,
    preset: "custom",
    presetRevision: 4,
  });
}

/** Normalize, bound, and independently clone a theme's saved Punk material presets. */
export function normalizeCaseUserPresets(value: unknown): CaseUserPreset[] {
  if (!Array.isArray(value)) return [];

  const result: CaseUserPreset[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) continue;
    const { id, name } = item;
    if (typeof id !== "string" || id.length < 1 || id.length > 80 || id.trim() !== id || !/^[A-Za-z0-9_-]+$/u.test(id)) continue;
    if (typeof name !== "string") continue;
    const cleanName = name.trim();
    if (!cleanName || Array.from(cleanName).length > 64) continue;

    const nameKey = cleanName.toLowerCase();
    if (ids.has(id) || names.has(nameKey)) continue;

    let appearance: CaseAppearance | undefined;
    try {
      appearance = normalizePunkAppearance(item.appearance);
    } catch {
      appearance = undefined;
    }
    if (!appearance) continue;

    result.push({ id, name: cleanName, appearance });
    ids.add(id);
    names.add(nameKey);
    if (result.length >= CASE_USER_PRESET_LIMIT) break;
  }

  return result;
}

/** Return a normalized, detached Punk appearance snapshot for the user library. */
export function caseUserPresetAppearance(value: CaseAppearance): CaseAppearance {
  const appearance = normalizePunkAppearance(value);
  if (!appearance) throw new TypeError("A Punk case appearance with a surfaces object is required.");
  return appearance;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
  );
}

function appearanceFingerprint(value: unknown): string | undefined {
  try {
    const appearance = normalizePunkAppearance(value);
    if (!appearance) return undefined;
    return JSON.stringify(stableValue({
      surfaces: appearance.surfaces,
      transforms: appearance.transforms ?? {},
    }));
  } catch {
    return undefined;
  }
}

/** Compare only normalized materials and transforms; labels and preset ids do not matter. */
export function caseUserPresetMatches(
  preset: CaseUserPreset,
  appearance: CaseAppearance,
): boolean {
  const saved = appearanceFingerprint(preset?.appearance);
  const current = appearanceFingerprint(appearance);
  return saved !== undefined && current !== undefined && saved === current;
}
