import type { OpenMeteoResponse, AqiResponse, CurrentWeather, DailyForecast, WeatherCondition } from '../types'
import { avg, wxFromCode, inferCodeFromPrecip } from './weather'
import type { WxStrings } from '../types'
import { getActiveModels, modelValidForDay, modelValidForHours } from '../config/models'

/**
 * Returns true if it is currently night at the weather location.
 * Reads the current-hour timestamp from the first available model response
 * (which uses the location's own timezone via Open-Meteo timezone=auto).
 * Falls back to browser local time when no data is loaded yet.
 */
export function isLocationNight(wxData: Record<string, OpenMeteoResponse | null>): boolean {
  const model = Object.values(wxData).find((d): d is OpenMeteoResponse => d !== null)
  let hour: number
  if (model) {
    const i = currentHourIdx(model.hourly.time, model.timezone)
    hour = parseInt(model.hourly.time[i].slice(11, 13), 10)
  } else {
    hour = new Date().getHours()
  }
  return hour < 7 || hour >= 20
}

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

/**
 * Find current hour index in an hourly time array.
 *
 * Open-Meteo returns timestamps in the **location's local timezone** when the
 * API is called with `timezone=auto`.  Using `new Date().toISOString()` here
 * would give UTC, which can be several hours behind the local time and
 * therefore point to the wrong (earlier) slot.
 *
 * When `timezone` (an IANA name like "Europe/Madrid") is provided we convert
 * the current instant to that timezone before comparing; otherwise we fall
 * back to the browser's local time, which is a reasonable approximation when
 * the user is looking at their own region.
 */
export function currentHourIdx(times: string[], timezone?: string | null): number {
  const now = new Date()
  let nowStr: string

  if (timezone) {
    try {
      // sv-SE locale gives ISO-like "YYYY-MM-DD HH:mm:ss" in the target tz
      const fmt = new Intl.DateTimeFormat('sv-SE', {
        timeZone:  timezone,
        year:      'numeric',
        month:     '2-digit',
        day:       '2-digit',
        hour:      '2-digit',
        minute:    '2-digit',
        hour12:    false,
      })
      const s = fmt.format(now) // e.g. "2026-04-16 10:45"
      // Build "YYYY-MM-DDTHH" to match model timestamps like "2026-04-16T10:00"
      nowStr = s.slice(0, 10) + 'T' + s.slice(11, 13)
    } catch {
      // Unknown timezone — fall back to browser local time
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
      nowStr = local.toISOString().slice(0, 13)
    }
  } else {
    // No timezone info available: use browser local time as best approximation
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    nowStr = local.toISOString().slice(0, 13)
  }

  let best = 0
  for (let i = 0; i < times.length; i++) {
    // times are like "2024-03-15T14:00" — compare only up to the hour
    if (times[i].slice(0, 13) <= nowStr) best = i
  }
  return best
}

