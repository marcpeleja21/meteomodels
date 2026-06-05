/**
 * MET Norway Locationforecast 2.0 adapter
 * ─────────────────────────────────────────
 * Fetches hourly forecast data from https://api.met.no/weatherapi/locationforecast/2.0/compact
 * and maps it to our internal OpenMeteoResponse format.
 *
 * Why this exists
 * ───────────────
 * Used as a last-resort fallback when all Open-Meteo endpoints are unavailable.
 * api.met.no is free, requires no API key, has global coverage,
 * returns Access-Control-Allow-Origin: * (browser-accessible), and is maintained
 * by the Norwegian Meteorological Institute — an independent, highly reliable source.
 *
 * Data coverage
 * ─────────────
 *   ✅  temperature, feels-like (computed), humidity, pressure, cloud cover
 *   ✅  wind speed + direction
 *   ✅  precipitation amount
 *   ✅  weather code (mapped from symbol_code → WMO)
 *   ⚠️  wind gusts — not provided; estimated as windspeed × 1.5
 *   ⚠️  precipitation probability — not provided; estimated from symbol_code
 *   ➖  UV index, snow depth, snowfall — returned as nulls
 *
 * Rate limits / caching
 * ─────────────────────
 * MET Norway asks callers not to fetch more often than the cache lifetime
 * indicated by the Expires header (~60 min).  We only call this when
 * Open-Meteo is completely down, so frequency is naturally low.
 */

import type { OpenMeteoResponse } from '../types'

const ENDPOINT = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'

// ── Symbol-code → WMO weather code ───────────────────────────────────────────
// https://api.met.no/weatherapi/weathericon/2.0/documentation
const SYMBOL_TO_WMO: Record<string, number> = {
  clearsky_day:                  0,
  clearsky_night:                0,
  clearsky_polartwilight:        0,
  fair_day:                      1,
  fair_night:                    1,
  fair_polartwilight:            1,
  partlycloudy_day:              2,
  partlycloudy_night:            2,
  partlycloudy_polartwilight:    2,
  cloudy:                        3,
  fog:                           45,
  lightdrizzle:                  51,
  drizzle:                       53,
  heavydrizzle:                  55,
  lightdrizzlethunder:           51,
  drizzlethunder:                53,
  heavydrizzlethunder:           55,
  lightrain:                     61,
  rain:                          63,
  heavyrain:                     65,
  lightrainshowers_day:          80,
  lightrainshowers_night:        80,
  lightrainshowers_polartwilight:80,
  rainshowers_day:               81,
  rainshowers_night:             81,
  rainshowers_polartwilight:     81,
  heavyrainshowers_day:          82,
  heavyrainshowers_night:        82,
  heavyrainshowers_polartwilight:82,
  lightrainandthunder:           95,
  rainandthunder:                95,
  heavyrainandthunder:           99,
  lightrainshowersandthunder_day:   95,
  lightrainshowersandthunder_night: 95,
  rainshowersandthunder_day:        95,
  rainshowersandthunder_night:      95,
  heavyrainshowersandthunder_day:   99,
  heavyrainshowersandthunder_night: 99,
  lightsleet:                    68,
  sleet:                         68,
  heavysleet:                    68,
  lightsleetshowers_day:         68,
  lightsleetshowers_night:       68,
  sleetshowers_day:              68,
  sleetshowers_night:            68,
  heavysleetshowers_day:         68,
  heavysleetshowers_night:       68,
  lightsleetandthunder:          68,
  sleetandthunder:               68,
  lightsleetshowersandthunder_day:  68,
  lightsleetshowersandthunder_night:68,
  lightsnow:                     71,
  snow:                          73,
  heavysnow:                     75,
  lightsnowshowers_day:          85,
  lightsnowshowers_night:        85,
  lightsnowshowers_polartwilight:85,
  snowshowers_day:               86,
  snowshowers_night:             86,
  snowshowers_polartwilight:     86,
  heavysnowshowers_day:          86,
  heavysnowshowers_night:        86,
  lightsnowandthunder:           95,
  snowandthunder:                95,
  heavysnowandthunder:           95,
  lightsnowshowersandthunder_day:   95,
  lightsnowshowersandthunder_night: 95,
  snowshowersandthunder_day:        95,
  snowshowersandthunder_night:      95,
}

function symbolToWmo(sym: string): number {
  // Strip trailing "_day", "_night", "_polartwilight" if not found as-is
  return SYMBOL_TO_WMO[sym]
    ?? SYMBOL_TO_WMO[sym.replace(/_(?:day|night|polartwilight)$/, '')]
    ?? 3   // fallback: cloudy
}

