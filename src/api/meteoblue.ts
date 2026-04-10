import type { OpenMeteoResponse } from '../types'

/** Fetch MeteoBlue NMM via their "basic-1h + basic-day" package endpoint
 *  and map the response to our internal OpenMeteoResponse format.
 */
export async function fetchMeteoblue(
  lat: number,
  lon: number,
  apiKey: string
): Promise<OpenMeteoResponse> {
  // Route through /api/meteoblue (Vercel Edge proxy) to bypass CORS —
  // MeteoBlue does not send Access-Control-Allow-Origin headers.
  const url = `/api/meteoblue?lat=${lat}&lon=${lon}&apikey=${encodeURIComponent(apiKey)}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`MeteoBlue HTTP ${res.status}`)
  const json = await res.json()

  // MeteoBlue wraps data under data_1h / data_day
  const h1 = json.data_1h
  const dd  = json.data_day

  if (!h1 || !dd) throw new Error('MeteoBlue: unexpected format')

  // Build time strings in ISO-like format matching Open-Meteo
  const times1h: string[] = (h1.time as string[]).map(t => t.replace(' ', 'T'))
  const timesDay: string[] = (dd.time as string[]).map(t => t.replace(' ', 'T'))

  const toNumArr = (arr: unknown): (number | null)[] =>
    Array.isArray(arr) ? arr.map(v => (v === null || v === undefined ? null : Number(v))) : []

  return {
    latitude:  lat,
    longitude: lon,
    timezone:  json.metadata?.timezone ?? 'UTC',
    hourly: {
      time:                     times1h,
      temperature_2m:           toNumArr(h1.temperature),
      apparent_temperature:     toNumArr(h1.felttemperature),
      precipitation_probability: toNumArr(h1.precipitation_probability),
      precipitation:            toNumArr(h1.precipitation),
      weather_code:             toNumArr(h1.pictocode).map(mbPictoToWmo),
      wind_speed_10m:           toNumArr(h1.windspeed),
      wind_gusts_10m:           toNumArr(h1.windgusts ?? h1.windgust ?? []),
      wind_direction_10m:       toNumArr(h1.winddirection),
      relative_humidity_2m:     toNumArr(h1.relativehumidity),
      pressure_msl:             toNumArr(h1.sealevelpressure),
      cloud_cover:              toNumArr(h1.totalcloudcover),
    },
    daily: {
      time:                        timesDay,
      temperature_2m_max:          toNumArr(dd.temperature_max),
      temperature_2m_min:          toNumArr(dd.temperature_min),
      precipitation_sum:           toNumArr(dd.precipitation),
      precipitation_probability_max: toNumArr(dd.precipitation_probability_max ?? dd.precipitation_probability),
      weather_code:                toNumArr(dd.pictocode).map(mbPictoToWmo),
      wind_speed_10m_max:          toNumArr(dd.windspeed_max),
      wind_gusts_10m_max:          toNumArr(dd.windgusts_max ?? dd.windgust_max ?? []),
    },
  }
}

/** Map MeteoBlue pictocode (1–17) to approximate WMO code */
function mbPictoToWmo(code: number | null): number | null {
  if (code === null) return null
  const map: Record<number, number> = {
    1:  0,   // sunny
    2:  1,   // mainly sunny
    3:  2,   // partly cloudy
    4:  3,   // overcast
    5:  45,  // fog
    6:  51,  // drizzle
    7:  61,  // rain
    8:  65,  // heavy rain
    9:  80,  // rain showers
    10: 95,  // thunder
    11: 71,  // snow
    12: 77,  // snow grains
    13: 85,  // snow showers
    14: 57,  // freezing rain
    15: 75,  // heavy snow
    16: 96,  // thunder+hail
    17: 3,   // mostly cloudy
  }
  return map[code] ?? null
}
