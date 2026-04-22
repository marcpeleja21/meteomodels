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

  // admin3 = comarca / county / district — more specific than province.
  // Used for alert matching so province-level strings ("Barcelona") don't
  // match sub-provincial zones ("Prepirineo de Barcelona").
  // We want a level below admin2: if state_district/province consumed admin2,
  // try county / municipality. Never duplicate admin2 or name.
  const admin3Raw: string | undefined =
    addr.county     !== admin2 ? (addr.county     ?? undefined) :
    addr.district   !== admin2 ? (addr.district   ?? undefined) :
    addr.suburb     !== admin2 ? (addr.suburb      ?? undefined) :
    undefined
  const admin3 = admin3Raw !== name ? admin3Raw : undefined

  return {
    id:           r.place_id ?? 0,
    name,
    latitude:     lat,
    longitude:    lon,
    country:      addr.country ?? '',
    admin1,
    admin2,
    admin3,
    timezone:     'auto',   // timezone field kept for interface compat; weather APIs use use
    country_code,
  }
}

/**
 * Fetch elevation (metres) for a coordinate from the Open-Meteo elevation API.
 * Returns null on any failure — callers treat missing elevation gracefully.
 */
export async function fetchElevation(lat: number, lon: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,
    )
    if (!res.ok) return null
    const json = await res.json()
    const elev = json.elevation?.[0]
    return typeof elev === 'number' ? Math.round(elev) : null
  } catch {
    return null
  }
}

/**
 * Reverse-geocode a lat/lon coordinate via Nominatim.
 * Used for the "Use my location" geolocation feature.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  lang: string,
): Promise<GeocodingResult | null> {
  const params = new URLSearchParams({
    lat:            String(lat),
    lon:            String(lon),
    format:         'jsonv2',
    addressdetails: '1',
    zoom:           '10',  // city-level precision
    'accept-language': lang + ',en',
  })

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      { headers: HEADERS },
    )
    if (!res.ok) return null
    const json = await res.json()
    // Reverse endpoint may return a non-place class; try with a relaxed SKIP_CLASS check
    const addr = json.address ?? {}
    const name: string =
      addr.city       ??
      addr.town       ??
      addr.village    ??
      addr.hamlet     ??
      addr.suburb     ??
      addr.municipality ??
      addr.county     ??
      (json.display_name as string)?.split(',')[0]?.trim() ??
      json.name
    if (!name) return null
    const country_code = (addr.country_code ?? '').toUpperCase()
    const rev_admin2: string | undefined =
      addr.state_district ?? addr.province ?? addr.county_district ?? addr.county ?? undefined
    const rev_admin3Raw: string | undefined =
      addr.county     !== rev_admin2 ? (addr.county     ?? undefined) :
      addr.district   !== rev_admin2 ? (addr.district   ?? undefined) :
      addr.suburb     !== rev_admin2 ? (addr.suburb      ?? undefined) :
      undefined
    return {
      id:          json.place_id ?? 0,
      name,
      latitude:    lat,
      longitude:   lon,
      country:     addr.country ?? '',
      admin1:      addr.state ?? undefined,
      admin2:      rev_admin2,
      admin3:      rev_admin3Raw !== name ? rev_admin3Raw : undefined,
      timezone:    'auto',
      country_code,
    }
  } catch {
    return null
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