/**
 * Rough precipitation probability from symbol code.
 * MET Norway doesn't publish this directly; we derive a coarse estimate.
 */
function symbolToPrecipProb(sym: string): number {
  if (/thunder|heavy.*rain|heavyrain/.test(sym)) return 95
  if (/rain|sleet|snow|drizzle/.test(sym))        return 75
  if (/shower/.test(sym))                          return 50
  if (/partlycloudy/.test(sym))                    return 15
  if (/cloudy|fog/.test(sym))                      return 25
  return 5
}

/** Magnus formula: dew point → apparent temperature (simplified Steadman) */
function feelsLike(tempC: number, rhPct: number, windMs: number): number {
  if (tempC >= 27 && rhPct >= 40) {
    // Heat index
    const t = tempC, r = rhPct
    return -8.78469475556 + 1.61139411*t + 2.33854883889*r
      - 0.14611605*t*r - 0.012308094*t*t - 0.0164248277778*r*r
      + 0.002211732*t*t*r + 0.00072546*t*r*r - 0.000003582*t*t*r*r
  }
  if (tempC <= 10 && windMs >= 1.3) {
    // Wind chill
    const v = windMs * 3.6
    return 13.12 + 0.6215*tempC - 11.37*Math.pow(v, 0.16) + 0.3965*tempC*Math.pow(v, 0.16)
  }
  return tempC
}

// ── MET Norway raw types ──────────────────────────────────────────────────────

interface MetNoInstant {
  air_pressure_at_sea_level?: number
  air_temperature?: number
  cloud_area_fraction?: number
  relative_humidity?: number
  wind_from_direction?: number
  wind_speed?: number
}

interface MetNoStep {
  summary?: { symbol_code: string }
  details?: { precipitation_amount?: number; probability_of_precipitation?: number }
}

interface MetNoEntry {
  time: string
  data: {
    instant: { details: MetNoInstant }
    next_1_hours?: MetNoStep
    next_6_hours?: MetNoStep
    next_12_hours?: MetNoStep
  }
}

