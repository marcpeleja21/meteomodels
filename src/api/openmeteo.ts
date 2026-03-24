import type { OpenMeteoResponse } from '../types'

const BASE = 'https://api.open-meteo.com/v1/forecast'

const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'weathercode',
  'windspeed_10m',
  'winddirection_10m',
  'relative_humidity_2m',
  'pressure_msl',
  'cloudcover',
].join(',')

const DAILY_VARS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'weathercode',
  'windspeed_10m_max',
  'windgusts_10m_max',
].join(',')

export async function fetchWeatherModel(
  lat: number,
  lon: number,
  modelId: string
): Promise<OpenMeteoResponse> {
  const params = new URLSearchParams({
    latitude:      String(lat),
    longitude:     String(lon),
    hourly:        HOURLY_VARS,
    daily:         DAILY_VARS,
    timezone:      'auto',
    forecast_days: '7',
    models:        modelId,
  })
  const res = await fetch(`${BASE}?${params}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.reason ?? 'API error')
  return json as OpenMeteoResponse
}

/** Fetch all available Open-Meteo models concurrently */
export async function fetchAllModels(
  lat: number,
  lon: number,
  models: Array<{ key: string; apiId: string | null; avail: boolean; mb?: boolean }>,
  onProgress: (key: string, ok: boolean) => void
): Promise<Record<string, OpenMeteoResponse | null>> {
  const results: Record<string, OpenMeteoResponse | null> = {}

  await Promise.all(
    models
      .filter(m => m.avail && m.apiId && !m.mb)
      .map(async m => {
        try {
          results[m.key] = await fetchWeatherModel(lat, lon, m.apiId!)
          onProgress(m.key, true)
        } catch {
          results[m.key] = null
          onProgress(m.key, false)
        }
      })
  )

  return results
}
