/** Shared English labels for the two music designs. Keep their display form stable. */
export const musicInterfaceLabels = {
  navigation: {
    archive: "ARCHIVE",
    equalizer: "EQ",
    lyrics: "LYRICS",
    signal: "SIGNAL",
    style: "STYLE",
    search: "SEARCH",
    online: "ONLINE",
    settings: "SETTINGS",
  },
  browse: {
    fields: {
      show: { tag: "SHOW", ariaKey: "显示" },
      layout: { tag: "LAYOUT", ariaKey: "布局" },
      group: { tag: "GROUP", ariaKey: "分组" },
      sort: { tag: "SORT", ariaKey: "排序" },
      perPage: { tag: "PER PAGE", ariaKey: "每页数量" },
    },
    choices: {
      show: [
        { value: "albums", label: "ALBUMS" },
        { value: "tracks", label: "TRACKS" },
      ],
      layout: [
        { value: "shelf", label: "ARRAY" },
        { value: "array", label: "MATRIX" },
        { value: "grid", label: "GRID" },
      ],
      group: [
        { value: "genre", label: "GENRE" },
        { value: "artist", label: "ARTIST" },
        { value: "decade", label: "DECADE" },
        { value: "az", label: "A-Z" },
        { value: "none", label: "NONE" },
      ],
      sort: [
        { value: "artist", label: "ARTIST" },
        { value: "title", label: "TITLE" },
        { value: "year", label: "YEAR" },
        { value: "added", label: "ADDED" },
      ],
    },
  },
  profile: {
    heading: "PROFILE",
    fields: {
      release: "RELEASE",
      artist: "ARTIST",
      genre: "GENRE",
      volumes: "VOLUMES",
      format: "FORMAT",
      resolution: "RESOLUTION",
      bitrate: "BITRATE",
      duration: "DURATION",
    },
  },
  catalog: {
    randomPick: "RANDOM PICK",
    allGroup: "ALL",
  },
} as const;

export type MusicBrowseField = keyof typeof musicInterfaceLabels.browse.choices;
export type MusicBrowseChoice = { value: string; label: string };

export function musicCountLabel(kind: "album" | "track", count: number): string {
  const singular = kind === "track" ? "TRACK" : "ALBUM";
  return `${singular}${count === 1 ? "" : "S"}`;
}
