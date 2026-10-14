const GAIN_LIMIT_DB = 120
const PEAK_LIMIT = 1_000_000

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return undefined
  const number = Number(text)
  return Number.isFinite(number) ? number : undefined
}

function decibelValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(?:dB)?$/i.exec(text)
  if (!match) return undefined
  const number = Number(match[1])
  return Number.isFinite(number) ? number : undefined
}

function boundedGain(value) {
  return value !== undefined && value >= -GAIN_LIMIT_DB && value <= GAIN_LIMIT_DB
    ? value
    : undefined
}

function gainDb(value) {
  if (value && typeof value === 'object') {
    const db = boundedGain(decibelValue(value.dB))
    if (db !== undefined) return db
    const ratio = numericValue(value.ratio)
    return ratio !== undefined && ratio > 0
      ? boundedGain(20 * Math.log10(ratio))
      : undefined
  }
  return boundedGain(decibelValue(value))
}

function peakRatio(value) {
  const ratio = value && typeof value === 'object'
    ? numericValue(value.ratio)
    : numericValue(value)
  return ratio !== undefined && ratio > 0 && ratio <= PEAK_LIMIT ? ratio : undefined
}

/** Normalize the common ReplayGain tags to dB gains and linear peak ratios. */
export function normalizeReplayGainTags(common = {}) {
  if (!common || typeof common !== 'object') return undefined
  const replayGain = {
    trackGainDb: gainDb(common.replaygain_track_gain),
    albumGainDb: gainDb(common.replaygain_album_gain),
    trackPeak: peakRatio(common.replaygain_track_peak),
    albumPeak: peakRatio(common.replaygain_album_peak),
  }
  const normalized = Object.fromEntries(
    Object.entries(replayGain).filter(([, value]) => value !== undefined),
  )
  return Object.keys(normalized).length ? normalized : undefined
}
