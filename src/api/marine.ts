import type { MarineData } from '../types'

const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine'

const HOURLY_VARS = [
  'wave_height',
  'wave_direction',
  'wave_period',
  'swell_wave_height',
  'swell_wave_direction',
  'swell_wave_period',
  'sea_surface_temperature',
].join(',')

const DAILY_VARS = [
  'wave_height_max',
  'swell_wave_height_max',
].join(',')

/**
 * Fetch Open-Meteo Marine API for a location.
 * Returns null for inland locations that have no marine data.
 */
export async function fetchMarineData(lat: number, lon: number): Promise<MarineData | null> {
  const url =
    `${MARINE_BASE}?latitude=${lat}&longitude=${lon}` +
    `&hourly=${HOURLY_VARS}` +
    `&daily=${DAILY_VARS}` +
    `&timezone=auto&forecast_days=7`

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()

    // Open-Meteo returns {"error":true} for inland coords
    if (json.error) return null

    // Validate minimal structure
    if (!json.hourly?.wave_height || !json.daily?.wave_height_max) return null

    return {
      hourly: {
        time: json.hourly.time ?? [],
        wave_height: json.hourly.wave_height ?? [],
        wave_direction: json.hourly.wave_direction ?? [],
        wave_period: json.hourly.wave_period ?? [],
        swell_wave_height: json.hourly.swell_wave_height ?? [],
        swell_wave_direction: json.hourly.swell_wave_direction ?? [],
        swell_wave_period: json.hourly.swell_wave_period ?? [],
        sea_surface_temperature: json.hourly.sea_surface_temperature ?? [],
      },
      daily: {
        time: json.daily.time ?? [],
        wave_height_max: json.daily.wave_height_max ?? [],
        swell_wave_height_max: json.daily.swell_wave_height_max ?? [],
      },
    } as MarineData
  } catch (e) {
    console.warn('[marine] fetch failed', e)
    return null
  }
}
