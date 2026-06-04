import type { OpenMeteoResponse } from '../types'

const BASE = 'https://api.open-meteo.com/v1/forecast'

const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'relative_humidity_2m',
  'pressure_msl',
  'cloud_cover',
  'uv_index',
  'snow_depth',
  'snowfall',
].join(',')

const DAILY_VARS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'weather_code',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
].join(',')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Attach a numeric status code to an Error so callers can branch on it
 * without string-parsing the message.
 */
function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status })
}

/**
 * Fetch weather data for a single model.
 *
 * Retry strategy:
 *   1. Attempt with `models=<modelId>`.
 *   2. If the server returns 502/503/504, wait 800 ms and retry once.
 *   3. If it still fails with a server error, fall back to fetching
 *      without the `models=` parameter (Open-Meteo default routing),
 *      which is more resilient and always returns data.
 *   4. Any other HTTP error (4xx, unexpected 5xx) is thrown immediately.
 */
export async function fetchWeatherModel(
  lat: number,
  lon: number,
  modelId: string,
  maxDays = 7
): Promise<OpenMeteoResponse> {
  const commonParams = {
    latitude:      String(lat),
    longitude:     String(lon),
    hourly:        HOURLY_VARS,
    daily:         DAILY_VARS,
    timezone:      'auto',
    forecast_days: String(maxDays),
  }

  async function doFetch(withModel: boolean): Promise<OpenMeteoResponse> {
    const params = new URLSearchParams(
      withModel ? { ...commonParams, models: modelId } : commonParams
    )
    const res = await fetch(`${BASE}?${params}`)
    if (!res.ok) throw httpError(res.status)
    const json = await res.json()
    if (json.error) throw new Error(json.reason ?? 'API error')
    return json as OpenMeteoResponse
  }

  const isServerError = (e: unknown) => {
    const s = (e as any)?.status
    return s === 502 || s === 503 || s === 504
  }

  // Attempt 1: specific model
  try {
    return await doFetch(true)
  } catch (e) {
    if (!isServerError(e)) throw e
  }

  // Attempt 2: retry after 800 ms (handles transient blips)
  await sleep(800)
  try {
    return await doFetch(true)
  } catch (e) {
    if (!isServerError(e)) throw e
  }

  // Attempt 3: fall back to default routing (no models= param)
  // Open-Meteo chooses the best available model for the location.
  return doFetch(false)
}

/** Fetch all available Open-Meteo models concurrently */
export async function fetchAllModels(
  lat: number,
  lon: number,
  models: Array<{ key: string; apiId: string | null; avail: boolean; mb?: boolean; maxDays?: number }>,
  onProgress: (key: string, ok: boolean) => void
): Promise<Record<string, OpenMeteoResponse | null>> {
  const results: Record<string, OpenMeteoResponse | null> = {}

  await Promise.all(
    models
      .filter(m => m.avail && m.apiId && !m.mb)
      .map(async m => {
        try {
          results[m.key] = await fetchWeatherModel(lat, lon, m.apiId!, m.maxDays ?? 7)
          onProgress(m.key, true)
        } catch {
          results[m.key] = null
          onProgress(m.key, false)
        }
      })
  )

  return results
}
