import { defaultCaseSettings, type CaseProfiles } from "./case-settings";
import { MUSIC_SHELF_VIEW } from "./music-display-layout";
import type { MusicAlbum, MusicGenre, MusicTrack } from "./music-types";
import { defaultMusicViewSettings, type MusicViewSettings } from "./music-view-settings";
import type { MusicStyle } from "./music-style";

/** One finite visual demo column matches the shared shelf slot contract. */
export const DEMO_SHELF_COLUMNS = 4;
export const DEMO_SLOTS_PER_COLUMN = MUSIC_SHELF_VIEW.slots;

export const demoGenres: MusicGenre[] = [
  { id: "ambient", name: "氛围音乐", albumCount: 20 },
  { id: "instrumental", name: "器乐", albumCount: 20 },
  { id: "electronic", name: "电子", albumCount: 20 },
  { id: "indie", name: "独立流行", albumCount: 20 },
];

const DEMO_ALBUM_COUNT = DEMO_SHELF_COLUMNS * DEMO_SLOTS_PER_COLUMN;
const DEMO_COVERS = [
  "/demo-covers/square.png",
  "/demo-covers/portrait.png",
  "/demo-covers/landscape.png",
] as const;
const DEMO_ARTISTS = [
  "Aster Audio",
  "Boreal Ensemble",
  "Cinder Studio",
  "Delta Tapes",
] as const;
const DEMO_DECADES = [1990, 2000, 2010, 2020] as const;
const DEMO_TITLES = [
  "日光留声",
  "夜间航线",
  "远山来信",
  "雨后电台",
  "城市回声",
  "海岸信号",
  "午夜蓝图",
  "森林磁带",
  "银色公路",
  "星群之间",
  "旧梦航标",
  "微风侧写",
] as const;

function createDemoTrack(albumId: string, index: number, artist: string, coverUrl: string): MusicTrack {
  const number = String(index + 1).padStart(2, "0");
  return {
    id: `demo-track-${number}`,
    albumId,
    title: `视觉演示曲目 ${number}（无音频）`,
    artist,
    artists: [artist],
    coverUrl,
    trackNumber: 1,
    duration: 0,
    format: "DEMO",
    browserPlayable: false,
    audioUrl: "",
    relativePath: "",
  };
}

/** Visual samples only. Never inserted into the user's actual music index. */
export const demoAlbums: MusicAlbum[] = Array.from({ length: DEMO_ALBUM_COUNT }, (_, index) => {
  const decadeIndex = Math.floor(index / DEMO_SLOTS_PER_COLUMN);
  const genre = demoGenres[index % demoGenres.length]!;
  const artist = DEMO_ARTISTS[Math.floor(index / demoGenres.length) % DEMO_ARTISTS.length]!;
  const year = DEMO_DECADES[decadeIndex]! + ((index % DEMO_SLOTS_PER_COLUMN) % 10);
  const number = String(index + 1).padStart(2, "0");
  const id = `demo-album-${number}`;
  const coverUrl = DEMO_COVERS[index % DEMO_COVERS.length]!;

  return {
    id,
    title: `视觉演示专辑 ${number} · ${DEMO_TITLES[index % DEMO_TITLES.length]!}`,
    artist,
    artists: [artist],
    genreId: genre.id,
    year,
    coverUrl,
    rawGenres: [genre.name],
    folder: `RHINE 视觉演示目录/专辑 ${number}`,
    description: "RHINE 界面视觉演示专辑，仅含无音频占位曲目。",
    tracks: [createDemoTrack(id, index, artist, coverUrl)],
    producers: [],
    offline: false,
  };
});

export function createDemoCaseProfiles(saved?: CaseProfiles): CaseProfiles {
  const rhine = saved ? structuredClone(saved.rhine) : defaultCaseSettings("rhine");
  rhine.structure = "rhine";

  const archive = saved ? structuredClone(saved.archive) : defaultCaseSettings("archive");
  archive.structure = "punk";

  return { rhine, archive };
}

export function demoViewForDesign(design: MusicStyle["design"]): MusicViewSettings {
  return {
    ...defaultMusicViewSettings,
    layout: design === "archive" ? "shelf" : "array",
  };
}
