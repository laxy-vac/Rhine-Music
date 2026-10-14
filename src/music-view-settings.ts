export type MusicLayout = "shelf" | "array" | "grid";

export type MusicViewSettings = {
  layout: MusicLayout;
  show: "albums" | "tracks";
  group: "genre" | "artist" | "decade" | "az" | "none";
  sort: "artist" | "title" | "year" | "added";
};

export type LegacyCatalogOptions = {
  layout: "array" | "grid" | "future";
  show: MusicViewSettings["show"];
  group: MusicViewSettings["group"];
  sort: MusicViewSettings["sort"];
};

export const defaultMusicViewSettings: MusicViewSettings = {
  layout: "array",
  show: "albums",
  group: "genre",
  sort: "artist",
};

const layouts = ["shelf", "array", "grid"] as const;
const shows = ["albums", "tracks"] as const;
const groups = ["genre", "artist", "decade", "az", "none"] as const;
const sorts = ["artist", "title", "year", "added"] as const;
const legacyLayouts = ["array", "grid", "future"] as const;

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

const layoutFromLegacy = (value: unknown): MusicLayout | undefined => {
  if (!isOneOf(value, legacyLayouts)) return undefined;
  if (value === "array") return "shelf";
  if (value === "future") return "array";
  return "grid";
};

const layoutToLegacy = (value: MusicLayout): LegacyCatalogOptions["layout"] => {
  if (value === "shelf") return "array";
  if (value === "array") return "future";
  return "grid";
};

export function normalizeMusicViewSettings(value: unknown): MusicViewSettings {
  return migrateMusicViewSettings(value, undefined);
}

export function migrateMusicViewSettings(
  value: unknown,
  legacy: unknown,
  defaultLayout: MusicLayout = "array",
): MusicViewSettings {
  const current = objectValue(value);
  const previous = objectValue(legacy);
  const previousLayout = layoutFromLegacy(previous.layout);

  return {
    layout: isOneOf(current.layout, layouts)
      ? current.layout
      : previousLayout ?? defaultLayout,
    show: isOneOf(current.show, shows)
      ? current.show
      : isOneOf(previous.show, shows)
        ? previous.show
        : defaultMusicViewSettings.show,
    group: isOneOf(current.group, groups)
      ? current.group
      : isOneOf(previous.group, groups)
        ? previous.group
        : defaultMusicViewSettings.group,
    sort: isOneOf(current.sort, sorts)
      ? current.sort
      : isOneOf(previous.sort, sorts)
        ? previous.sort
        : defaultMusicViewSettings.sort,
  };
}

export function legacyCatalogOptions(view: MusicViewSettings): LegacyCatalogOptions {
  const normalized = normalizeMusicViewSettings(view);
  return {
    layout: layoutToLegacy(normalized.layout),
    show: normalized.show,
    group: normalized.group,
    sort: normalized.sort,
  };
}

export function musicViewFromLegacy(value: LegacyCatalogOptions): MusicViewSettings {
  return migrateMusicViewSettings(undefined, value);
}
