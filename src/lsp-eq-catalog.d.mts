export interface LspFilterCatalogEntry {
  /** Stable native-bridge filter ID, for example `rlc-bell-bt`. */
  readonly id: string;
  readonly label: string;
  readonly family: "RLC" | "BWC" | "LRX" | "APO";
  readonly shape: string;
  readonly design: "BT" | "MT" | "DR";
  readonly secondFrequency: boolean;
  readonly gain: boolean;
  readonly minQ: number;
  readonly quality: boolean;
  /** Largest slope the editor should offer for this design. */
  readonly maxSlope: number;
}

export const lspFilterCatalog: readonly LspFilterCatalogEntry[];
