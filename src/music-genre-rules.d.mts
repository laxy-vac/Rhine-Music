import type { GenreRules } from './music-types.js'

export declare function validateGenreRules(value: unknown): GenreRules

export declare function parseGenreRulesJson(source: string): GenreRules

export declare function renameGenreRule(rules: GenreRules, oldId: string, newId: string): GenreRules

export declare function removeGenreRule(rules: GenreRules, id: string, replacementId?: string): GenreRules

export declare function setAlbumGenreOverride(rules: GenreRules, albumId: string, genreIdOrUndefined: string | undefined): GenreRules
