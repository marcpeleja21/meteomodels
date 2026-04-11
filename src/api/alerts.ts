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
  /** Language-independent category: wind|storm|rain|flood|snow|ice|fog|heat|cold|fire|coastal|avalanche|dust|other */
  category:    string
}

/** Derive a stable, language-independent category from a raw English event string. */
export function categorizeEvent(event: string): string {
  const l = event.toLowerCase()
  if (l.includes('thunderstorm') || l.includes('lightning'))                         return 'storm'
  if (l.includes('flood'))                                                            return 'flood'
  if (l.includes('wind') || l.includes('gale') || l.includes('squall'))             return 'wind'
  if (l.includes('rain') || l.includes('shower') || l.includes('precipitation'))    return 'rain'
  if (l.includes('blizzard') || l.includes('snow'))                                  return 'snow'
  if (l.includes('ice') || l.includes('frost') || l.includes('freezing'))           return 'ice'
  if (l.includes('fog')  || l.includes('mist'))                                      return 'fog'
  if (l.includes('heat') || l.includes('high temperature'))                          return 'heat'
  if (l.includes('cold') || l.includes('low temperature') || l.includes('freeze'))  return 'cold'
  if (l.includes('fire') || l.includes('wildfire') || l.includes('forest'))         return 'fire'
  if (l.includes('avalanche'))                                                        return 'avalanche'
  if (l.includes('coast') || l.includes('marine'))                                   return 'coastal'
  if (l.includes('dust') || l.includes('sand'))                                      return 'dust'
  return 'other'
}

// ── MeteoAlarm cap:event translation ─────────────────────────────────────────

/** Map lowercase keywords found in cap:event → translated label per language */
const EVENT_KEYWORDS: Array<{ match: string[]; ca: string; es: string; en: string; fr: string }> = [
  { match: ['wind'],            ca: 'Vent',              es: 'Viento',             en: 'Wind',             fr: 'Vent' },
  { match: ['thunderstorm'],    ca: 'Tempesta',          es: 'Tormenta',           en: 'Thunderstorm',     fr: 'Orage' },
  { match: ['snow', 'ice'],     ca: 'Neu/Gel',           es: 'Nieve/Hielo',        en: 'Snow/Ice',         fr: 'Neige/Verglas' },
  { match: ['snow'],            ca: 'Neu',               es: 'Nieve',              en: 'Snow',             fr: 'Neige' },
  { match: ['ice'],             ca: 'Gel',               es: 'Hielo',              en: 'Ice',              fr: 'Verglas' },
  { match: ['fog'],             ca: 'Boira',             es: 'Niebla',             en: 'Fog',              fr: 'Brouillard' },
  { match: ['rain', 'flood'],   ca: 'Pluges/Inundació',  es: 'Lluvia/Inundación',  en: 'Rain/Flood',       fr: 'Pluie/Inondation' },
  { match: ['rain'],            ca: 'Pluges',            es: 'Lluvia',             en: 'Rain',             fr: 'Pluie' },
  { match: ['flood'],           ca: 'Inundació',         es: 'Inundación',         en: 'Flood',            fr: 'Inondation' },
  { match: ['coastalevent', 'coastal'], ca: 'Temporal costaner', es: 'Temporal costero', en: 'Coastal event', fr: 'Événement côtier' },
  { match: ['hightemperature', 'high temperature', 'heat'], ca: 'Calor extrem', es: 'Calor extremo', en: 'High temperature', fr: 'Températures élevées' },
  { match: ['lowtemperature',  'low temperature', 'cold'],  ca: 'Fred extrem',   es: 'Frío extremo',   en: 'Low temperature',  fr: 'Températures baixes' },
  { match: ['forestfire', 'forest fire'],                   ca: 'Incendi forestal', es: 'Incendio forestal', en: 'Forest fire', fr: 'Feux de forêt' },
  { match: ['avalanche'],       ca: 'Allau',             es: 'Alud',               en: 'Avalanche',        fr: 'Avalanche' },
  { match: ['dust'],            ca: 'Pols',              es: 'Polvo',              en: 'Dust',             fr: 'Poussière' },
]

