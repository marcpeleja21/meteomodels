/**
 * Shared colour-scale utilities — single source of truth for all
 * weather value colouring across the app.
 */

// ── Core interpolation ────────────────────────────────────────────────────────

function lerpHex(a: string, b: string, t: number): string {
  t = Math.max(0, Math.min(1, t))
  const ai = parseInt(a.slice(1), 16), bi = parseInt(b.slice(1), 16)
  const r  = Math.round(((ai >> 16) & 0xff) + (((bi >> 16) & 0xff) - ((ai >> 16) & 0xff)) * t)
  const g  = Math.round(((ai >>  8) & 0xff) + (((bi >>  8) & 0xff) - ((ai >>  8) & 0xff)) * t)
  const bl = Math.round(( ai        & 0xff) + (( bi        & 0xff) - ( ai        & 0xff)) * t)
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bl.toString(16).padStart(2,'0')}`
}

function colorScale(stops: [number, string][], v: number): string {
  if (v <= stops[0][0])                    return stops[0][1]
  if (v >= stops[stops.length - 1][0])     return stops[stops.length - 1][1]
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i]
    const [v1, c1] = stops[i + 1]
    if (v <= v1) return lerpHex(c0, c1, (v - v0) / (v1 - v0))
  }
  return stops[stops.length - 1][1]
}

// ── Temperature ───────────────────────────────────────────────────────────────
// cold blue → neutral grey → warm amber → hot red

const TEMP_MAX_STOPS: [number, string][] = [
  [ -5, '#1565c0'],  // cold blue
  [ 12, '#546e7a'],  // neutral blue-grey
  [ 22, '#e65100'],  // warm orange
  [ 35, '#c62828'],  // hot red
]

const TEMP_MIN_STOPS: [number, string][] = [
  [-10, '#1565c0'],  // cold blue
  [  2, '#00695c'],  // cool teal
  [ 14, '#546e7a'],  // neutral blue-grey
  [ 26, '#e65100'],  // warm orange
]

export function tempMaxColor(v: number | null): string {
  return v === null ? '#546e7a' : colorScale(TEMP_MAX_STOPS, v)
}
export function tempMinColor(v: number | null): string {
  return v === null ? '#546e7a' : colorScale(TEMP_MIN_STOPS, v)
}
/** Single temperature value (current/hourly) — uses the max scale */
export function tempColor(v: number | null): string {
  return tempMaxColor(v)
}

// ── Precipitation probability (%) ─────────────────────────────────────────────
// 0–19 % grey, then blue deepens with probability

export function rainPctColor(pct: number | null): string {
  if (pct === null || pct < 20) return '#78909c'
  return colorScale([
    [20, '#2563eb'],  // blue
    [50, '#1d4ed8'],  // deeper blue
    [80, '#1e3a8a'],  // deep navy
  ], pct)
}

// ── Precipitation amount (mm) ─────────────────────────────────────────────────

export function precipColor(mm: number | null): string {
  if (mm === null || mm === 0) return '#78909c'
  return colorScale([
    [0.1,  '#3b82f6'],  // blue
    [  2,  '#2563eb'],  // deeper blue
    [  8,  '#1d4ed8'],  // deep blue
    [ 20,  '#1e3a8a'],  // navy
  ], mm)
}

// ── Wind speed (km/h) ─────────────────────────────────────────────────────────

export function windColor(v: number | null): string {
  if (v === null || v < 20) return '#78909c'
  return colorScale([
    [20, '#2e7d32'],  // dark green
    [40, '#b45309'],  // amber
    [60, '#c2410c'],  // dark orange
    [80, '#991b1b'],  // dark red
  ], v)
}

// ── Relative humidity (%) ─────────────────────────────────────────────────────

export function humidityColor(v: number | null): string {
  if (v === null) return '#78909c'
  return colorScale([
    [ 0,  '#78909c'],  // dry
    [30,  '#546e7a'],  // low
    [60,  '#2563eb'],  // moderate
    [80,  '#1d4ed8'],  // high
    [100, '#1e3a8a'],  // very high
  ], v)
}
