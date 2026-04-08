import type { OpenMeteoResponse, AqiResponse, CurrentWeather, DailyForecast, WeatherCondition } from '../types'
import { avg, wxFromCode, inferCodeFromPrecip } from './weather'
import type { WxStrings } from '../types'
import { getActiveModels, modelValidForDay, modelValidForHours } from '../config/models'

/** Filter a wxData map to only models valid for the given day index */
function modelsForDay(
  wxData: Record<string, OpenMeteoResponse | null>,
  dayIndex: number
): OpenMeteoResponse[] {
  return getActiveModels()
    .filter(m => modelValidForDay(m, dayIndex) && wxData[m.key] != null)
    .map(m => wxData[m.key]!)
}

/** Filter a wxData map to only models valid for the given hours-from-now offset */
export function modelsForHours(
  wxData: Record<string, OpenMeteoResponse | null>,
  hoursFromNow: number
): OpenMeteoResponse[] {
  return getActiveModels()
    .filter(m => modelValidForHours(m, hoursFromNow) && wxData[m.key] != null)
    .map(m => wxData[m.key]!)
}

/** Find current hour index in an hourly time array */
export function currentHourIdx(times: string[]): number {
  const now = new Date()
  const nowStr = now.toISOString().slice(0, 13) // "2024-03-15T14"
  let best = 0
  for (let i = 0; i < times.length; i++) {
    // times are like "2024-03-15T14:00"
    if (times[i].slice(0, 13) <= nowStr) best = i
  }
  return best
}

/** Extract current-hour weather from a single model response */
export function getCurrentWeather(data: OpenMeteoResponse): CurrentWeather {
  const h = data.hourly
  const i = currentHourIdx(h.time)
  return {
    temp:    h.temperature_2m[i]            ?? null,
    feels:   h.apparent_temperature[i]      ?? null,
    rain:    h.precipitation_probability[i] ?? null,
    code:    h.weather_code[i]              ?? inferCodeFromPrecip(h.precipitation[i] ?? null),
    wind:    h.wind_speed_10m[i]            ?? null,
    windDir: h.wind_direction_10m[i]        ?? null,
    hum:     h.relative_humidity_2m[i]      ?? null,
    pres:    h.pressure_msl[i]              ?? null,
    cloud:   h.cloud_cover[i]               ?? null,
  }
}

/** Ensemble (average across models) of current weather */
export function getEnsembleCurrent(
  wxData: Record<string, OpenMeteoResponse | null>
): { data: CurrentWeather; n: number } {
  const models = Object.values(wxData).filter((d): d is OpenMeteoResponse => d !== null)
  if (!models.length) return { data: { temp:null, feels:null, rain:null, code:null, wind:null, windDir:null, hum:null, pres:null, cloud:null }, n:0 }

  const currents = models.map(getCurrentWeather)
  return {
    data: {
      temp:    avg(currents.map(c => c.temp)),
      feels:   avg(currents.map(c => c.feels)),
      rain:    avg(currents.map(c => c.rain)),
      code:    mostCommonCode(currents.map(c => c.code)),
      wind:    avg(currents.map(c => c.wind)),
      windDir: avg(currents.map(c => c.windDir)),
      hum:     avg(currents.map(c => c.hum)),
      pres:    avg(currents.map(c => c.pres)),
      cloud:   avg(currents.map(c => c.cloud)),
    },
    n: models.length,
  }
}

/** Most common WMO code (modal) */
function mostCommonCode(codes: (number | null)[]): number | null {
  const filtered = codes.filter((c): c is number => c !== null)
  if (!filtered.length) return null
  const counts: Record<number, number> = {}
  for (const c of filtered) counts[c] = (counts[c] ?? 0) + 1
  return +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

/** Build 5-day ensemble forecast (index 0 = today), excluding range-limited models per day */
export function getEnsembleForecast(
  wxData: Record<string, OpenMeteoResponse | null>,
  wx: WxStrings,
  count = 5
): DailyForecast[] {
  const allModels = Object.values(wxData).filter((d): d is OpenMeteoResponse => d !== null)
  if (!allModels.length) return []

  // Use the first available model's time array as reference
  const refTimes = allModels[0].daily.time.slice(0, count)
  return refTimes.map((date, i): DailyForecast => {
    // Only include models valid for this day index
    const models = modelsForDay(wxData, i)
    const maxTs = models.map(m => m.daily.temperature_2m_max[i] ?? null)
    const minTs = models.map(m => m.daily.temperature_2m_min[i] ?? null)
    const rains = models.map(m => m.daily.precipitation_probability_max[i] ?? null)
    const codes = models.map(m => m.daily.weather_code[i] ?? inferCodeFromPrecip(m.daily.precipitation_sum?.[i] ?? null))
    const code  = mostCommonCode(codes)
    const cond: WeatherCondition = wxFromCode(code, wx)
    return {
      date,
      maxT: avg(maxTs),
      minT: avg(minTs),
      rain: avg(rains),
      code,
      cond,
      n: models.length,
    }
  })
}

/** Build 7-day ensemble forecast */
export function getEnsembleForecast7(
  wxData: Record<string, OpenMeteoResponse | null>,
  wx: WxStrings
): DailyForecast[] {
  return getEnsembleForecast(wxData, wx, 7)
}

/** Get current AQI value */
export function getCurrentAqi(aqiData: AqiResponse | null): number | null {
  if (!aqiData) return null
  const times = aqiData.hourly.time
  const idx = currentHourIdx(times)
  return aqiData.hourly.european_aqi[idx] ?? null
}

/** Wind direction degrees → arrow */
export function windArrow(deg: number | null): string {
  if (deg === null) return ''
  const dirs = ['↑','↗','→','↘','↓','↙','←','↖']
  return dirs[Math.round(deg / 45) % 8]
}
