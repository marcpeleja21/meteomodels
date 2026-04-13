/**
 * Dynamic model weighting — assigns each model a relative accuracy weight
 * based on the user's geographic location.
 *
 * Philosophy
 * ──────────
 * Three components are summed to produce a raw score per model:
 *
 *   1. BASE ACCURACY  — global skill score from independent verification studies
 *                       (WMO comparisons, TIGGE archive, operational RMSE records)
 *   2. REGIONAL BONUS — extra points when the model specialises in the user's region
 *                       (e.g. AROME HD inside France, ICON D2 in Central Europe)
 *   3. RESOLUTION BONUS — finer grids capture local terrain effects better;
 *                          small bonus proportional to resolution class
 *
 * Only the model keys that are actually loaded (passed in) are scored and
 * returned.  Scores are then normalised so they sum to 1.0.
 *
 * Exported helpers
 * ────────────────
 *   computeModelWeights(keys, lat, lon, elevationM?) → Record<string, number>  (0–1, sums to 1)
 *   formatWeightsTip(weights, names)    → human-readable string for the ⓘ tooltip
 */

// ── Geographic region tests ───────────────────────────────────────────────────

/**
 * Météo-France AROME operational domain.
 * Covers France, Iberian Peninsula, Switzerland, northern Italy, Benelux,
 * parts of Germany, UK south coast, Morocco/Algeria border, and Atlantic margin.
 * Roughly: lat 35°N–56°N, lon -12°W–17°E
 */
function isFrance(lat: number, lon: number): boolean {
  return lat >= 35 && lat <= 56 && lon >= -12 && lon <= 17
}

/** Central Europe — where ICON D2 (DWD) and GeoSphere AROME operate */
function isCentralEurope(lat: number, lon: number): boolean {
  return lat >= 43.5 && lat <= 57.5 && lon >= -4 && lon <= 20
}

/** Broader Europe (matches the getActiveModels() definition) */
function isEurope(lat: number, lon: number): boolean {
  return lat >= 27 && lat <= 72 && lon >= -25 && lon <= 45
}

/** UK & Ireland */
function isUK(lat: number, lon: number): boolean {
  return lat >= 49.5 && lat <= 61.5 && lon >= -11 && lon <= 2
}

/** Nordic / North Sea region — HARMONIE DMI is most relevant here */
function isNordic(lat: number, lon: number): boolean {
  return lat >= 54 && lat <= 72 && lon >= -25 && lon <= 32
}

/** Canada & Alaska — GEM is the authoritative model */
function isCanada(lat: number, lon: number): boolean {
  return lat >= 42 && lat <= 84 && lon >= -141 && lon <= -52
}

/** USA & Caribbean — GFS is the home model */
function isUSA(lat: number, lon: number): boolean {
  return lat >= 15 && lat <= 72 && lon >= -170 && lon <= -52 && !isCanada(lat, lon)
}

// ── Score tables ──────────────────────────────────────────────────────────────

/**
 * Base accuracy scores (0–10) derived from multi-year global verification
 * (ECMWF Scorecard, WMO TIGGE archive, and independent NWP comparisons).
 */
const BASE_SCORE: Record<string, number> = {
  ecmwf:          9.0,   // consistently top-ranked global model (25 km IFS)
  gfs:            7.2,   // strong globally, weaker in complex terrain
  icon:           7.0,   // DWD global, good in mid-latitudes
  icon_eu:        8.0,   // 7 km EU domain — strong regional skill
  icon_d2:        8.5,   // 2.2 km — very high resolution in Central Europe
  arome_hd:       8.5,   // 1.5 km France — best resolution in domain
  arome:          8.0,   // 2.5 km France domain
  arpege:         7.5,   // European domain, medium resolution
  geosphere:      8.2,   // 2.5 km Alps / Central Europe
  knmi_harmonie:  8.0,   // 2.5 km full-Europe HARMONIE-AROME chain
  dmi_harmonie:   7.8,   // 2.5 km Europe — strong for North Sea / Scandinavia
  ukmo:           8.2,   // 10 km global, exceptional in mid-latitudes
  gem:            6.5,   // 15 km global; weaker verification outside Canada
  meteoblue:      7.0,   // NMM meso-scale — proprietary, reasonable skill
}

/**
 * Regional bonus added to the base score when the location falls inside the
 * model's area of expertise.  Returns 0 when outside the region.
 */
