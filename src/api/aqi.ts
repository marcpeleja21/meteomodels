import type { AqiResponse } from '../types'

const BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality'

export async function fetchAqi(lat: number, lon: number): Promise<AqiResponse | null> {
  try {
    const params = new URLSearchParams({
      latitude:      String(lat),
      longitude:     String(lon),
      hourly:        'european_aqi,pm10,pm2_5',
      timezone:      'auto',
      forecast_days: '1',
    })
    const res = await fetch(`${BASE}?${params}`)
    if (!res.ok) return null
    return (await res.json()) as AqiResponse
  } catch {
    return null
  }
}
