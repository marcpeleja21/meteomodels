import type { BeachResult, SkiResortResult } from '../types'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

/** Haversine distance in km between two lat/lon points */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Run an Overpass QL query and return raw JSON */
async function overpassQuery(query: string): Promise<any> {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
  return res.json()
}

/**
 * Find beaches within radiusKm of (lat, lon).
 * Returns up to 30 results sorted by distance.
 */
export async function fetchNearbyBeaches(
  lat: number,
  lon: number,
  radiusKm = 50,
): Promise<BeachResult[]> {
  const radius = radiusKm * 1000
  const query = `
[out:json][timeout:25];
(
  node["natural"="beach"](around:${radius},${lat},${lon});
  way["natural"="beach"](around:${radius},${lat},${lon});
  relation["natural"="beach"](around:${radius},${lat},${lon});
);
out center tags;`

  try {
    const data = await overpassQuery(query)
    const results: BeachResult[] = (data.elements ?? [])
      .map((el: any) => {
        const bLat = el.lat ?? el.center?.lat
        const bLon = el.lon ?? el.center?.lon
        if (!bLat || !bLon) return null
        const name =
          el.tags?.name ??
          el.tags?.['name:en'] ??
          el.tags?.['name:ca'] ??
          el.tags?.['name:es'] ??
          'Beach'
        return {
          id: String(el.id),
          name,
          lat: bLat,
          lon: bLon,
          distKm: haversineKm(lat, lon, bLat, bLon),
          tags: el.tags ?? {},
        } as BeachResult
      })
      .filter(Boolean)
      .sort((a: BeachResult, b: BeachResult) => a.distKm - b.distKm)
      .slice(0, 30)
    return results
  } catch (e) {
    console.warn('[overpass] beaches fetch failed', e)
    return []
  }
}

/**
 * Fetch ALL named ski resorts / winter-sports areas worldwide.
 * Caps at 1 500 OSM elements (sufficient for global coverage).
 * If refLat / refLon are supplied the results are sorted by distance
 * from that point and distKm is populated; otherwise distKm = 0.
 */
export async function fetchAllSkiResorts(
  refLat?: number,
  refLon?: number,
): Promise<SkiResortResult[]> {
  const query = `
[out:json][timeout:60];
(
  node["landuse"="winter_sports"];
  way["landuse"="winter_sports"];
  relation["landuse"="winter_sports"];
  node["tourism"="ski_resort"];
  way["tourism"="ski_resort"];
  relation["tourism"="ski_resort"];
);
out 1500 center tags;`

  try {
    const data = await overpassQuery(query)
    const byName = new Map<string, SkiResortResult>()

    for (const el of data.elements ?? []) {
      const bLat = el.lat ?? el.center?.lat
      const bLon = el.lon ?? el.center?.lon
      if (!bLat || !bLon) continue

      const name =
        el.tags?.name ??
        el.tags?.['name:en'] ??
        el.tags?.['name:ca'] ??
        el.tags?.['name:es'] ??
        null
      if (!name) continue

      if (byName.has(name)) continue   // deduplicate by name

      const dist = (refLat != null && refLon != null)
        ? haversineKm(refLat, refLon, bLat, bLon)
        : 0

      byName.set(name, {
        id: String(el.id),
        name,
        lat: bLat,
        lon: bLon,
        distKm: dist,
        eleMin:  el.tags?.ele_min ? Number(el.tags.ele_min) : undefined,
        eleMax:  el.tags?.ele_max ?? el.tags?.ele
          ? Number(el.tags.ele_max ?? el.tags.ele) : undefined,
        website: el.tags?.website ?? el.tags?.url ?? undefined,
      })
    }

    const results = [...byName.values()]
    if (refLat != null) results.sort((a, b) => a.distKm - b.distKm)
    return results
  } catch (e) {
    console.warn('[overpass] global ski fetch failed', e)
    return []
  }
}

/**
 * Find ski resorts / winter sports areas within radiusKm of (lat, lon).
 * Returns up to 20 results sorted by distance.
 */
export async function fetchNearbySkiResorts(
  lat: number,
  lon: number,
  radiusKm = 150,
): Promise<SkiResortResult[]> {
  const radius = radiusKm * 1000
  // Only resort / area level features — no individual pistes/slopes
  const query = `
[out:json][timeout:30];
(
  node["landuse"="winter_sports"](around:${radius},${lat},${lon});
  way["landuse"="winter_sports"](around:${radius},${lat},${lon});
  relation["landuse"="winter_sports"](around:${radius},${lat},${lon});
  node["leisure"="sports_centre"]["sport"="skiing"](around:${radius},${lat},${lon});
  way["leisure"="sports_centre"]["sport"="skiing"](around:${radius},${lat},${lon});
  relation["leisure"="sports_centre"]["sport"="skiing"](around:${radius},${lat},${lon});
  node["tourism"="ski_resort"](around:${radius},${lat},${lon});
  way["tourism"="ski_resort"](around:${radius},${lat},${lon});
  relation["tourism"="ski_resort"](around:${radius},${lat},${lon});
);
out center tags;`

  try {
    const data = await overpassQuery(query)

    // Deduplicate by name (keep the one with more tag data)
    const byName = new Map<string, SkiResortResult>()

    for (const el of data.elements ?? []) {
      const bLat = el.lat ?? el.center?.lat
      const bLon = el.lon ?? el.center?.lon
      if (!bLat || !bLon) continue

      const name =
        el.tags?.name ??
        el.tags?.['name:en'] ??
        el.tags?.['name:ca'] ??
        el.tags?.['name:es'] ??
        null
      if (!name) continue

      const dist = haversineKm(lat, lon, bLat, bLon)
      const existing = byName.get(name)
      if (existing && existing.distKm <= dist) continue

      byName.set(name, {
        id: String(el.id),
        name,
        lat: bLat,
        lon: bLon,
        distKm: dist,
        eleMin: el.tags?.ele_min ? Number(el.tags.ele_min) : undefined,
        eleMax: el.tags?.ele_max ?? el.tags?.ele ? Number(el.tags.ele_max ?? el.tags.ele) : undefined,
        website: el.tags?.website ?? el.tags?.url ?? undefined,
      })
    }

    return [...byName.values()]
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 20)
  } catch (e) {
    console.warn('[overpass] ski resorts fetch failed', e)
    return []
  }
}