const SEVERITY_LABEL: Record<string, Record<string, string>> = {
  extreme:  { ca: 'Extrem',   es: 'Extremo',   en: 'Extreme',  fr: 'Extrême'  },
  severe:   { ca: 'Sever',    es: 'Severo',     en: 'Severe',   fr: 'Sévère'   },
  moderate: { ca: 'Moderat',  es: 'Moderado',   en: 'Moderate', fr: 'Modéré'   },
  minor:    { ca: 'Menor',    es: 'Menor',      en: 'Minor',    fr: 'Mineur'   },
}

/**
 * Translate a MeteoAlarm cap:event string (always English in the feed, e.g.
 * "Severe wind warning") into the app language.
 */
function translateEvent(event: string, lang: string): string {
  const lower = event.toLowerCase()

  // Find event type translation
  let typeTr: string | null = null
  for (const entry of EVENT_KEYWORDS) {
    // All keywords in the match array must appear in the event string
    if (entry.match.every(k => lower.includes(k))) {
      typeTr = (entry as unknown as Record<string, string>)[lang] ?? entry.en
      break
    }
  }
  if (!typeTr) return event   // unknown type — return raw string

  // Find severity prefix
  const sevKey = Object.keys(SEVERITY_LABEL).find(k => lower.includes(k))
  if (sevKey) {
    const sevTr = SEVERITY_LABEL[sevKey][lang] ?? SEVERITY_LABEL[sevKey]['en']
    return `${typeTr} (${sevTr})`
  }
  return typeTr
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
        category:    categorizeEvent(p.event ?? ''),
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

async function fetchEUAlerts(
  lat: number, lon: number, loc: GeocodingResult, lang: string,
): Promise<WeatherAlert[]> {
  const slug = EU_COUNTRIES[loc.country_code]
  if (!slug) return []
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    // Pass lat/lon so the server can resolve EMMA zone IDs for this point
    const res = await fetch(
      `/api/alerts?cc=${loc.country_code}&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`,
      { signal: controller.signal },
    )
    clearTimeout(timer)
    if (!res.ok) return []

    // EMMA IDs for this point (from server-side zone lookup), if available
    const emmaHeader = res.headers.get('X-Emma-Ids')
    const allowedEmmaIds: Set<string> | null = emmaHeader
      ? new Set(emmaHeader.split(',').map(s => s.trim()).filter(Boolean))
      : null

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

      // ── Location filter ────────────────────────────────────────────────────
      if (allowedEmmaIds) {
        // Server resolved EMMA zone IDs → use precise geographic filter
        const geocodeEls = Array.from(entry.querySelectorAll('geocode'))
        let entryEmmaId: string | null = null
        for (const gc of geocodeEls) {
          if (gc.querySelector('valueName')?.textContent === 'EMMA_ID') {
            entryEmmaId = gc.querySelector('value')?.textContent ?? null
            break
          }
        }
        // Reject alert if its zone is not in the allowed set
        if (!entryEmmaId || !allowedEmmaIds.has(entryEmmaId)) return []
      } else {
        // Fallback: text-based matching against city name and province
        if (!alertMatchesLocation(area, loc)) return []
      }

      const rawEvent = entry.querySelector('event')?.textContent ?? ''
      const event    = translateEvent(rawEvent, lang)
      const title    = entry.querySelector('title')?.textContent ?? rawEvent
      const summary  = (entry.querySelector('summary')?.textContent ?? '').slice(0, 400)

      return [{
        id:          entry.querySelector('id')?.textContent ?? crypto.randomUUID(),
        event,
        headline:    title,
        description: summary,
        severity,
        expires:     expiresStr,
        source:      'Meteoalarm',
        areas:       area,
        category:    categorizeEvent(rawEvent),
      }]
    })
  } catch {
    return []
  }
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function fetchAlerts(
  lat: number, lon: number, countryCode: string, loc?: GeocodingResult, lang = 'en',
): Promise<WeatherAlert[]> {
  if (countryCode === 'US') return fetchUSAlerts(lat, lon)
  if (EU_COUNTRIES[countryCode] && loc) return fetchEUAlerts(lat, lon, loc, lang)
  return []
}
