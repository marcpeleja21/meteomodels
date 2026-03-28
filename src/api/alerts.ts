import type { GeocodingResult } from '../types'

export type AlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'

export interface WeatherAlert {
  id:          string
  event:       string
  headline:    string
  description: string
  severity:    AlertSeverity
  expires:     string | null
  source:      string
  areas:       string
}

// ── NWS — United States ───────────────────────────────────────────────────────
async function fetchUSAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  try {
    const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`
    const res  = await fetch(url, { headers: { 'User-Agent': 'MeteoModels/1.0' } })
    if (!res.ok) return []
    const json = await res.json()
    return (json.features ?? []).map((f: Record<string, any>): WeatherAlert => {
      const p = f.properties
      return {
        id:          f.id ?? '',
        event:       p.event ?? '',
        headline:    p.headline ?? p.event ?? '',
        description: (p.description ?? '').slice(0, 400),
        severity:    (p.severity ?? 'Unknown') as AlertSeverity,
        expires:     p.expires ?? null,
        source:      'NWS',
        areas:       p.areaDesc ?? '',
      }
    })
  } catch {
    return []
  }
}

// ── Location-based filter helpers ─────────────────────────────────────────────

/**
 * Normalise a region string for fuzzy matching:
 * lowercase → strip accents → remove "Province/Region/Community of" prefixes.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/\b(province|region|comarca|autonomous|community|comunitat|comunidad|departement|department|district|county)\b[^a-z]*/gi, '')
    .replace(/\bof\b|\bde\b|\bdel\b|\bde la\b|\bdes\b|\bdu\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Escape a string for use inside a RegExp */
function reEsc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Returns true if the alert's areaDesc is relevant to the selected location.
 *
 * Uses **word-boundary** regex so that e.g. admin1="Aragon" does NOT match
 * zone names like "Pirineo aragonés" (normalises to "aragones") — the old
 * `.includes()` approach caused false positives for adjective-form zone names.
 *
 * Candidates: city name + admin2 (province) only.
 * admin1 (autonomous community) is intentionally excluded — MeteoAlarm zone
 * names use adjective forms of the region ("aragonés", "catalán") that would
 * incorrectly match any location in that region regardless of the specific zone.
 */
function alertMatchesLocation(area: string, loc: GeocodingResult): boolean {
  const normArea = normalise(area)
  if (!normArea) return false

  // Only match on city name and province (admin2) — region/country too broad
  const candidates: string[] = [
    loc.name,
    loc.admin2,
  ].filter(Boolean) as string[]

  return candidates.some(c => {
    const norm = normalise(c)
    if (norm.length < 3) return false
    // Word-boundary match: "aragon" must NOT match inside "aragones"
    if (new RegExp(`\\b${reEsc(norm)}\\b`).test(normArea)) return true
    // Prefix match (≥5 chars) for cross-language variants: "catalo" ↔ Catalonia/Catalunya
    const prefix = norm.slice(0, 6)
    if (prefix.length >= 5 && new RegExp(`\\b${reEsc(prefix)}`).test(normArea)) return true
    return false
  })
}

// ── Meteoalarm — Europe ───────────────────────────────────────────────────────
const EU_COUNTRIES: Record<string, string> = {
  ES: 'spain',    FR: 'france',       DE: 'germany',       IT: 'italy',
  PT: 'portugal', AT: 'austria',      BE: 'belgium',       GB: 'united-kingdom',
  CH: 'switzerland', NL: 'netherlands', PL: 'poland',      SE: 'sweden',
  NO: 'norway',   DK: 'denmark',      FI: 'finland',       CZ: 'czech-republic',
  SK: 'slovakia', HU: 'hungary',      RO: 'romania',       HR: 'croatia',
  SI: 'slovenia', BG: 'bulgaria',     GR: 'greece',        CY: 'cyprus',
  LU: 'luxembourg', LT: 'lithuania',  LV: 'latvia',        EE: 'estonia',
  IE: 'ireland',  MT: 'malta',        RS: 'serbia',        BA: 'bosnia-and-herzegovina',
  ME: 'montenegro', MK: 'north-macedonia', AL: 'albania',  XK: 'kosovo',
  MD: 'moldova',  UA: 'ukraine',      IS: 'iceland',
}

async function fetchEUAlerts(loc: GeocodingResult): Promise<WeatherAlert[]> {
  const slug = EU_COUNTRIES[loc.country_code]
  if (!slug) return []
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    // Server-side proxy avoids CORS/network blocks
    const res = await fetch(`/api/alerts?cc=${loc.country_code}`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return []

    const xml = await res.text()
    const doc  = new DOMParser().parseFromString(xml, 'application/xml')
    const now  = new Date()

    return Array.from(doc.querySelectorAll('entry')).flatMap((entry): WeatherAlert[] => {
      // Skip expired alerts
      const expiresStr = entry.querySelector('expires')?.textContent ?? null
      if (expiresStr && new Date(expiresStr) < now) return []

      const severity = (
        entry.querySelector('severity')?.textContent ?? 'Unknown'
      ) as AlertSeverity

      // Only show Moderate and above
      if (severity === 'Minor' || severity === 'Unknown') return []

      const area = entry.querySelector('areaDesc')?.textContent ?? ''

      // ── Location filter: skip alerts not relevant to the selected city ──
      if (!alertMatchesLocation(area, loc)) return []

      const event   = entry.querySelector('event')?.textContent ?? ''
      const title   = entry.querySelector('title')?.textContent ?? event
      const summary = (entry.querySelector('summary')?.textContent ?? '').slice(0, 400)

      return [{
        id:          entry.querySelector('id')?.textContent ?? crypto.randomUUID(),
        event,
        headline:    title,
        description: summary,
        severity,
        expires:     expiresStr,
        source:      'Meteoalarm',
        areas:       area,
      }]
    })
  } catch {
    return []
  }
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function fetchAlerts(
  lat: number, lon: number, countryCode: string, loc?: GeocodingResult
): Promise<WeatherAlert[]> {
  if (countryCode === 'US') return fetchUSAlerts(lat, lon)
  if (EU_COUNTRIES[countryCode] && loc) return fetchEUAlerts(loc)
  return []
}
