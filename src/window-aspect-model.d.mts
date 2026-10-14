export type WindowAspectId = "16:9" | "16:10" | "4:3" | "3:2" | "21:9" | "free";

export interface WindowAspectPreset {
  readonly id: WindowAspectId;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export interface WindowAspectSize {
  readonly width: number;
  readonly height: number;
}

export declare const WINDOW_ASPECTS: readonly WindowAspectPreset[];
export declare function normalizeWindowAspect(value: unknown): WindowAspectId;
export declare function windowAspectRatio(value: unknown): number;
export declare function fitAspectSize(
  availableWidth: number,
  availableHeight: number,
  value: unknown,
): WindowAspectSize;
