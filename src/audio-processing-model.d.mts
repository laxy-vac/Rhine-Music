export type EqMode = "graphic" | "parametric";
export type EqEngine = "standard" | "lsp";
export type EqBand = {
  type: 0 | 1 | 2 | 3 | 4 | 5;
  channels: 0 | 1 | 2;
  frequency: number;
  q: number;
  gain: number;
  color: string;
  enabled: boolean;
  locked?: boolean;
};
export type LspEqBand = {
  filter: string;
  frequency: number;
  frequency2: number;
  q: number;
  gain: number;
  slope: number;
  channels: 0 | 1 | 2;
  enabled: boolean;
  solo: boolean;
  locked: boolean;
  color: string;
};
export type LspEqSettings = {
  algorithm: "iir" | "fir" | "fft" | "spm";
  fftRank: number;
  routing: "stereo" | "ms";
  preamp: number;
  output: number;
  pluginState: string;
  bands: LspEqBand[];
};
export type ToneFilterSettings = { frequency: number; q: number; gain: number };
export type ProcessingSettings = {
  float64: boolean;
  eq: { enabled: boolean; engine: EqEngine; mode: EqMode; name: string; preamp: number; bandwidth: number; bands: EqBand[]; lsp: LspEqSettings };
  tone: { enabled: boolean; bass: ToneFilterSettings; treble: ToneFilterSettings };
  replayGain: { mode: "off" | "gain" | "protect"; source: "album" | "track"; preamp: number; noTagPreamp: number };
  resampling: { mode: "follow" | "auto" | "fixed"; rate: number; engine: "r8brain" | "soxr" | "fast"; allowedRates: number[]; family: boolean; soxrQuality: "hq" | "vhq"; soxrPassband: number };
  outputFormat: "auto" | "s16" | "s24" | "s32" | "s32v24" | "f32";
  dither: "none" | "rectangular" | "triangular" | "highpass";
  bufferMs: number;
  reconfigureMs: number;
  bitPerfect: boolean;
  transition: { automatic: "gapless" | "crossfade" | "none"; manual: "none" | "short" | "crossfade"; crossfadeMs: number; manualMs: number; transportFade: boolean; transportMs: number; seekFade: boolean; seekMs: number; preloadMs: number; gapMs: number };
};
export type ImportedPowerampPreset = {
  eq: ProcessingSettings["eq"];
  tone?: Pick<ProcessingSettings["tone"], "bass" | "treble">;
};
export type RhineProcessingBackup = {
  schemaVersion: 1;
  name: string;
  settings: Omit<ProcessingSettings, "tone">;
  tone: ProcessingSettings["tone"];
  eqModes: Partial<Record<EqMode, ProcessingSettings["eq"]>>;
};
export declare const processingDefault: Readonly<ProcessingSettings>;
export declare function normalizeProcessing(value: unknown, options?: { clamp?: boolean }): ProcessingSettings;
export declare function effectivePcmProcessing(value: unknown): ProcessingSettings;
export declare function importPowerampPreset(text: string): ImportedPowerampPreset;
export declare function serializeRhineProcessingBackup(settings: ProcessingSettings, eqModes?: Partial<Record<EqMode, ProcessingSettings["eq"]>>): string;
export declare function importRhineProcessingBackup(text: string): RhineProcessingBackup;
export declare function processingBandQ(settings: ProcessingSettings, index: number, sampleRate?: number): number;
export declare function calcEqResponse(settings: ProcessingSettings, frequency: number, sampleRate?: number, channel?: 0 | 1): number;
export declare function calcEqResponseSamples(settings: ProcessingSettings, frequencies: number[], sampleRate?: number, channel?: 0 | 1): number[];
export declare function calcEqBandResponseSamples(settings: ProcessingSettings, index: number, frequencies: number[], sampleRate?: number, channel?: 0 | 1): number[];
