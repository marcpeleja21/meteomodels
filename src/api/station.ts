import type { CurrentObs } from '../types'
export type { CurrentObs }

/** Haversine distance in km */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Map wttr.in weather codes → approximate WMO codes so we can reuse wxFromCode().
 * wttr.in uses WorldWeatherOnline codes, not WMO, so this is approximate.
 */
function wttrToWmo(code: number): number {
  if (code <= 113) return 0           // Clear
  if (code <= 116) return 1           // Partly cloudy
  if (code <= 122) return 3           // Overcast
  if (code <= 143) return 10          // Mist
  if (code <= 260) return 45          // Fog / freezing fog
  if (code <= 284) return 51          // Drizzle
  if (code <= 314) return 61          // Rain / freezing rain
  if (code <= 320) return 67          // Sleet
  if (code <= 338) return 71          // Snow
  if (code <= 377) return 80          // Showers
  if (code <= 395) return 95          // Thunderstorm
  return 0
}

export async function fetchCurrentObs(lat: number, lon: number): Promise<CurrentObs | null> {
  try {
    const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`)
    if (!res.ok) throw new Error(`proxy ${res.status}`)
    const json = await res.json()

    const cur = json.current_condition?.[0]
    if (!cur) throw new Error('no current_condition')

    const area     = json.nearest_area?.[0]
    const cityName = area?.areaName?.[0]?.value ?? null
    const sLat     = area?.latitude  ? parseFloat(area.latitude)  : null
    const sLon     = area?.longitude ? parseFloat(area.longitude) : null
    const dist     = sLat !== null && sLon !== null
      ? Math.round(haversineKm(lat, lon, sLat, sLon))
      : null

    const windDeg = parseInt(cur.winddirDegree ?? '0', 10)

    return {
      temp:        parseFloat(cur.temp_C)      ?? null,
      feelsLike:   parseFloat(cur.FeelsLikeC)  ?? null,
      humidity:    parseInt(cur.humidity, 10)  ?? null,
      windspeed:   parseInt(cur.windspeedKmph, 10) ?? null,
      windDir:     windDeg,
      precip:      parseFloat(cur.precipMM)    ?? null,
      code:        wttrToWmo(parseInt(cur.weatherCode ?? '113', 10)),
      time:        null,   // wttr.in doesn't return ISO time
      stationName: cityName,
      stationDist: dist,
      stationLat:  sLat,
      stationLon:  sLon,
    }
  } catch {
    return null
  }
}
