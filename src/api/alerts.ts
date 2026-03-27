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

async function fetchEUAlerts(countryCode: string): Promise<WeatherAlert[]> {
  const slug = EU_COUNTRIES[countryCode]
  if (!slug) return []
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    // Use our server-side proxy to avoid CORS/network blocks
    const res = await fetch(`/api/alerts?cc=${countryCode}`, { signal: controller.signal })
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

      const event   = entry.querySelector('event')?.textContent ?? ''
      const title   = entry.querySelector('title')?.textContent ?? event
      const summary = (entry.querySelector('summary')?.textContent ?? '').slice(0, 400)
      const area    = entry.querySelector('areaDesc')?.textContent ?? ''

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
  lat: number, lon: number, countryCode: string
): Promise<WeatherAlert[]> {
  if (countryCode === 'US') return fetchUSAlerts(lat, lon)
  if (EU_COUNTRIES[countryCode])  return fetchEUAlerts(countryCode)
  return []
}
