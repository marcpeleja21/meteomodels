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
// < -5° purple → 0° icy blue → 5° cool blue → 12° green → 20° yellow → 30° orange → 40° red

const TEMP_MAX_STOPS: [number, string][] = [
  [ -5, '#b39ddb'],  // purple
  [  0, '#89c4f4'],  // icy blue
  [  5, '#64b5f6'],  // cool blue
  [ 12, '#81c784'],  // green
  [ 20, '#ffd54f'],  // yellow
  [ 30, '#ff8a65'],  // orange
  [ 40, '#f44336'],  // red
]

// Min temp uses the same scale but values tend to run ~8–12° cooler
const TEMP_MIN_STOPS: [number, string][] = [
  [-12, '#b39ddb'],  // purple
  [ -5, '#89c4f4'],  // icy blue
  [  0, '#64b5f6'],  // cool blue
  [  8, '#81c784'],  // green
  [ 15, '#ffd54f'],  // yellow
  [ 23, '#ff8a65'],  // orange
  [ 30, '#f44336'],  // red
]

export function tempMaxColor(v: number | null): string {
  return v === null ? '#666' : colorScale(TEMP_MAX_STOPS, v)
}
export function tempMinColor(v: number | null): string {
  return v === null ? '#666' : colorScale(TEMP_MIN_STOPS, v)
}
/** Single temperature value (current/hourly) — uses the max scale */
export function tempColor(v: number | null): string {
  return tempMaxColor(v)
}

// ── Precipitation probability (%) ─────────────────────────────────────────────
// 0–19 % grey, then blue deepens with probability

export function rainPctColor(pct: number | null): string {
  if (pct === null || pct < 20) return '#666'
  return colorScale([
    [20, '#64b5f6'],  // light blue
    [50, '#2196f3'],  // blue
    [80, '#1565c0'],  // deep blue
  ], pct)
}

// ── Precipitation amount (mm) ─────────────────────────────────────────────────
// 0 mm grey; cyan → teal for visibility on dark backgrounds

export function precipColor(mm: number | null): string {
  if (mm === null || mm === 0) return '#666'
  return colorScale([
    [0.1,  '#80deea'],  // light cyan
    [  2,  '#26c6da'],  // cyan
    [  8,  '#00bcd4'],  // medium cyan-teal
    [ 20,  '#00838f'],  // deep teal
  ], mm)
}

// ── Wind speed (km/h) ─────────────────────────────────────────────────────────
// < 20 calm grey → green → yellow → orange → red

export function windColor(v: number | null): string {
  if (v === null || v < 20) return '#666'
  return colorScale([
    [20, '#aed581'],  // light green
    [40, '#ffd54f'],  // yellow
    [60, '#ff9800'],  // orange
    [80, '#f44336'],  // red
  ], v)
}

// ── Relative humidity (%) ─────────────────────────────────────────────────────
// low → grey, rising → blue (high humidity)

export function humidityColor(v: number | null): string {
  if (v === null) return '#666'
  return colorScale([
    [ 0,  '#666'],     // dry — muted
    [30,  '#90a4ae'],  // low humidity
    [60,  '#64b5f6'],  // moderate
    [80,  '#2196f3'],  // high
    [100, '#1565c0'],  // very high
  ], v)
}
