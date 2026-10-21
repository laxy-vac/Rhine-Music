import type { MusicAlbum } from "./music-types";

export type MusicSortMode = "genre" | "artist" | "album";

const collator = new Intl.Collator("zh-CN-u-co-pinyin", {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});
const normalize = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
const stableCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const protectedJoinerCredits = new Set([
  "simon & garfunkel", "hall & oates", "sly & the family stone", "the mamas & the papas",
  "gerry & the pacemakers", "florence + the machine",
]);

const isHan = (character: string | undefined) => !!character && /\p{Script=Han}/u.test(character);

function firstCreditSeparator(value: string): number {
  let first = Number.POSITIVE_INFINITY;
  const consider = (index: number) => {
    if (index > 0) first = Math.min(first, index);
  };

  const explicit = /[;；、，|／]/u.exec(value);
  if (explicit?.index !== undefined) consider(explicit.index);

  const feature = /\b(?:featuring|feat|ft)\.?(?=\s+\S|\(\s*\S)/iu.exec(value);
  if (feature?.index !== undefined) consider(feature.index);
  const withCredit = /\bwith(?=\s+\S)/iu.exec(value);
  if (withCredit?.index !== undefined) consider(withCredit.index);
  const xCredit = /\s+x\s+/iu.exec(value);
  if (xCredit?.index !== undefined) consider(xCredit.index);
  const strongMarkerIndex = Math.min(feature?.index ?? Number.POSITIVE_INFINITY,
    withCredit?.index ?? Number.POSITIVE_INFINITY, xCredit?.index ?? Number.POSITIVE_INFINITY);
  const strongLead = (Number.isFinite(strongMarkerIndex) ? value.slice(0, strongMarkerIndex) : value)
    .trim().replace(/^[\s(]+|[\s)]+$/gu, "").trim();
  const normalizedLead = strongLead.normalize("NFKC").replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  const protectNamedBand = protectedJoinerCredits.has(normalizedLead);
  const protectAmbiguousAmpersand = protectNamedBand || strongLead.includes(",");

  for (let index = value.indexOf("/"); index >= 0; index = value.indexOf("/", index + 1)) {
    const leftText = value.slice(0, index), rightText = value.slice(index + 1);
    const left = leftText.trimEnd(), right = rightText.trimStart();
    const padded = /\s$/u.test(leftText) && /^\s/u.test(rightText);
    const hanAdjacent = isHan(Array.from(left).at(-1)) || isHan(Array.from(right)[0]);
    const latinName = /^[\p{Script=Latin}\p{M}\p{N} .'-]+$/u;
    const compactUppercasePair = /^[\p{Lu}\p{M}\p{N}.-]{1,4}$/u.test(left) && /^[\p{Lu}\p{M}\p{N}.-]{1,4}$/u.test(right);
    const ordinaryLatinCollaboration = latinName.test(left) && latinName.test(right) && !compactUppercasePair &&
      (/\p{Ll}/u.test(left) || /\p{Ll}/u.test(right));
    if (padded || hanAdjacent || ordinaryLatinCollaboration) consider(index);
  }

  for (const separator of ["&", "+"] as const) {
    for (let index = value.indexOf(separator); index >= 0; index = value.indexOf(separator, index + 1)) {
      if (separator === "&" && protectAmbiguousAmpersand) continue;
      if (separator === "+" && protectNamedBand) continue;
      const leftText = value.slice(0, index), rightText = value.slice(index + 1);
      const left = leftText.trimEnd(), right = rightText.trimStart();
      const padded = /\s$/u.test(leftText) && /^\s/u.test(rightText);
      const hanAdjacent = isHan(Array.from(left).at(-1)) || isHan(Array.from(right)[0]);
      if (padded || hanAdjacent) consider(index);
    }
  }

  return first;
}

/** Choose a grouping/sorting artist without rewriting the original credit. */
export function leadMusicArtist(artist: string, artists?: readonly string[]): string {
  if (artists && artists.length > 1) return artists[0]?.trim() || artist.trim();
  // Many files store a joined collaboration in one ARTIST value. A singleton
  // native property still needs the conservative legacy-credit parser.
  const raw = (artists?.[0] || artist).trim();
  if (!raw) return "";
  const separator = firstCreditSeparator(raw);
  if (!Number.isFinite(separator)) return raw;
  let lead = raw.slice(0, separator).trim().replace(/\s*\($/u, "").trim();
  if (lead.startsWith("(") && !lead.includes(")")) lead = lead.slice(1).trim();
  return lead || raw;
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
