import type { MusicAlbum } from "./music-types";
import { splitMusicMetadataValues } from "./music-metadata-values.mjs";

export type MusicSortMode = "genre" | "artist" | "album";

const collator = new Intl.Collator("zh-CN-u-co-pinyin", {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});
const normalize = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
const stableCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Choose a grouping/sorting artist without rewriting the original credit. */
export function leadMusicArtist(artist: string, artists?: readonly string[]): string {
  if (artists && artists.length > 1) return artists[0]?.trim() || artist.trim();
  // Many files store a joined collaboration in one ARTIST value. A singleton
  // native property still needs the conservative legacy-credit parser.
  const raw = (artists?.[0] || artist).trim();
  if (!raw) return "";
  return splitMusicMetadataValues("ARTIST", raw)[0] || raw;
}

/** Formatting differences share a column without rewriting artist metadata. */
export const musicArtistKey = (album: MusicAlbum) => normalize(leadMusicArtist(album.artist, album.artists));

/** Return a new view order, retaining each album and its original metadata. */
export function orderMusicAlbums(albums: readonly MusicAlbum[], mode: MusicSortMode = "genre") {
  const ordered = [...albums];
  if (mode === "genre") return ordered;
  return ordered.sort((a, b) => {
    if (mode === "artist") {
      const artistA = musicArtistKey(a), artistB = musicArtistKey(b);
      // Keep distinct artist keys contiguous even when locale collation treats
      // their spellings as equivalent; album IDs resolve equivalent titles.
      const artist = collator.compare(artistA, artistB) || stableCompare(artistA, artistB);
      if (artist) return artist;
    }
    return collator.compare(normalize(a.title), normalize(b.title)) || stableCompare(a.id, b.id);
  });
}
