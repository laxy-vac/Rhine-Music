/** Only these surface categories change MusicSelectionLighting's shader code. */
export function musicCaseLightVariant(surface: string): string {
  if (surface === "Album_Print") return "print";
  if (surface === "Frosted_Polymer") return "glass";
  if (surface === "Ivory_Edges") return "spine";
  return "shell";
}

export function musicCaseProgramKey(surface: string, mode: "array" | "selected", gold: boolean, reuse: boolean): string {
  return reuse ? `editable-case-${musicCaseLightVariant(surface)}-${mode}-v3-${gold}`
    : `editable-case-${surface}-${mode}-v2-${gold}`;
}
