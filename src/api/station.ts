import type { CurrentObs } from '../types'
export type { CurrentObs }

/**
 * Fetch current observations from the nearest Weather Underground PWS
 * via our /api/pws Vercel edge proxy (keeps the API key server-side).
 */
export async function fetchCurrentObs(lat: number, lon: number): Promise<CurrentObs | null> {
  try {
    const res = await fetch(`/api/pws?lat=${lat}&lon=${lon}`)
    if (!res.ok) throw new Error(`pws proxy ${res.status}`)
    const d = await res.json()
    if (d.error) throw new Error(d.error)

    return {
      temp:           d.temp          ?? null,
      feelsLike:      d.feelsLike     ?? null,
      humidity:       d.humidity      ?? null,
      windspeed:      d.windspeed     ?? null,
      windGust:       d.windGust      ?? null,
      windDir:        d.windDir       ?? null,
      pressure:       d.pressure      ?? null,
      precip:         d.precipTotal   ?? null,
      uv:             d.uv            ?? null,
      solarRadiation: d.solarRadiation ?? null,
      code:           null,           // WU doesn't return WMO codes; icon derived from temp/precip
      time:           d.obsTimeUtc    ?? null,
      stationName:    d.stationName   ?? null,
      stationDist:    d.stationDist   ?? null,
      stationLat:     d.stationLat    ?? null,
      stationLon:     d.stationLon    ?? null,
    }
  } catch {
    return null
  }
}
