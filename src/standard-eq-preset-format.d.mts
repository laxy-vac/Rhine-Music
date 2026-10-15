import type { EqBand, EqMode, ProcessingSettings } from "./audio-processing-model.mjs";

export type StandardEqPresetImport = {
  format: "poweramp" | "rhine-standard";
  eq: ProcessingSettings["eq"];
  tone?: Pick<ProcessingSettings["tone"], "bass" | "treble"> | ProcessingSettings["tone"];
};

export type StandardEqPresetFile = {
  format: "rhine-standard-eq-preset";
  schemaVersion: 1;
  eq: {
    enabled: boolean;
    mode: EqMode;
    preamp: number;
    bandwidth: number;
    bands: EqBand[];
  };
  tone: ProcessingSettings["tone"];
};

export declare function parseStandardEqPresetFile(sourceText: string, fileName?: string): StandardEqPresetImport;
export declare function serializeStandardEqPresetFile(settings: ProcessingSettings): string;