function regionalBonus(key: string, lat: number, lon: number): number {
  const eu  = isEurope(lat, lon)
  const ce  = isCentralEurope(lat, lon)
  const fr  = isFrance(lat, lon)
  const uk  = isUK(lat, lon)
  const no  = isNordic(lat, lon)
  const ca  = isCanada(lat, lon)
  const us  = isUSA(lat, lon)
  const global = !eu  // outside Europe → global models matter more

  switch (key) {
    // ── High-resolution LAMs ──
    case 'arome_hd':       return fr  ? 5.0 : 0          // 1.5 km — only covers France
    case 'arome':          return fr  ? 3.5 : 0          // 2.5 km France
    case 'icon_d2':        return ce  ? 3.0 : 0          // 2.2 km Central Europe
    case 'geosphere':      return ce  ? 2.5 : 0          // 2.5 km Alps
    case 'knmi_harmonie':  return eu  ? (ce ? 1.5 : no ? 1.5 : 1.0) : 0
    case 'dmi_harmonie':   return no  ? 2.5 : (eu ? 1.0 : 0)
    // ── Regional / continental ──
    case 'icon_eu':        return eu  ? 2.0 : 0          // 7 km Europe only
    case 'arpege':         return eu  ? 1.0 : 0
    case 'ukmo':           return uk  ? 3.0 : (eu ? 0.5 : 0.2)  // strong globally but best at home
    case 'gem':            return ca  ? 3.5 : 0
    // ── Global models — bonus outside their weaker regions ──
    case 'ecmwf':          return eu  ? 1.0 : 0.5        // marginal home-ground edge
    case 'gfs':            return us  ? 2.0 : (global ? 0.8 : 0)
    case 'icon':           return eu  ? 0.5 : (global ? 0.3 : 0)
    case 'meteoblue':      return eu  ? 0.3 : 0
    default:               return 0
  }
}

/** Small bonus for finer horizontal resolution (km → bonus) */
function resolutionBonus(key: string): number {
  const resKm: Record<string, number> = {
    arome_hd:       1.5,
    icon_d2:        2.2,
    arome:          2.5,
    geosphere:      2.5,
    knmi_harmonie:  2.5,
    dmi_harmonie:   2.5,
    icon_eu:        7.0,
    arpege:        10.0,
    ukmo:          10.0,
    ecmwf:         25.0,
    gfs:           25.0,
    icon:          13.0,
    gem:           15.0,
    meteoblue:      7.0,
  }
  const km = resKm[key] ?? 25
  // Logarithmic scale: 1.5 km → +1.0, 25 km → 0
  return Math.max(0, Math.log(25 / km) / Math.log(25 / 1.5))
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute normalised weights (0–1, sum = 1.0) for the given model keys
 * at the given location.
 *
 * @param keys       Model keys that are currently loaded (non-null in wxData)
 * @param lat        Location latitude
 * @param lon        Location longitude
 * @param elevationM Location elevation in metres (default 0). When > 600 m,
 *                   high-resolution models receive an additional terrain multiplier.
 */
export function computeModelWeights(
  keys: string[],
  lat:  number,
  lon:  number,
  elevationM: number = 0,
): Record<string, number> {
  if (!keys.length) return {}

  const raw: Record<string, number> = {}
  let total = 0

  for (const key of keys) {
    const base = BASE_SCORE[key] ?? 6.0
    const reg  = regionalBonus(key, lat, lon)
    let   res  = resolutionBonus(key)

    // High-elevation terrain multiplier: boost fine-grid models in mountain areas
    if (elevationM > 600 && res > 0) {
      const terrainMult = 1 + Math.min((elevationM - 600) / 1000, 1.5)
      res = res * terrainMult
    }

    const score = base + reg + res          // typically 6–13 range
    raw[key] = Math.max(score, 0.1)         // floor at 0.1 to avoid 0-weight
    total += raw[key]
  }

  const weights: Record<string, number> = {}
  for (const key of keys) {
    weights[key] = raw[key] / total
  }
  return weights
}

/**
 * Build a human-readable tooltip string showing the computed weights,
 * sorted descending.  Percentages are rounded to integers and may not
 * sum to exactly 100 due to rounding — acceptable for display.
 *
 * @param weights  Output of computeModelWeights()
 * @param names    Map from model key → display name  (e.g. 'ECMWF IFS')
 * @param header   Localised header line (e.g. "Weighted average:")
 */
export function formatWeightsTip(
  weights: Record<string, number>,
  names:   Record<string, string>,
  header:  string,
): string {
  const sorted = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .map(([key, w]) => `${names[key] ?? key} ${Math.round(w * 100)}%`)

  return `${header}\n` + sorted.join(' · ')
}
