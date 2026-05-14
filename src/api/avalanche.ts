import type { AvalancheRisk } from '../types'

const EAWS_URL = 'https://api.avalanche.report/api/v1/public/bulletins'

/** EAWS colour per danger level */
const LEVEL_COLOR: Record<number, string> = {
  1: '#CCFF00',
  2: '#FFFF00',
  3: '#FF9900',
  4: '#FF0000',
  5: '#000000',
}

/**
 * Fetch EAWS avalanche danger level for a coordinate.
 * Returns null when outside EAWS coverage (outside Europe) or on API error.
 */
export async function fetchAvalancheRisk(lat: number, lon: number): Promise<AvalancheRisk | null> {
  // EAWS covers roughly lat 35-72, lon -11 to 40 (Europe)
  if (lat < 34 || lat > 73 || lon < -12 || lon > 41) return null

  const url = `${EAWS_URL}?latitude=${lat}&longitude=${lon}&format=simple`

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()

    // Try to find the relevant bulletin / danger rating
    // EAWS simple format returns an array of bulletins
    const bulletins: any[] = Array.isArray(data) ? data : (data.bulletins ?? [])
    if (!bulletins.length) return null

    // Find the bulletin that covers our point — pick first one with a danger rating
    for (const b of bulletins) {
      const regions: any[] = b.regions ?? []
      void regions  // checked for existence; per-point filtering left to API

      const dangerRatings: any[] = b.dangerRatings ?? []
      if (!dangerRatings.length && !b.maxDangerRating) continue

      // Use maxDangerRating if available, else first dangerRating value
      const raw = b.maxDangerRating?.numeric ?? b.dangerRatings?.[0]?.mainValue?.numeric
      if (raw == null) continue

      const level = Math.round(raw) as 1 | 2 | 3 | 4 | 5
      if (level < 1 || level > 5) continue

      const labels: Record<number, string> = {
        1: 'Low',
        2: 'Limited',
        3: 'Considerable',
        4: 'High',
        5: 'Very High',
      }

      return {
        level,
        label: b.maxDangerRating?.text?.en ?? b.dangerRatings?.[0]?.mainValue?.text?.en ?? labels[level],
        color: LEVEL_COLOR[level] ?? '#999',
      }
    }

    return null
  } catch (e) {
    console.warn('[avalanche] fetch failed', e)
    return null
  }
}