/** Extract current-hour weather from a single model response */
export function getCurrentWeather(data: OpenMeteoResponse): CurrentWeather {
  const h = data.hourly
  const i = currentHourIdx(h.time, data.timezone)
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

/** Ensemble (weighted average across models) of current weather */
export function getEnsembleCurrent(
  wxData:  Record<string, OpenMeteoResponse | null>,
  weights: Record<string, number> = {},
): { data: CurrentWeather; n: number } {
  const entries = Object.entries(wxData)
    .filter((e): e is [string, OpenMeteoResponse] => e[1] !== null)

  if (!entries.length) return {
    data: { temp:null, feels:null, rain:null, code:null, wind:null, windDir:null, hum:null, pres:null, cloud:null },
    n: 0,
  }

  // Build weighted current readings; fall back to equal weight when weights map is empty
  const hasWeights = Object.keys(weights).length > 0
  const currents: Array<{ w: number; c: CurrentWeather }> = entries.map(([key, data]) => ({
    w: hasWeights ? (weights[key] ?? 1 / entries.length) : 1 / entries.length,
    c: getCurrentWeather(data),
  }))

  // Weighted average helper for a numeric field
  function wavg(field: keyof CurrentWeather): number | null {
    let wSum = 0, vSum = 0
    for (const { w, c } of currents) {
      const v = c[field] as number | null
      if (v !== null) { wSum += w; vSum += w * v }
    }
    return wSum > 0 ? vSum / wSum : null
  }

  // For the weather code: if AROME HD or AROME has data, use theirs directly
  // (highest-resolution model in its domain should own the condition label).
  // Fall back to weighted modal only when neither is available.
  let code: number | null = null
  const aromePreference = ['arome_hd', 'arome']
  for (const key of aromePreference) {
    const entry = entries.find(([k]) => k === key)
    if (entry) {
      const c = getCurrentWeather(entry[1])
      if (c.code !== null) { code = c.code; break }
    }
  }
  if (code === null) code = weightedModalCode(currents)

  return {
    data: {
      temp:    wavg('temp'),
      feels:   wavg('feels'),
      rain:    wavg('rain'),
      code,
      wind:    wavg('wind'),
      windDir: wavg('windDir'),
      hum:     wavg('hum'),
      pres:    wavg('pres'),
      cloud:   wavg('cloud'),
    },
    n: entries.length,
  }
}

/** Weighted modal WMO code — picks the code whose combined weight is highest */
function weightedModalCode(currents: Array<{ w: number; c: CurrentWeather }>): number | null {
  const scores: Record<number, number> = {}
  for (const { w, c } of currents) {
    if (c.code !== null) scores[c.code] = (scores[c.code] ?? 0) + w
  }
  const entries = Object.entries(scores)
  if (!entries.length) return null
  return +entries.sort((a, b) => b[1] - a[1])[0][0]
}

/** Most common WMO code (modal) — used for daily forecast aggregation */
function mostCommonCode(codes: (number | null)[]): number | null {
  const filtered = codes.filter((c): c is number => c !== null)
  if (!filtered.length) return null
  const counts: Record<number, number> = {}
  for (const c of filtered) counts[c] = (counts[c] ?? 0) + 1
  return +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

/**
 * Scans the current hour + next 6 hours across all loaded models.
 * Returns the earliest offset (in hours) at which precipitation is expected,
 * or null if none detected in the window.
 * Returns 0 if precipitation is already occurring now.
 */
export function hoursUntilPrecip(wxData: Record<string, OpenMeteoResponse | null>): number | null {
  const models = Object.values(wxData).filter((d): d is OpenMeteoResponse => d !== null)
  if (!models.length) return null

  // Count how many models signal precip at each hour offset
  const hitsPerOffset: Map<number, number> = new Map()

  for (const model of models) {
    const h = model.hourly
    const base = currentHourIdx(h.time, model.timezone)

    for (let offset = 0; offset <= 6; offset++) {
      const idx = base + offset
      if (idx >= h.time.length) break

      const code = h.weather_code[idx] ?? null
      const prob = h.precipitation_probability[idx] ?? 0

      const hasRainCode = code !== null && (
        (code >= 51 && code <= 82) ||
        (code >= 85 && code <= 86) ||
        (code >= 95 && code <= 99)
      )

      // Require a meaningful probability AND/OR a rain WMO code
      if (hasRainCode || prob >= 40) {
        hitsPerOffset.set(offset, (hitsPerOffset.get(offset) ?? 0) + 1)
        break // only count the earliest hit per model
      }
    }
  }

  if (!hitsPerOffset.size) return null

  // Require at least 2 models to agree (or all models when only 1 is loaded)
  const minAgreement = Math.min(2, models.length)
  let earliest: number | null = null

  for (const [offset, count] of hitsPerOffset) {
    if (count >= minAgreement) {
      if (earliest === null || offset < earliest) earliest = offset
    }
  }

  return earliest
}

/** Build 5-day ensemble forecast (index 0 = today), excluding range-limited models per day */
export function getEnsembleForecast(
  wxData: Record<string, OpenMeteoResponse | null>,
  wx: WxStrings,
  count = 5
): DailyForecast[] {
  const allModels = Object.values(wxData).filter((d): d is OpenMeteoResponse => d !== null)
  if (!allModels.length) return []

  // Use the model with the longest forecast range as reference (avoids 2-day truncation
  // when a short-range LAM like AROME HD / ICON D2 happens to be first in Promise.all)
  const refModel = allModels.reduce((best, m) => m.daily.time.length > best.daily.time.length ? m : best)
  const refTimes = refModel.daily.time.slice(0, count)
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
export function getCurrentAqi(aqiData: AqiResponse | null, timezone?: string | null): number | null {
  if (!aqiData) return null
  const times = aqiData.hourly.time
  const idx = currentHourIdx(times, timezone)
  return aqiData.hourly.european_aqi[idx] ?? null
}

/** Wind direction degrees → arrow */
export function windArrow(deg: number | null): string {
  if (deg === null) return ''
  const dirs = ['↑','↗','→','↘','↓','↙','←','↖']
  return dirs[Math.round(deg / 45) % 8]
}
