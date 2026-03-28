/**
 * Geocoding via Nominatim (OpenStreetMap).
 * Global coverage including small villages — far better than GeoNames for rural areas.
 *
 * Usage policy: must set User-Agent identifying the app.
 * Rate limit: 1 req/sec — satisfied by the 300 ms debounce in the search input.
 */
import type { GeocodingResult } from '../types'

const BASE    = 'https://nominatim.openstreetmap.org/search'
const HEADERS = {
  'User-Agent': 'MeteoModels/1.0 (meteomodels.vercel.app)',
}

// Classes to exclude from results (roads, rivers, buildings, etc.)
const SKIP_CLASS = new Set([
  'highway', 'railway', 'waterway', 'landuse',
  'building', 'shop', 'tourism', 'natural',
])

function mapResult(r: any): GeocodingResult | null {
  const lat = parseFloat(r.lat)
  const lon = parseFloat(r.lon)
  if (isNaN(lat) || isNaN(lon)) return null
  if (SKIP_CLASS.has(r.class))  return null

  const addr = r.address ?? {}

  // Most specific inhabited-place name in the address hierarchy
  const name: string =
    addr.city       ??
    addr.town       ??
    addr.village    ??
    addr.hamlet     ??
    addr.suburb     ??
    addr.municipality ??
    addr.county     ??   // last resort for some admin areas
    (r.display_name as string)?.split(',')[0]?.trim() ??
    r.name

  if (!name) return null

  const country_code = (addr.country_code ?? '').toUpperCase()

  // admin2 = province/department level (state_district in Spain → "Tarragona")
  // admin1 = region/autonomous-community level (state → "Catalunya")
  const admin2: string | undefined =
    addr.state_district ?? addr.province ?? addr.county_district ?? addr.county ?? undefined
  const admin1: string | undefined =
    addr.state ?? undefined

  return {
    id:           r.place_id ?? 0,
    name,
    latitude:     lat,
    longitude:    lon,
    country:      addr.country ?? '',
    admin1,
    admin2,
    timezone:     'auto',   // timezone field kept for interface compat; weather APIs use auto
    country_code,
  }
}

export async function searchLocations(
  query: string,
  lang: string,
  count = 8,
): Promise<GeocodingResult[]> {
  if (!query.trim()) return []

  const params = new URLSearchParams({
    q:              query.trim(),
    format:         'jsonv2',
    limit:          String(count + 4),   // fetch extra to cover filtered-out results
    addressdetails: '1',
    'accept-language': lang + ',en',     // preferred language then English fallback
  })

  try {
    const res = await fetch(`${BASE}?${params}`, { headers: HEADERS })
    if (!res.ok) return []
    const json = await res.json() as any[]

    return json
      .map(r => mapResult(r))
      .filter((r): r is GeocodingResult => r !== null)
      .slice(0, count)
  } catch {
    return []
  }
}
