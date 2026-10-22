import type { MusicAlbum, MusicLibrary } from "./music-types";

export interface AlbumInfoSource {
  id: string;
  name: string;
  builtin: boolean;
  enabled: boolean;
  searchUrl?: string;
  detailUrl?: string;
  mapping?: Record<string, string>;
}
export interface AlbumInfoSources { sources: AlbumInfoSource[]; defaultSourceId: string; musicBrainzAvailable?: boolean; }
export interface AlbumInfoCandidate {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  artist: string;
  year?: number;
  description?: string;
  coverUrl?: string;
  url?: string;
  license?: string;
}
export interface AlbumInfoSearch {
  candidates: AlbumInfoCandidate[];
  sources: Array<{ sourceId: string; name: string; status: "ok" | "empty" | "error"; message?: string; count?: number }>;
}
export type EditorCover = { mode: "keep" | "inherit" | "upload" | "candidate"; dataUrl?: string; candidateId?: string };
export interface AlbumInfoDocument { album: MusicAlbum; revision: string; customCover: boolean; }
export interface AlbumInfoSave {
  albumId: string;
  revision: string;
  description: string;
  sourceCandidateId?: string;
  cover: EditorCover;
}
export interface TrackInfoDocument {
  trackId: string;
  albumId: string;
  revision: string;
  fields: Record<string, string[]>;
  artwork: { mode: "inherit" | "embedded" | "sidecar"; url?: string; canEmbed: boolean };
  file: { name: string; relativePath: string; format: string; size: number; modifiedAt: string; duration: number; sampleRate?: number; bitsPerSample?: number; bitrate?: number; numberOfChannels?: number };
  writable: boolean;
  readOnlyReason?: string;
}
export interface TrackInfoSave { trackId: string; revision: string; fields: Record<string, string[]>; cover: EditorCover; }
export interface MetadataEditorCallbacks {
  request<T>(url: string, init?: RequestInit): Promise<T>;
  onLibrary(library: MusicLibrary): void | Promise<void>;
  notify(message: string): void;
  getAlbum(id: string): MusicAlbum | undefined;
}
