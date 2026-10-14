/**
 * Filter designs implemented by the vendored LSP DSP Units Equalizer.
 * IDs are stable application values; the native adapter maps them to upstream
 * lsp::dspu::filter_type_t values.
 */
const shapes = {
  rlc: [
    ["lowpass", "Low-pass", false, false],
    ["highpass", "High-pass", false, false],
    ["lowshelf", "Low shelf", false, true],
    ["highshelf", "High shelf", false, true],
    ["bell", "Bell", false, true],
    ["resonance", "Resonance", false, true],
    ["notch", "Notch", false, false],
    ["allpass", "All-pass", false, true],
    ["allpass2", "Dual-frequency all-pass", true, true],
    ["ladderpass", "Ladder-pass", true, true],
    ["ladderrej", "Ladder-rejection", true, true],
    ["bandpass", "Band-pass", true, true],
  ],
  bwc: [
    ["lowpass", "Low-pass", false, false],
    ["highpass", "High-pass", false, false],
    ["lowshelf", "Low shelf", false, true],
    ["highshelf", "High shelf", false, true],
    ["bell", "Bell", false, true],
    ["ladderpass", "Ladder-pass", true, true],
    ["ladderrej", "Ladder-rejection", true, true],
    ["bandpass", "Band-pass", true, true],
    ["allpass", "All-pass", false, true],
  ],
  lrx: [
    ["lowpass", "Low-pass", false, false],
    ["highpass", "High-pass", false, false],
    ["lowshelf", "Low shelf", false, true],
    ["highshelf", "High shelf", false, true],
    ["bell", "Bell", false, true],
    ["ladderpass", "Ladder-pass", true, true],
    ["ladderrej", "Ladder-rejection", true, true],
    ["bandpass", "Band-pass", true, true],
    ["allpass", "All-pass", false, true],
  ],
  apo: [
    ["lowpass", "Low-pass", false, false],
    ["highpass", "High-pass", false, false],
    // The APO band-pass uses the digital biquad's Q and ignores fFreq2.
    ["bandpass", "Band-pass", false, true],
    ["notch", "Notch", false, false],
    ["allpass", "All-pass", false, false],
    ["allpass2", "Dual-frequency all-pass", true, false],
    ["peaking", "Peaking", false, true],
    ["lowshelf", "Low shelf", false, true],
    ["highshelf", "High shelf", false, true],
    ["ladderpass", "Ladder-pass", true, true],
    ["ladderrej", "Ladder-rejection", true, true],
  ],
};

function makeFilterCatalog() {
  const entries = [];
  for (const family of ["rlc", "bwc", "lrx"]) {
    const familyLabel = family.toUpperCase();
    for (const design of ["bt", "mt"]) {
      for (const [shape, shapeLabel, secondFrequency, gain] of shapes[family]) {
        entries.push({
          id: `${family}-${shape}-${design}`,
          label: `${familyLabel} · ${shapeLabel} · ${design.toUpperCase()}`,
          family: familyLabel,
          shape,
          design: design.toUpperCase(),
          secondFrequency,
          gain,
          minQ: 0,
          quality: !(family === "rlc" && shape === "allpass2"),
          maxSlope: 16,
        });
      }
    }
  }

  for (const [shape, shapeLabel, secondFrequency, gain] of shapes.apo) {
    entries.push({
      id: `apo-${shape}-dr`,
      label: `APO · ${shapeLabel} · DR`,
      family: "APO",
      shape,
      design: "DR",
      secondFrequency,
      gain,
      minQ: 0.1,
      quality: true,
      maxSlope: 1,
    });
  }

  return entries.map((entry) => Object.freeze(entry));
}

export const lspFilterCatalog = Object.freeze(makeFilterCatalog());