interface MetNoResponse {
  properties: {
    timeseries: MetNoEntry[]
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Fetch weather from MET Norway and return it as an OpenMeteoResponse.
 * Throws on network error or unexpected response shape.
 */
export async function fetchMetNo(lat: number, lon: number): Promise<OpenMeteoResponse> {
  const url = `${ENDPOINT}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'MeteoModels/1.0 (weather forecast app; contact via GitHub)',
    },
  })
  if (!res.ok) throw new Error(`MET Norway HTTP ${res.status}`)
  const raw = (await res.json()) as MetNoResponse

  const timeseries = raw?.properties?.timeseries
  if (!timeseries?.length) throw new Error('MET Norway: empty timeseries')

  // ── Build hourly arrays ───────────────────────────────────────────────────
  // Only use entries that have next_1_hours (true hourly entries).
  // From ~60+ h onwards MET Norway switches to 6-hourly and 12-hourly entries;
  // we include those too so we reach 7+ days, accepting the lower cadence.
  const times:       string[]           = []
  const temp:        (number | null)[]  = []
  const feelsLikeArr:(number | null)[]  = []
  const precip:      (number | null)[]  = []
  const precipProb:  (number | null)[]  = []
  const code:        (number | null)[]  = []
  const windSpeed:   (number | null)[]  = []
  const windGust:    (number | null)[]  = []
  const windDir:     (number | null)[]  = []
  const humidity:    (number | null)[]  = []
  const pressure:    (number | null)[]  = []
  const cloud:       (number | null)[]  = []

  for (const entry of timeseries) {
    const inst = entry.data.instant.details
    // Prefer next_1_hours; fall back to next_6_hours / next_12_hours for symbol + precip
    const step: MetNoStep =
      entry.data.next_1_hours
      ?? entry.data.next_6_hours
      ?? entry.data.next_12_hours
      ?? {}

    const sym      = step.summary?.symbol_code ?? ''
    const wSpeed   = inst.wind_speed    ?? null
    const tVal     = inst.air_temperature ?? null
    const rhVal    = inst.relative_humidity ?? null

    times.push(entry.time)
    temp.push(tVal)
    feelsLikeArr.push(
      tVal !== null && rhVal !== null && wSpeed !== null
        ? Math.round(feelsLike(tVal, rhVal, wSpeed) * 10) / 10
        : null
    )
    precip.push(step.details?.precipitation_amount ?? 0)
    precipProb.push(
      step.details?.probability_of_precipitation != null
        ? step.details.probability_of_precipitation
        : sym ? symbolToPrecipProb(sym) : null
    )
    code.push(sym ? symbolToWmo(sym) : null)
    windSpeed.push(wSpeed !== null ? Math.round(wSpeed * 3.6 * 10) / 10 : null)  // m/s → km/h
    windGust.push(wSpeed !== null ? Math.round(wSpeed * 1.5 * 3.6 * 10) / 10 : null) // estimated
    windDir.push(inst.wind_from_direction ?? null)
    humidity.push(rhVal ?? null)
    pressure.push(inst.air_pressure_at_sea_level ?? null)
    cloud.push(inst.cloud_area_fraction ?? null)
  }

  // ── Derive daily summaries ────────────────────────────────────────────────
  interface DayBucket {
    tmax: number[]; tmin: number[]; precip: number[]; precipProb: number[]; codes: number[]
    windMax: number[]; gustMax: number[]
  }
  const dayMap = new Map<string, DayBucket>()

  for (let i = 0; i < times.length; i++) {
    const day = times[i].slice(0, 10)
    if (!dayMap.has(day)) dayMap.set(day, { tmax:[], tmin:[], precip:[], precipProb:[], codes:[], windMax:[], gustMax:[] })
    const b = dayMap.get(day)!
    if (temp[i]      !== null) { b.tmax.push(temp[i]!); b.tmin.push(temp[i]!) }
    if (precip[i]    !== null) b.precip.push(precip[i]!)
    if (precipProb[i]!== null) b.precipProb.push(precipProb[i]!)
    if (code[i]      !== null) b.codes.push(code[i]!)
    if (windSpeed[i] !== null) b.windMax.push(windSpeed[i]!)
    if (windGust[i]  !== null) b.gustMax.push(windGust[i]!)
  }

  const dailyTimes:    string[]          = []
  const dailyTmax:     (number | null)[] = []
  const dailyTmin:     (number | null)[] = []
  const dailyPrecip:   (number | null)[] = []
  const dailyPrecipP:  (number | null)[] = []
  const dailyCodes:    (number | null)[] = []
  const dailyWind:     (number | null)[] = []
  const dailyGust:     (number | null)[] = []

  for (const [day, b] of dayMap.entries()) {
    dailyTimes.push(day)
    dailyTmax.push(b.tmax.length ? Math.max(...b.tmax) : null)
    dailyTmin.push(b.tmin.length ? Math.min(...b.tmin) : null)
    dailyPrecip.push(b.precip.reduce((s, v) => s + v, 0) || null)
    dailyPrecipP.push(b.precipProb.length ? Math.max(...b.precipProb) : null)
    // modal weather code for the day
    const codeCnt: Record<number, number> = {}
    b.codes.forEach(c => { codeCnt[c] = (codeCnt[c] ?? 0) + 1 })
    const topCode = Object.entries(codeCnt).sort((a, b) => b[1] - a[1])[0]
    dailyCodes.push(topCode ? +topCode[0] : null)
    dailyWind.push(b.windMax.length ? Math.max(...b.windMax) : null)
    dailyGust.push(b.gustMax.length ? Math.max(...b.gustMax) : null)
  }

  // ── Assemble OpenMeteoResponse ────────────────────────────────────────────
  return {
    latitude:  lat,
    longitude: lon,
    timezone:  'UTC',
    hourly: {
      time:                      times,
      temperature_2m:            temp,
      apparent_temperature:      feelsLikeArr,
      precipitation_probability: precipProb,
      precipitation:             precip,
      weather_code:              code,
      wind_speed_10m:            windSpeed,
      wind_gusts_10m:            windGust,
      wind_direction_10m:        windDir,
      relative_humidity_2m:      humidity,
      pressure_msl:              pressure,
      cloud_cover:               cloud,
      uv_index:                  times.map(() => null),   // not available
      snow_depth:                times.map(() => null),   // not available
      snowfall:                  times.map(() => null),   // not available
    },
    daily: {
      time:                          dailyTimes,
      temperature_2m_max:            dailyTmax,
      temperature_2m_min:            dailyTmin,
      precipitation_sum:             dailyPrecip,
      precipitation_probability_max: dailyPrecipP,
      weather_code:                  dailyCodes,
      wind_speed_10m_max:            dailyWind,
      wind_gusts_10m_max:            dailyGust,
    },
  }
}
