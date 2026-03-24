import type { GeocodingResult } from '../types'

const BASE = 'https://geocoding-api.open-meteo.com/v1/search'

export async function searchLocations(
  query: string,
  lang: string,
  count = 8
): Promise<GeocodingResult[]> {
  if (!query.trim()) return []
  const url = `${BASE}?name=${encodeURIComponent(query)}&count=${count}&language=${lang}&format=json`
  const res = await fetch(url)
  if (!res.ok) return []
  const json = await res.json()
  return (json.results as GeocodingResult[]) ?? []
}
