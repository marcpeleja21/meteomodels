/**
 * Prediction card — rendered below the alerts banner.
 *
 * Computes hourly weighted-median values across all loaded models
 * starting from the CURRENT HOUR (so a 10 pm check covers tonight + tomorrow,
 * not the already-elapsed hours of today).
 *
 * Features:
 *  • Time-aware: window = [now, now+48h], past hours ignored
 *  • Day/Night split: separate stats for daytime (07:00-20:59) and night
 *    (21:00-06:59) so text says "Day highs 22°C, tonight lows 8°C"
 *  • Wind chill via Canadian/NOAA formula applied per-hour before averaging
 *  • Text variants: seed = hour + location → fresh wording on every reload
 *
 * Wind chill (Canadian/NOAA formula, valid T ≤ 10 °C, V > 4.8 km/h):
 *   WC = 13.12 + 0.6215·T − 11.37·V^0.16 + 0.3965·T·V^0.16
 */
import { state } from '../state'
import type { OpenMeteoResponse } from '../types'
import { computeModelWeights } from '../utils/modelWeights'

// ── Wind chill ────────────────────────────────────────────────────────────────
function windChill(tempC: number, windKmh: number): number {
  if (windKmh <= 4.8 || tempC > 10) return tempC
  const v16 = Math.pow(windKmh, 0.16)
  return 13.12 + 0.6215 * tempC - 11.37 * v16 + 0.3965 * tempC * v16
}

// ── Day/night helper ──────────────────────────────────────────────────────────
/** Returns true if the ISO time string falls in daytime (07:00–20:59 local). */
function isDay(isoTime: string): boolean {
  const h = parseInt(isoTime.slice(11, 13), 10)
  return h >= 7 && h < 21
}

// ── Variant seed ──────────────────────────────────────────────────────────────
/** Changes every hour + varies by location → different phrasing on each reload */
function variantSeed(): number {
  const h   = Math.floor(Date.now() / 3_600_000)
  const loc = state.currentLoc
  const lh  = loc ? Math.round(loc.latitude  * 10) : 0
  const lnh = loc ? Math.round(loc.longitude * 10) : 0
  return Math.abs((h * 31 + lh * 7 + lnh * 13) % 1_000_003)
}

// ── Model weights ─────────────────────────────────────────────────────────────
/**
 * weightedAvg uses location-aware dynamic weights computed by computeModelWeights().
 * Falls back to a simple average when no location is available.
 */
let _cachedWeights: Record<string, number> = {}
let _weightsLocKey = ''

function getWeights(keys: string[]): Record<string, number> {
  const loc = state.currentLoc
  if (!loc) {
    // Equal weights when no location loaded yet
    const eq: Record<string, number> = {}
    keys.forEach(k => { eq[k] = 1 / keys.length })
    return eq
  }
  // Re-compute only when location or key-set changes
  const locKey = `${loc.latitude.toFixed(3)},${loc.longitude.toFixed(3)}:${keys.slice().sort().join(',')}`
  if (locKey !== _weightsLocKey) {
    _cachedWeights = computeModelWeights(keys, loc.latitude, loc.longitude)
    _weightsLocKey = locKey
  }
  return _cachedWeights
}

function weightedAvg(vals: Array<{ k: string; v: number }>): number {
  if (!vals.length) return 0
  if (vals.length === 1) return vals[0].v
  const keys    = vals.map(x => x.k)
  const weights = getWeights(keys)
  // Re-normalise for this specific subset (some keys may have been absent)
  let wSum = 0
  for (const x of vals) wSum += weights[x.k] ?? 0
  if (wSum === 0) return vals.reduce((s, x) => s + x.v, 0) / vals.length
  let result = 0
  for (const x of vals) result += x.v * ((weights[x.k] ?? 0) / wSum)
  return result
}

/** Expose current weights for the tooltip in mainCard.ts */
export function getCurrentModelWeights(): Record<string, number> {
  return { ..._cachedWeights }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
interface Stats48h {
  // Overall (used by clothes advice + condition icon)
  avgTemp:      number
  minTemp:      number
  maxTemp:      number
  totalPrecip:  number   // mm over full 48 h
  maxWind:      number   // km/h gusts (daily max)
  avgWind:      number   // km/h sustained average
  avgFeelsLike: number   // wind-chill-adjusted
  minFeelsLike: number

  hasStorm: boolean

  // Daytime segment (07:00–20:59 local)
  dayMaxTemp:    number | null
  dayMinTemp:    number | null
  dayAvgTemp:    number | null
  dayPrecip:     number        // mm during day hours
  dayAvgFL:      number | null // feels-like during day
  hasDayData:    boolean

  // Nighttime segment (21:00–06:59 local)
  nightMinTemp:  number | null
  nightMaxTemp:  number | null
  nightAvgTemp:  number | null
  nightPrecip:   number        // mm during night hours
  nightAvgFL:    number | null // feels-like at night
  hasNightData:  boolean

  // Per-calendar-day breakdown (today vs tomorrow) for day-labelling
  todayPrecip:        number
  tomorrowPrecip:     number
  todayAvgFL:         number | null
  tomorrowAvgFL:      number | null
  todayDayMaxTemp:    number | null   // max temp in daytime hours today
  tomorrowDayMaxTemp: number | null   // max temp in daytime hours tomorrow
  todayMaxWind:       number          // max hourly wind speed today
  tomorrowMaxWind:    number          // max hourly wind speed tomorrow

  // Per-calendar-day day/night precip split
  todayDayPrecip:     number   // precip during daytime today (07-21)
  todayNightPrecip:   number   // precip during nighttime today (21-07)
  tomorrowDayPrecip:  number   // precip during daytime tomorrow
  tomorrowNightPrecip:number   // precip during nighttime tomorrow

  // Per-calendar-day night min temps
  todayNightMinTemp:    number | null
  tomorrowNightMinTemp: number | null
}

function compute48hStats(
  wxData: Record<string, OpenMeteoResponse | null>,
): Stats48h | null {
  const now = Date.now()
  const end = now + 48 * 3600_000

  // Determine how many daily slots overlap with the 48 h window
  const todayStart = (() => {
    const d = new Date(now)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  })()
  const gustDayCount = Math.min(3, Math.ceil((end - todayStart) / 86_400_000))

  type MV = { k: string; v: number }
  const tempMap:      Map<string, MV[]> = new Map()
  const precipMap:    Map<string, MV[]> = new Map()
  const windMap:      Map<string, MV[]> = new Map()
  const codeMap:      Map<string, MV[]> = new Map()
  const gustVals:     MV[] = []

  // Day/night per-timestep accumulation
  const dayTempMap:  Map<string, MV[]> = new Map()
  const dayWindMap:  Map<string, MV[]> = new Map()
  const dayPrecipTs: Map<string, MV[]> = new Map()
  const ntTempMap:   Map<string, MV[]> = new Map()
  const ntWindMap:   Map<string, MV[]> = new Map()
  const ntPrecipTs:  Map<string, MV[]> = new Map()

  for (const [modelKey, data] of Object.entries(wxData)) {
    if (!data?.hourly) continue
    const { time, temperature_2m, precipitation, wind_speed_10m, weather_code } = data.hourly

    for (let i = 0; i < time.length; i++) {
      const ts = new Date(time[i]).getTime()
      if (ts < now)  continue
      if (ts > end)  continue

      const k   = time[i]
      const day = isDay(k)

      // Overall maps
      if (!tempMap.has(k)) {
        tempMap.set(k, []); precipMap.set(k, [])
        windMap.set(k, []); codeMap.set(k, [])
      }
      if (temperature_2m?.[i] != null) tempMap.get(k)!.push({ k: modelKey, v: temperature_2m[i]! })
      if (precipitation?.[i]  != null) precipMap.get(k)!.push({ k: modelKey, v: precipitation[i]! })
      if (wind_speed_10m?.[i] != null) windMap.get(k)!.push({ k: modelKey, v: wind_speed_10m[i]! })
      if (weather_code?.[i]   != null) codeMap.get(k)!.push({ k: modelKey, v: weather_code[i]! })

      // Day/night split maps
      const tMap = day ? dayTempMap  : ntTempMap
      const wMap = day ? dayWindMap  : ntWindMap
      const pMap = day ? dayPrecipTs : ntPrecipTs
      if (!tMap.has(k)) { tMap.set(k, []); wMap.set(k, []); pMap.set(k, []) }
      if (temperature_2m?.[i] != null) tMap.get(k)!.push({ k: modelKey, v: temperature_2m[i]! })
      if (wind_speed_10m?.[i] != null) wMap.get(k)!.push({ k: modelKey, v: wind_speed_10m[i]! })
      if (precipitation?.[i]  != null) pMap.get(k)!.push({ k: modelKey, v: precipitation[i]! })
    }

    // Gusts from daily data
    const dg = data.daily?.wind_gusts_10m_max
    if (dg) {
      for (let d = 0; d < Math.min(gustDayCount, dg.length); d++) {
        if (dg[d] != null) gustVals.push({ k: modelKey, v: dg[d]! })
      }
    }
  }

  if (!tempMap.size) return null

  // ── Overall aggregation ───────────────────────────────────────────────────
  const wTemps:     number[] = []
  const wPrecip:    number[] = []
  const wWinds:     number[] = []
  const wFeelsLike: number[] = []
  let   hasStorm = false

  for (const k of tempMap.keys()) {
    const tVals = tempMap.get(k)!
    const pVals = precipMap.get(k) ?? []
    const wVals = windMap.get(k) ?? []
    const cVals = codeMap.get(k) ?? []
    if (tVals.length) {
      const t = weightedAvg(tVals)
      const w = wVals.length ? weightedAvg(wVals) : 0
      wTemps.push(t)
      wFeelsLike.push(windChill(t, w))
    }
    if (pVals.length) wPrecip.push(weightedAvg(pVals))
    if (wVals.length) wWinds.push(weightedAvg(wVals))
    if (cVals.length && weightedAvg(cVals) >= 95) hasStorm = true
  }

  if (!wTemps.length) return null

  const avgTemp = wTemps.reduce((a, b) => a + b, 0) / wTemps.length
  const avgFL   = wFeelsLike.reduce((a, b) => a + b, 0) / wFeelsLike.length
  const avgWind = wWinds.length ? wWinds.reduce((a, b) => a + b, 0) / wWinds.length : 0
  const maxWind = gustVals.length
    ? weightedAvg(gustVals)
    : (wWinds.length ? Math.max(...wWinds) : 0)
  const totalPrecip = wPrecip.reduce((a, b) => a + b, 0)

  // ── Day segment ───────────────────────────────────────────────────────────
  function segStats(
    tMap: Map<string, MV[]>,
    wMap: Map<string, MV[]>,
    pMap: Map<string, MV[]>,
  ): { avg: number; min: number; max: number; precip: number; avgFL: number } | null {
    if (!tMap.size) return null
    const ts: number[] = [], ws: number[] = [], ps: number[] = [], fls: number[] = []
    for (const k of tMap.keys()) {
      const tv = tMap.get(k)!
      const wv = wMap.get(k) ?? []
      const pv = pMap.get(k) ?? []
      if (tv.length) {
        const t = weightedAvg(tv)
        const w = wv.length ? weightedAvg(wv) : 0
        ts.push(t); fls.push(windChill(t, w))
      }
      if (pv.length) ps.push(weightedAvg(pv))
      if (wv.length) ws.push(weightedAvg(wv))
    }
    if (!ts.length) return null
    return {
      avg:    ts.reduce((a, b) => a + b, 0) / ts.length,
      min:    Math.min(...ts),
      max:    Math.max(...ts),
      precip: ps.reduce((a, b) => a + b, 0),
      avgFL:  fls.reduce((a, b) => a + b, 0) / fls.length,
    }
  }

  const daySeg = segStats(dayTempMap, dayWindMap, dayPrecipTs)
  const ntSeg  = segStats(ntTempMap,  ntWindMap,  ntPrecipTs)

  // ── Per-calendar-day breakdown ────────────────────────────────────────────
  const todayDateStr = new Date(now).toISOString().slice(0, 10)
  const tomDateStr   = new Date(now + 86_400_000).toISOString().slice(0, 10)

  let   todayPrecipAcc = 0, tomPrecipAcc = 0
  const todayFLs: number[] = [], tomFLs: number[] = []
  const todayWindSpds: number[] = [], tomWindSpds: number[] = []
  const todayDayMaxTs: number[] = [], tomDayMaxTs: number[] = []
  let   todayDayPrecipAcc = 0, todayNightPrecipAcc = 0
  let   tomDayPrecipAcc   = 0, tomNightPrecipAcc   = 0
  const todayNightMinTs: number[] = [], tomNightMinTs: number[] = []

  for (const k of tempMap.keys()) {
    const dateStr = k.slice(0, 10)
    const tVals   = tempMap.get(k)!
    const wVals   = windMap.get(k) ?? []
    const pVals   = precipMap.get(k) ?? []
    if (!tVals.length) continue
    const t  = weightedAvg(tVals)
    const w  = wVals.length ? weightedAvg(wVals) : 0
    const fl = windChill(t, w)
    const p  = pVals.length ? weightedAvg(pVals) : 0
    if (dateStr === todayDateStr) {
      todayPrecipAcc += p
      todayFLs.push(fl)
      if (wVals.length) todayWindSpds.push(w)
      if (isDay(k)) {
        todayDayMaxTs.push(t)
        todayDayPrecipAcc += p
      } else {
        todayNightPrecipAcc += p
        todayNightMinTs.push(t)
      }
    } else if (dateStr === tomDateStr) {
      tomPrecipAcc += p
      tomFLs.push(fl)
      if (wVals.length) tomWindSpds.push(w)
      if (isDay(k)) {
        tomDayMaxTs.push(t)
        tomDayPrecipAcc += p
      } else {
        tomNightPrecipAcc += p
        tomNightMinTs.push(t)
      }
    }
  }

  return {
    avgTemp,
    minTemp:      Math.min(...wTemps),
    maxTemp:      Math.max(...wTemps),
    totalPrecip,
    maxWind,
    avgWind:      Math.round(avgWind),
    avgFeelsLike: avgFL,
    minFeelsLike: Math.min(...wFeelsLike),
    hasStorm,

    dayMaxTemp:  daySeg ? daySeg.max   : null,
    dayMinTemp:  daySeg ? daySeg.min   : null,
    dayAvgTemp:  daySeg ? daySeg.avg   : null,
    dayPrecip:   daySeg ? daySeg.precip : 0,
    dayAvgFL:    daySeg ? daySeg.avgFL  : null,
    hasDayData:  daySeg !== null,

    nightMinTemp: ntSeg ? ntSeg.min    : null,
    nightMaxTemp: ntSeg ? ntSeg.max    : null,
    nightAvgTemp: ntSeg ? ntSeg.avg    : null,
    nightPrecip:  ntSeg ? ntSeg.precip : 0,
    nightAvgFL:   ntSeg ? ntSeg.avgFL  : null,
    hasNightData: ntSeg !== null,

    todayPrecip:        todayPrecipAcc,
    tomorrowPrecip:     tomPrecipAcc,
    todayAvgFL:         todayFLs.length   ? todayFLs.reduce((a,b)=>a+b,0)/todayFLs.length : null,
    tomorrowAvgFL:      tomFLs.length     ? tomFLs.reduce((a,b)=>a+b,0)/tomFLs.length     : null,
    todayDayMaxTemp:    todayDayMaxTs.length ? Math.max(...todayDayMaxTs) : null,
    tomorrowDayMaxTemp: tomDayMaxTs.length   ? Math.max(...tomDayMaxTs)   : null,
    todayMaxWind:       todayWindSpds.length ? Math.max(...todayWindSpds) : 0,
    tomorrowMaxWind:    tomWindSpds.length   ? Math.max(...tomWindSpds)   : 0,
    todayDayPrecip:     todayDayPrecipAcc,
    todayNightPrecip:   todayNightPrecipAcc,
    tomorrowDayPrecip:  tomDayPrecipAcc,
    tomorrowNightPrecip:tomNightPrecipAcc,
    todayNightMinTemp:    todayNightMinTs.length ? Math.min(...todayNightMinTs) : null,
    tomorrowNightMinTemp: tomNightMinTs.length   ? Math.min(...tomNightMinTs)   : null,
  }
}

// ── Text helpers ──────────────────────────────────────────────────────────────
type LangMap = Record<'ca' | 'es' | 'en' | 'fr', string>

function pick(m: LangMap, lang: string): string {
  return (m as Record<string, string>)[lang] ?? m.en
}
function pickV<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]
}

// ── Prediction text (today + tomorrow narrative) ──────────────────────────────
/* eslint-disable prefer-template */
function generatePrediction(s: Stats48h, lang: string): string {
  const wnd     = Math.round(s.maxWind)
  const windDesc = pick({
    ca: 'Ratxes fins a ' + wnd + '\u00a0km/h.',
    es: 'Rachas hasta ' + wnd + '\u00a0km/h.',
    en: 'Gusts up to ' + wnd + '\u00a0km/h.',
    fr: 'Rafales jusqu\'\u00e0 ' + wnd + '\u00a0km/h.',
  }, lang)
  const windMod = pick({
    ca: 'Vent moderat, ',
    es: 'Viento moderado, ',
    en: 'Moderate winds, ',
    fr: 'Vent mod\u00e9r\u00e9, ',
  }, lang)
  const windFull = s.maxWind > 30 ? windMod + windDesc.charAt(0).toLowerCase() + windDesc.slice(1) : windDesc

  // ── Today values ──
  const todayMax     = s.todayDayMaxTemp    != null ? Math.round(s.todayDayMaxTemp)    : Math.round(s.maxTemp)
  const todayNightMin= s.todayNightMinTemp  != null ? Math.round(s.todayNightMinTemp)  : Math.round(s.minTemp)
  const todayRain    = s.todayPrecip
  const todayDayRain = Math.round(s.todayDayPrecip)
  const todayNightRain = Math.round(s.todayNightPrecip)

  // ── Tomorrow values ──
  const tomMax       = s.tomorrowDayMaxTemp   != null ? Math.round(s.tomorrowDayMaxTemp)   : null
  const tomNightMin  = s.tomorrowNightMinTemp != null ? Math.round(s.tomorrowNightMinTemp) : Math.round(s.minTemp)
  const tomRain      = s.tomorrowPrecip
  const tomDayRain   = Math.round(s.tomorrowDayPrecip)
  const tomNightRain = Math.round(s.tomorrowNightPrecip)
  const tomMaxStr    = tomMax != null ? String(tomMax) : String(Math.round(s.maxTemp))

  // ── Helpers ──
  const rainSplit = (dayMm: number, nightMm: number): string => {
    const parts: string[] = []
    if (dayMm > 0.5) parts.push(pick({ ca: dayMm + 'mm de dia', es: dayMm + 'mm de d\u00eda', en: dayMm + 'mm daytime', fr: dayMm + 'mm dans la journ\u00e9e' }, lang))
    if (nightMm > 0.5) parts.push(pick({ ca: nightMm + 'mm de nit', es: nightMm + 'mm de noche', en: nightMm + 'mm overnight', fr: nightMm + 'mm la nuit' }, lang))
    return parts.join(', ')
  }

  const qualityToday = (max: number): string => {
    if (max >= 28) return pick({ ca: 'calorós', es: 'caluroso', en: 'hot', fr: 'chaud' }, lang)
    if (max >= 22) return pick({ ca: 'agradable', es: 'agradable', en: 'pleasant', fr: 'agr\u00e9able' }, lang)
    if (max >= 15) return pick({ ca: 'fresc', es: 'fresco', en: 'cool', fr: 'frais' }, lang)
    return pick({ ca: 'fred', es: 'fr\u00edo', en: 'cold', fr: 'froid' }, lang)
  }

  // ── TODAY part ──
  let todayPart: string
  if (s.hasStorm && todayRain > 2) {
    todayPart = pick({
      ca: 'Avui tempestes amb ' + Math.round(todayRain) + 'mm. M\u00e0x ' + todayMax + '\u00b0C, m\u00edn ' + todayNightMin + '\u00b0C.',
      es: 'Hoy tormentas con ' + Math.round(todayRain) + 'mm. M\u00e1x ' + todayMax + '\u00b0C, m\u00edn ' + todayNightMin + '\u00b0C.',
      en: 'Today storms with ' + Math.round(todayRain) + 'mm. High ' + todayMax + '\u00b0C, low ' + todayNightMin + '\u00b0C.',
      fr: "Aujourd'hui orages avec " + Math.round(todayRain) + 'mm. Max ' + todayMax + '\u00b0C, min ' + todayNightMin + '\u00b0C.',
    }, lang)
  } else if (todayRain > 3) {
    const split = rainSplit(todayDayRain, todayNightRain)
    todayPart = pick({
      ca: 'Avui temps pluj\u00f3s' + (split ? ' (' + split + ')' : ': ' + Math.round(todayRain) + 'mm') + '. M\u00e0x ' + todayMax + '\u00b0C, m\u00edn ' + todayNightMin + '\u00b0C.',
      es: 'Hoy tiempo lluvioso' + (split ? ' (' + split + ')' : ': ' + Math.round(todayRain) + 'mm') + '. M\u00e1x ' + todayMax + '\u00b0C, m\u00edn ' + todayNightMin + '\u00b0C.',
      en: 'Today rainy' + (split ? ' (' + split + ')' : ': ' + Math.round(todayRain) + 'mm') + '. High ' + todayMax + '\u00b0C, low ' + todayNightMin + '\u00b0C.',
      fr: "Aujourd'hui pluvieux" + (split ? ' (' + split + ')' : '\u00a0: ' + Math.round(todayRain) + 'mm') + '. Max ' + todayMax + '\u00b0C, min ' + todayNightMin + '\u00b0C.',
    }, lang)
  } else if (todayRain > 0.5) {
    todayPart = pick({
      ca: 'Avui algun ruixat possible (' + Math.round(todayRain) + 'mm). M\u00e0x ' + todayMax + '\u00b0C, m\u00edn ' + todayNightMin + '\u00b0C.',
      es: 'Hoy alg\u00fan chubasco posible (' + Math.round(todayRain) + 'mm). M\u00e1x ' + todayMax + '\u00b0C, m\u00edn ' + todayNightMin + '\u00b0C.',
      en: 'Today a few showers possible (' + Math.round(todayRain) + 'mm). High ' + todayMax + '\u00b0C, low ' + todayNightMin + '\u00b0C.',
      fr: "Aujourd'hui quelques averses possibles (" + Math.round(todayRain) + 'mm). Max ' + todayMax + '\u00b0C, min ' + todayNightMin + '\u00b0C.',
    }, lang)
  } else {
    const q = qualityToday(todayMax)
    todayPart = pick({
      ca: 'Avui temps ' + q + ' sense precipitaci\u00f3. M\u00e0x ' + todayMax + '\u00b0C, m\u00edn ' + todayNightMin + '\u00b0C.',
      es: 'Hoy tiempo ' + q + ' sin precipitaci\u00f3n. M\u00e1x ' + todayMax + '\u00b0C, m\u00edn ' + todayNightMin + '\u00b0C.',
      en: 'Today ' + q + ' with no rain. High ' + todayMax + '\u00b0C, low ' + todayNightMin + '\u00b0C.',
      fr: "Aujourd'hui temps " + q + ' sans pr\u00e9cipitation. Max ' + todayMax + '\u00b0C, min ' + todayNightMin + '\u00b0C.',
    }, lang)
  }

  // ── TOMORROW part ──
  let tomPart: string
  const isChangeToRain = todayRain < 2 && tomRain > 3
  const isChangeToFair = todayRain > 3 && tomRain < 1
  const tempShift      = (tomMax != null && s.todayDayMaxTemp != null) ? tomMax - Math.round(s.todayDayMaxTemp) : 0

  if (s.hasStorm && tomRain > 2) {
    tomPart = pick({
      ca: 'Dem\u00e0 tempestes amb ' + Math.round(tomRain) + 'mm. M\u00e0x ' + tomMaxStr + '\u00b0C, m\u00edn ' + tomNightMin + '\u00b0C.',
      es: 'Ma\u00f1ana tormentas con ' + Math.round(tomRain) + 'mm. M\u00e1x ' + tomMaxStr + '\u00b0C, m\u00edn ' + tomNightMin + '\u00b0C.',
      en: 'Tomorrow storms with ' + Math.round(tomRain) + 'mm. High ' + tomMaxStr + '\u00b0C, low ' + tomNightMin + '\u00b0C.',
      fr: 'Demain orages avec ' + Math.round(tomRain) + 'mm. Max ' + tomMaxStr + '\u00b0C, min ' + tomNightMin + '\u00b0C.',
    }, lang)
  } else if (tomRain > 3) {
    const split = rainSplit(tomDayRain, tomNightRain)
    // Decide which part dominates (day vs night)
    const mainlyNight = tomNightRain > tomDayRain * 1.5 && tomNightRain > 1
    const mainlyDay   = tomDayRain   > tomNightRain * 1.5 && tomDayRain > 1
    const timingNote  = mainlyNight
      ? pick({ ca: ', sobretot de nit', es: ', sobre todo de noche', en: ', mainly overnight', fr: ', surtout la nuit' }, lang)
      : mainlyDay
        ? pick({ ca: ', principalment de dia', es: ', principalmente de d\u00eda', en: ', mainly during the day', fr: ', principalement dans la journ\u00e9e' }, lang)
        : ''
    if (isChangeToRain) {
      tomPart = pick({
        ca: 'Per dem\u00e0 canvi de temps amb pluja esperada' + (split ? ' (' + split + ')' : ': ' + Math.round(tomRain) + 'mm') + timingNote + '. M\u00e0x ' + tomMaxStr + '\u00b0C, m\u00edn ' + tomNightMin + '\u00b0C.',
        es: 'Para ma\u00f1ana cambio de tiempo con lluvia esperada' + (split ? ' (' + split + ')' : ': ' + Math.round(tomRain) + 'mm') + timingNote + '. M\u00e1x ' + tomMaxStr + '\u00b0C, m\u00edn ' + tomNightMin + '\u00b0C.',
        en: 'Tomorrow a change in weather with expected rain' + (split ? ' (' + split + ')' : ': ' + Math.round(tomRain) + 'mm') + timingNote + '. High ' + tomMaxStr + '\u00b0C, low ' + tomNightMin + '\u00b0C.',
        fr: 'Demain changement de temps avec pluie pr\u00e9vue' + (split ? ' (' + split + ')' : '\u00a0: ' + Math.round(tomRain) + 'mm') + timingNote + '. Max ' + tomMaxStr + '\u00b0C, min ' + tomNightMin + '\u00b0C.',
      }, lang)
    } else {
      tomPart = pick({
        ca: 'Dem\u00e0 continua el temps pluj\u00f3s' + (split ? ' (' + split + ')' : ': ' + Math.round(tomRain) + 'mm') + timingNote + '. M\u00e0x ' + tomMaxStr + '\u00b0C, m\u00edn ' + tomNightMin + '\u00b0C.',
        es: 'Ma\u00f1ana contin\u00faa el tiempo lluvioso' + (split ? ' (' + split + ')' : ': ' + Math.round(tomRain) + 'mm') + timingNote + '. M\u00e1x ' + tomMaxStr + '\u00b0C, m\u00edn ' + tomNightMin + '\u00b0C.',
        en: 'Tomorrow rain continues' + (split ? ' (' + split + ')' : ': ' + Math.round(tomRain) + 'mm') + timingNote + '. High ' + tomMaxStr + '\u00b0C, low ' + tomNightMin + '\u00b0C.',
        fr: 'Demain la pluie continue' + (split ? ' (' + split + ')' : '\u00a0: ' + Math.round(tomRain) + 'mm') + timingNote + '. Max ' + tomMaxStr + '\u00b0C, min ' + tomNightMin + '\u00b0C.',
      }, lang)
    }
  } else if (tomRain > 0.5) {
    tomPart = pick({
      ca: 'Dem\u00e0 algun ruixat possible (' + Math.round(tomRain) + 'mm). M\u00e0x ' + tomMaxStr + '\u00b0C.',
      es: 'Ma\u00f1ana alg\u00fan chubasco posible (' + Math.round(tomRain) + 'mm). M\u00e1x ' + tomMaxStr + '\u00b0C.',
      en: 'Tomorrow a few showers possible (' + Math.round(tomRain) + 'mm). High ' + tomMaxStr + '\u00b0C.',
      fr: 'Demain quelques averses possibles (' + Math.round(tomRain) + 'mm). Max ' + tomMaxStr + '\u00b0C.',
    }, lang)
  } else if (isChangeToFair) {
    const q = qualityToday(tomMax ?? 20)
    tomPart = pick({
      ca: 'Dem\u00e0 millora amb temps ' + q + ' i sense pluja. M\u00e0x ' + tomMaxStr + '\u00b0C.',
      es: 'Ma\u00f1ana mejora con tiempo ' + q + ' y sin lluvia. M\u00e1x ' + tomMaxStr + '\u00b0C.',
      en: 'Tomorrow improving with ' + q + ' and dry conditions. High ' + tomMaxStr + '\u00b0C.',
      fr: 'Demain am\u00e9lioration avec temps ' + q + ' et sec. Max ' + tomMaxStr + '\u00b0C.',
    }, lang)
  } else {
    const q = qualityToday(tomMax ?? 20)
    const tempNote = Math.abs(tempShift) >= 4
      ? (tempShift > 0
          ? pick({ ca: ', m\u00e9s c\u00e0lid (+' + tempShift + '\u00b0C)', es: ', m\u00e1s c\u00e1lido (+' + tempShift + '\u00b0C)', en: ', warmer (+' + tempShift + '\u00b0C)', fr: ', plus chaud (+' + tempShift + '\u00b0C)' }, lang)
          : pick({ ca: ', m\u00e9s fresc (' + tempShift + '\u00b0C)', es: ', m\u00e1s fresco (' + tempShift + '\u00b0C)', en: ', cooler (' + tempShift + '\u00b0C)', fr: ', plus frais (' + tempShift + '\u00b0C)' }, lang))
      : ''
    tomPart = pick({
      ca: 'Dem\u00e0 temps ' + q + ' sense pluja' + tempNote + '. M\u00e0x ' + tomMaxStr + '\u00b0C.',
      es: 'Ma\u00f1ana tiempo ' + q + ' sin lluvia' + tempNote + '. M\u00e1x ' + tomMaxStr + '\u00b0C.',
      en: 'Tomorrow ' + q + ' with no rain' + tempNote + '. High ' + tomMaxStr + '\u00b0C.',
      fr: 'Demain temps ' + q + ' sans pluie' + tempNote + '. Max ' + tomMaxStr + '\u00b0C.',
    }, lang)
  }

  return todayPart + ' ' + tomPart + ' ' + windFull
}
/* eslint-enable prefer-template */

// ── Clothes advice ────────────────────────────────────────────────────────────
function generateClothesAdvice(s: Stats48h, lang: string): string {
  const fl        = s.avgFeelsLike
  const mfl       = s.minFeelsLike
  const wnd       = Math.round(s.maxWind)
  const hasRain   = s.totalPrecip > 1
  const heavyRain = s.totalPrecip > 10
  const hasSnow   = s.maxTemp < 3 && s.totalPrecip > 0.5
  const veryWindy = s.maxWind > 55
  const windy     = s.maxWind > 35
  const wcDiff    = s.avgTemp - fl
  const hasWC     = wcDiff >= 4 && s.avgTemp <= 15
  const seed      = variantSeed()

  const wcSuffix = hasWC ? pick({
    ca: ' La sensació tèrmica és de ' + Math.round(fl) + '\u00b0C pel vent (' + wnd + 'km/h).',
    es: ' La sensación térmica es de ' + Math.round(fl) + '\u00b0C por el viento (' + wnd + 'km/h).',
    en: ' Wind chill makes it feel like ' + Math.round(fl) + '\u00b0C (' + wnd + 'km/h wind).',
    fr: ' Le vent (' + wnd + 'km/h) fait ressentir ' + Math.round(fl) + '\u00b0C.',
  }, lang) : ''

  // ── Snow ──
  if (hasSnow) return pickV([
    pick({
      ca: 'Abric d\'hivern, capes tèrmiques, guants, gorra, bufanda i botes impermeables antilliscants imprescindibles.' + wcSuffix,
      es: 'Abrigo de invierno, capas térmicas, guantes, gorro, bufanda y botas impermeables antideslizantes imprescindibles.' + wcSuffix,
      en: 'Heavy winter coat, thermal layers, gloves, warm hat, scarf and waterproof non-slip boots are all essential.' + wcSuffix,
      fr: 'Manteau d\'hiver, couches thermiques, gants, bonnet, écharpe et bottes imperméables antidérapantes indispensables.' + wcSuffix,
    }, lang),
    pick({
      ca: 'Nevada prevista: roba tèrmica en capes, abric impermeable, botes d\'hivern, guants i gorra. Evita superfícies exteriors sense calçat adequat.' + wcSuffix,
      es: 'Nevada prevista: ropa térmica en capas, abrigo impermeable, botas de invierno, guantes y gorro. Evita superficies exteriores sin calzado adecuado.' + wcSuffix,
      en: 'Snow ahead: thermal layers, waterproof coat, winter boots, gloves and hat. Avoid outdoor surfaces without proper non-slip footwear.' + wcSuffix,
      fr: 'Neige prévue\u00a0: vêtements thermiques en couches, manteau imperméable, bottes d\'hiver, gants et bonnet. Évitez les surfaces extérieures sans chaussures adaptées.' + wcSuffix,
    }, lang),
  ], seed)

  // ── Extreme cold (feels-like < 0) ──
  if (fl < 0) return pickV([
    pick({
      ca: 'Fred extrem: abric d\'hivern, guants tèrmics, gorra, bufanda gruixuda i botes d\'hivern. Sensació mínima de ' + Math.round(mfl) + '\u00b0C.' + (veryWindy ? ' Para-vent obligatori.' : ''),
      es: 'Frío extremo: abrigo de invierno, guantes térmicos, gorro, bufanda gruesa y botas de invierno. Sensación mínima de ' + Math.round(mfl) + '\u00b0C.' + (veryWindy ? ' Cortavientos obligatorio.' : ''),
      en: 'Extreme cold: heavy winter coat, thermal gloves, hat, thick scarf and winter boots. Wind chill down to ' + Math.round(mfl) + '\u00b0C.' + (veryWindy ? ' Windproof layer mandatory.' : ''),
      fr: 'Grand froid\u00a0: manteau d\'hiver, gants thermiques, bonnet, écharpe épaisse, bottes d\'hiver. Ressenti jusqu\'à ' + Math.round(mfl) + '\u00b0C.' + (veryWindy ? ' Coupe-vent obligatoire.' : ''),
    }, lang),
    pick({
      ca: 'Temperatura real sota zero (mínima de ' + Math.round(mfl) + '\u00b0C). Abric gruixut, capes tèrmiques, guants impermeables i botes d\'hivern.' + (veryWindy ? ' Vent fort: protecció facial recomanada.' : ''),
      es: 'Temperatura real bajo cero (mínima de ' + Math.round(mfl) + '\u00b0C). Abrigo grueso, capas térmicas, guantes impermeables y botas de invierno.' + (veryWindy ? ' Viento fuerte: protección facial recomendada.' : ''),
      en: 'Real-feel below zero (min ' + Math.round(mfl) + '\u00b0C). Thick coat, thermal layers, waterproof gloves and winter boots.' + (veryWindy ? ' Strong wind: face protection advised.' : ''),
      fr: 'Ressenti sous zéro (min ' + Math.round(mfl) + '\u00b0C). Manteau épais, couches thermiques, gants imperméables et bottes d\'hiver.' + (veryWindy ? ' Vent fort\u00a0: protection du visage conseillée.' : ''),
    }, lang),
  ], seed)

  // ── Very cold (feels-like < 5) ──
  if (fl < 5) return pickV([
    pick({
      ca: veryWindy
        ? 'Abric d\'hivern, bufanda, guants i gorra imprescindibles. Molt ventós (' + wnd + 'km/h): sensació de ' + Math.round(fl) + '\u00b0C. Capa para-vent necessària.'
        : 'Abric d\'hivern, bufanda, guants i gorra imprescindibles. Fred intens' + (hasWC ? ' amb sensació de ' + Math.round(fl) + '\u00b0C pel vent.' : ': capes tèrmiques per mantenir la calor.'),
      es: veryWindy
        ? 'Abrigo de invierno, bufanda, guantes y gorro imprescindibles. Muy ventoso (' + wnd + 'km/h): sensación de ' + Math.round(fl) + '\u00b0C. Capa cortavientos necesaria.'
        : 'Abrigo de invierno, bufanda, guantes y gorro imprescindibles. Frío intenso' + (hasWC ? ' con sensación de ' + Math.round(fl) + '\u00b0C por el viento.' : ': capas térmicas para mantener el calor.'),
      en: veryWindy
        ? 'Heavy coat, scarf, gloves and hat essential. Very windy (' + wnd + 'km/h): feels like ' + Math.round(fl) + '\u00b0C. A windproof outer layer is needed.'
        : 'Heavy coat, scarf, gloves and hat essential. Intense cold' + (hasWC ? ' — feels like ' + Math.round(fl) + '\u00b0C with wind chill.' : ': thermal underlayers to retain body heat.'),
      fr: veryWindy
        ? 'Manteau d\'hiver, écharpe, gants et bonnet indispensables. Vent fort (' + wnd + 'km/h)\u00a0: ressenti ' + Math.round(fl) + '\u00b0C. Coupe-vent nécessaire.'
        : 'Manteau d\'hiver, écharpe, gants et bonnet indispensables. Grand froid' + (hasWC ? '\u00a0: ressenti ' + Math.round(fl) + '\u00b0C avec le vent.' : '\u00a0: sous-couches thermiques conseillées.'),
    }, lang),
    pick({
      ca: 'Temperatures molt baixes (sensació de ' + Math.round(fl) + '\u00b0C). Abric gruixut, roba interior tèrmica, guants i calçat impermeable tancat.' + (veryWindy ? ' Para-vent essencial amb ' + wnd + 'km/h de ratxa.' : ' Protegeix cap i mans.'),
      es: 'Temperaturas muy bajas (sensación de ' + Math.round(fl) + '\u00b0C). Abrigo grueso, ropa interior térmica, guantes y calzado impermeable cerrado.' + (veryWindy ? ' Cortavientos esencial con rachas de ' + wnd + 'km/h.' : ' Protege cabeza y manos.'),
      en: 'Very low temperatures (feels like ' + Math.round(fl) + '\u00b0C). Thick coat, thermal underwear, gloves and waterproof closed footwear.' + (veryWindy ? ' Windproof layer essential at ' + wnd + 'km/h gusts.' : ' Cover head and hands.'),
      fr: 'Températures très basses (ressenti ' + Math.round(fl) + '\u00b0C). Manteau épais, sous-vêtements thermiques, gants et chaussures imperméables fermées.' + (veryWindy ? ' Coupe-vent essentiel à ' + wnd + 'km/h.' : ' Couvrez tête et mains.'),
    }, lang),
  ], seed)

  // ── Cold (feels-like < 12) ──
  if (fl < 12) {
    if (heavyRain) return pickV([
      pick({
        ca: 'Jaqueta d\'hivern, jersei gruixut, botes impermeables i paraigua imprescindibles. Pluja intensa prevista.' + wcSuffix,
        es: 'Chaqueta de invierno, jersey grueso, botas impermeables y paraguas imprescindibles. Lluvia intensa prevista.' + wcSuffix,
        en: 'Winter jacket, thick jumper, waterproof boots and umbrella essential. Heavy rain forecast.' + wcSuffix,
        fr: 'Veste d\'hiver, pull épais, bottes imperméables et parapluie indispensables. Fortes pluies prévues.' + wcSuffix,
      }, lang),
      pick({
        ca: 'Pluja intensa i fred: abric impermeable, calçat estanc, paraigua robust i roba de secat ràpid.' + wcSuffix,
        es: 'Lluvia intensa y frío: abrigo impermeable, calzado estanco, paraguas robusto y ropa de secado rápido.' + wcSuffix,
        en: 'Heavy rain and cold: waterproof coat, sealed footwear, sturdy umbrella and quick-dry clothing.' + wcSuffix,
        fr: 'Pluie forte et froid\u00a0: manteau imperméable, chaussures étanches, parapluie robuste et vêtements séchant vite.' + wcSuffix,
      }, lang),
    ], seed)

    if (hasRain) return pickV([
      pick({
        ca: 'Jaqueta tèrmica, jersei i paraigua recomanats. Temps fred i plujós; calçat impermeable.' + wcSuffix,
        es: 'Chaqueta térmica, jersey y paraguas recomendados. Frío y lluvioso; calzado impermeable.' + wcSuffix,
        en: 'Thermal jacket, jumper and umbrella recommended. Cold and rainy; waterproof footwear.' + wcSuffix,
        fr: 'Veste thermique, pull et parapluie recommandés. Froid et pluvieux\u00a0; chaussures imperméables.' + wcSuffix,
      }, lang),
      pick({
        ca: 'Fred i pluja: jaqueta impermeable, roba en capes i calçat tancat resistent a l\'aigua.' + wcSuffix,
        es: 'Frío y lluvia: chaqueta impermeable, ropa en capas y calzado cerrado resistente al agua.' + wcSuffix,
        en: 'Cold and wet: waterproof jacket, layered clothing and water-resistant closed footwear.' + wcSuffix,
        fr: 'Froid et pluie\u00a0: veste imperméable, vêtements en couches et chaussures résistantes à l\'eau.' + wcSuffix,
      }, lang),
    ], seed)

    return pickV([
      pick({
        ca: windy
          ? 'Jaqueta d\'hivern, jersei i capa para-vent. Vent de ' + wnd + 'km/h' + (hasWC ? ' fa sentir ' + Math.round(fl) + '\u00b0C' : '') + ': més fred del que sembla.'
          : 'Jaqueta d\'hivern o abric de mig temps amb jersei. Temps fresc i sec.' + wcSuffix,
        es: windy
          ? 'Chaqueta de invierno, jersey y capa cortavientos. Viento de ' + wnd + 'km/h' + (hasWC ? ' hace sentir ' + Math.round(fl) + '\u00b0C' : '') + ': más frío de lo que parece.'
          : 'Chaqueta de invierno o abrigo de entretiempo con jersey. Fresco y seco.' + wcSuffix,
        en: windy
          ? 'Winter jacket, jumper and windproof layer. ' + wnd + 'km/h wind' + (hasWC ? ' makes it feel like ' + Math.round(fl) + '\u00b0C' : '') + ': colder than it looks.'
          : 'Winter jacket or mid-season coat with a jumper. Cool and dry.' + wcSuffix,
        fr: windy
          ? 'Veste d\'hiver, pull et coupe-vent. Vent de ' + wnd + 'km/h' + (hasWC ? ' fait ressentir ' + Math.round(fl) + '\u00b0C' : '') + '\u00a0: plus froid qu\'il n\'y paraît.'
          : 'Veste d\'hiver ou manteau mi-saison avec pull. Frais et sec.' + wcSuffix,
      }, lang),
      pick({
        ca: windy
          ? 'Sensació de ' + Math.round(fl) + '\u00b0C. Abric de mig temps, jersei i para-vent per als ' + wnd + 'km/h de ratxa.'
          : 'Abric de mig temps i jersei. Ambient fresc però agradable. Capa extra per al vespre.' + wcSuffix,
        es: windy
          ? 'Sensación de ' + Math.round(fl) + '\u00b0C. Abrigo de entretiempo, jersey y cortavientos para las rachas de ' + wnd + 'km/h.'
          : 'Abrigo de entretiempo y jersey. Ambiente fresco pero agradable. Capa extra para la tarde.' + wcSuffix,
        en: windy
          ? 'Feels like ' + Math.round(fl) + '\u00b0C. Mid-season coat, jumper and windproof for the ' + wnd + 'km/h gusts.'
          : 'Mid-season coat and jumper. Cool but pleasant. Extra layer for the evening.' + wcSuffix,
        fr: windy
          ? 'Ressenti ' + Math.round(fl) + '\u00b0C. Manteau mi-saison, pull et coupe-vent pour les rafales de ' + wnd + 'km/h.'
          : 'Manteau mi-saison et pull. Frais mais agréable. Couche supplémentaire pour le soir.' + wcSuffix,
      }, lang),
    ], seed)
  }

  // ── Mild (feels-like < 18) ──
  if (fl < 18) {
    if (hasRain) return pickV([
      pick({
        ca: 'Jaqueta lleugera impermeable i paraigua recomanats. Temps fresc amb pluja; calçat resistent a l\'aigua.' + wcSuffix,
        es: 'Chaqueta ligera impermeable y paraguas recomendados. Fresco con lluvia; calzado resistente al agua.' + wcSuffix,
        en: 'Light waterproof jacket and umbrella recommended. Cool and wet; water-resistant footwear.' + wcSuffix,
        fr: 'Veste légère imperméable et parapluie recommandés. Frais et pluvieux\u00a0; chaussures résistantes à l\'eau.' + wcSuffix,
      }, lang),
      pick({
        ca: 'Ruixats possibles: jaqueta impermeable, pantaló de mig temps i calçat que no es mulli. Paraigua de butxaca útil.' + wcSuffix,
        es: 'Chubascos posibles: chaqueta impermeable, pantalón de entretiempo y calzado que no se moje. Paraguas de bolsillo útil.' + wcSuffix,
        en: 'Showers possible: waterproof jacket, mid-season trousers and footwear that stays dry. A pocket umbrella will come in handy.' + wcSuffix,
        fr: 'Averses possibles\u00a0: veste imperméable, pantalon mi-saison et chaussures qui ne se mouillent pas. Parapluie de poche utile.' + wcSuffix,
      }, lang),
    ], seed)

    return pickV([
      pick({
        ca: 'Jaqueta lleugera o jersei. Temps fresc però agradable.' + (windy ? ' Vent de ' + wnd + 'km/h: porta una capa extra, la sensació és més fresca del que sembla.' : ' Capa extra per si refresca al vespre.'),
        es: 'Chaqueta ligera o jersey. Fresco pero agradable.' + (windy ? ' Viento de ' + wnd + 'km/h: lleva una capa extra, la sensación es más fresca.' : ' Capa extra por si refresca por la tarde.'),
        en: 'Light jacket or jumper. Cool but pleasant.' + (windy ? ' ' + wnd + 'km/h wind: bring an extra layer — it feels fresher than the thermometer says.' : ' Carry an extra layer for the evening.'),
        fr: 'Veste légère ou pull. Frais mais agréable.' + (windy ? ' Vent de ' + wnd + 'km/h\u00a0: prévoyez une couche en plus, le ressenti est plus frais.' : ' Couche supplémentaire si les températures baissent le soir.'),
      }, lang),
      pick({
        ca: 'Temperatura agradable (sensació ' + Math.round(fl) + '\u00b0C). Jersei o jaqueta fina, roba còmoda.' + (windy ? ' Vent de ' + wnd + 'km/h accentua el fred: porta para-vent.' : ' Bon temps per a activitats a l\'exterior.'),
        es: 'Temperatura agradable (sensación ' + Math.round(fl) + '\u00b0C). Jersey o chaqueta fina, ropa cómoda.' + (windy ? ' Viento de ' + wnd + 'km/h acentúa el frío: lleva cortavientos.' : ' Buen tiempo para actividades al aire libre.'),
        en: 'Pleasant temperature (feels like ' + Math.round(fl) + '\u00b0C). Jumper or thin jacket, comfortable clothing.' + (windy ? ' ' + wnd + 'km/h wind adds a chill: bring a windproof layer.' : ' Good conditions for outdoor activities.'),
        fr: 'Température agréable (ressenti ' + Math.round(fl) + '\u00b0C). Pull ou veste fine, vêtements confortables.' + (windy ? ' Vent de ' + wnd + 'km/h accentue la fraîcheur\u00a0: coupe-vent utile.' : ' Bonnes conditions pour les activités extérieures.'),
      }, lang),
    ], seed)
  }

  // ── Warm (feels-like < 26) ──
  if (fl < 26) {
    if (hasRain) return pickV([
      pick({
        ca: 'Roba còmoda i lleugera, paraigua i jaqueta fina per als intervals de pluja.',
        es: 'Ropa cómoda y ligera, paraguas y chaqueta fina para los intervalos de lluvia.',
        en: 'Comfortable light clothing, umbrella and a thin jacket for rainy spells.',
        fr: 'Vêtements légers et confortables, parapluie et veste fine pour les intervalles pluvieux.',
      }, lang),
      pick({
        ca: 'Bon temps amb alguna pluja: roba lleugera, jaqueta impermeable fina i paraigua plegable. Sandàlies tancades o esportives.',
        es: 'Buen tiempo con alguna lluvia: ropa ligera, chaqueta impermeable fina y paraguas plegable. Sandalias cerradas o deportivas.',
        en: 'Nice weather with some rain: light clothing, thin waterproof jacket and compact umbrella. Closed sandals or trainers.',
        fr: 'Beau temps avec quelques pluies\u00a0: vêtements légers, fine veste imperméable et parapluie compact. Sandales fermées ou baskets.',
      }, lang),
    ], seed)

    return pickV([
      pick({
        ca: 'Roba còmoda i lleugera. Porta una capa extra per al vespre o si bufa el vent.',
        es: 'Ropa cómoda y ligera. Lleva una capa extra para la tarde o si hay viento.',
        en: 'Comfortable, light clothing. Bring an extra layer for the evening or if the wind picks up.',
        fr: 'Vêtements légers et confortables. Couche supplémentaire pour le soir ou en cas de vent.',
      }, lang),
      pick({
        ca: 'Temperatura suau (sensació ' + Math.round(fl) + '\u00b0C). Roba de mig temps lleugera. Capa extra per a la nit.',
        es: 'Temperatura suave (sensación ' + Math.round(fl) + '\u00b0C). Ropa de entretiempo ligera. Capa extra para la noche.',
        en: 'Mild temperature (feels like ' + Math.round(fl) + '\u00b0C). Light mid-season clothing. Extra layer for the night.',
        fr: 'Température douce (ressenti ' + Math.round(fl) + '\u00b0C). Vêtements légers de mi-saison. Couche supplémentaire pour la nuit.',
      }, lang),
    ], seed)
  }

  // ── Hot (≥ 26 feels-like) ──
  if (hasRain) return pickV([
    pick({
      ca: 'Roba lleugera d\'estiu, protecció solar (FPS 30+) i paraigua o poncho lleuger per als possibles ruixats.',
      es: 'Ropa ligera de verano, protección solar (FPS 30+) y paraguas o poncho ligero para los posibles chubascos.',
      en: 'Light summer clothes, sun protection (SPF 30+) and a compact umbrella or light rain poncho for showers.',
      fr: 'Vêtements légers d\'été, protection solaire (FPS 30+) et parapluie compact ou poncho léger pour les averses.',
    }, lang),
    pick({
      ca: 'Calor amb ruixats: roba lleugera i transpirable, crema solar i paraigua plegable. Sandàlies o esportives lleugeres.',
      es: 'Calor con chubascos: ropa ligera y transpirable, crema solar y paraguas plegable. Sandalias o deportivas ligeras.',
      en: 'Heat with showers: light breathable clothing, sunscreen and a foldable umbrella. Open sandals or light trainers.',
      fr: 'Chaleur avec averses\u00a0: vêtements légers et respirants, crème solaire et parapluie pliant. Sandales ou baskets légères.',
    }, lang),
  ], seed)

  return pickV([
    pick({
      ca: 'Roba lleugera d\'estiu, gorra o barret i protecció solar FPS 30+. Mantén-te ben hidratat i busca l\'ombra a les hores centrals.',
      es: 'Ropa ligera de verano, gorra o sombrero y protección solar FPS 30+. Mantente bien hidratado y busca la sombra en las horas centrales.',
      en: 'Light summer clothes, hat and SPF 30+ sun protection. Stay well hydrated and seek shade during the hottest hours.',
      fr: 'Vêtements légers d\'été, chapeau et protection solaire FPS 30+. Restez bien hydraté et cherchez l\'ombre aux heures les plus chaudes.',
    }, lang),
    pick({
      ca: 'Calor important (sensació ' + Math.round(fl) + '\u00b0C). Roba lleugera transpirable de colors clars. Gorra, ulleres de sol i crema solar obligatòries. Beu aigua sovint.',
      es: 'Calor importante (sensación ' + Math.round(fl) + '\u00b0C). Ropa ligera transpirable de colores claros. Gorra, gafas de sol y crema solar obligatorias. Bebe agua con frecuencia.',
      en: 'Significant heat (feels like ' + Math.round(fl) + '\u00b0C). Light, breathable, light-coloured clothing. Hat, sunglasses and sunscreen are a must. Drink water regularly.',
      fr: 'Chaleur importante (ressenti ' + Math.round(fl) + '\u00b0C). Vêtements légers, respirants et de couleurs claires. Chapeau, lunettes et crème solaire obligatoires. Buvez régulièrement.',
    }, lang),
  ], seed)
}

// ── Day-label helpers ─────────────────────────────────────────────────────────

/**
 * Returns a short per-day clothes label (e.g. "light jacket") for a given
 * feels-like temperature and rain flag.
 */
function shortClothes(fl: number, rain: boolean, lang: string): string {
  if (fl < 0)  return pick({ ca:'abric d\'hivern + guants', es:'abrigo de invierno + guantes', en:'heavy coat + gloves', fr:'grand manteau + gants' }, lang)
  if (fl < 6)  return pick({ ca:'abric gruixut + capes tèrmiques', es:'abrigo grueso + capas térmicas', en:'heavy coat + thermal layers', fr:'manteau chaud + sous-couches' }, lang)
  if (fl < 12) return rain
    ? pick({ ca:'impermeable + botes + paraigua', es:'impermeable + botas + paraguas', en:'waterproof coat + boots + umbrella', fr:'imperméable + bottes + parapluie' }, lang)
    : pick({ ca:'jaqueta d\'hivern + jersei', es:'chaqueta de invierno + jersey', en:'winter jacket + jumper', fr:'veste d\'hiver + pull' }, lang)
  if (fl < 18) return rain
    ? pick({ ca:'jaqueta lleugera + paraigua', es:'chaqueta ligera + paraguas', en:'light jacket + umbrella', fr:'veste légère + parapluie' }, lang)
    : pick({ ca:'jaqueta lleugera', es:'chaqueta ligera', en:'light jacket', fr:'veste légère' }, lang)
  if (fl < 25) return rain
    ? pick({ ca:'roba còmoda + paraigua', es:'ropa cómoda + paraguas', en:'comfortable clothing + umbrella', fr:'tenue confortable + parapluie' }, lang)
    : pick({ ca:'roba còmoda', es:'ropa cómoda', en:'comfortable clothing', fr:'tenue confortable' }, lang)
  return rain
    ? pick({ ca:'roba lleugera + paraigua', es:'ropa ligera + paraguas', en:'light clothes + umbrella', fr:'tenue légère + parapluie' }, lang)
    : pick({ ca:'roba lleugera + crema solar', es:'ropa ligera + crema solar', en:'light clothes + sunscreen', fr:'tenue légère + crème solaire' }, lang)
}

/**
 * Returns a "Today: X. Tomorrow: Y." dual-advice string when today and tomorrow
 * call for meaningfully different clothing. Returns empty string when similar.
 */
function perDayClothesNote(s: Stats48h, lang: string): string {
  const todayFL  = s.todayAvgFL    ?? s.avgFeelsLike
  const tomFL    = s.tomorrowAvgFL ?? s.avgFeelsLike
  const todayRain = s.todayPrecip    > 1
  const tomRain   = s.tomorrowPrecip > 1

  // Categorise: bucket feels-like into bands and combine with rain flag
  const cat = (fl: number, rain: boolean) =>
    (rain ? 10 : 0) + (fl < 0 ? 0 : fl < 6 ? 1 : fl < 12 ? 2 : fl < 18 ? 3 : fl < 25 ? 4 : 5)

  if (cat(todayFL, todayRain) === cat(tomFL, tomRain)) return '' // same → no dual note

  const todayLbl = pick({ ca:'Avui', es:'Hoy', en:'Today', fr:"Auj." }, lang)
  const tomLbl   = pick({ ca:'Demà', es:'Mañana', en:'Tomorrow', fr:'Demain' }, lang)
  return `${todayLbl}: ${shortClothes(todayFL, todayRain, lang)}. ${tomLbl}: ${shortClothes(tomFL, tomRain, lang)}.`
}

// ── Renderer ──────────────────────────────────────────────────────────────────
export function renderPredictionCard(
  wxData: Record<string, OpenMeteoResponse | null>,
) {
  const el = document.getElementById('predictionCard')
  if (!el) return
  if (!wxData || !Object.keys(wxData).length) { el.innerHTML = ''; return }

  const lang  = state.lang
  const stats = compute48hStats(wxData)
  if (!stats) { el.innerHTML = ''; return }

  const prediction    = generatePrediction(stats, lang)
  const perDayNote    = perDayClothesNote(stats, lang)
  // If today and tomorrow call for different attire, use per-day note only (cleaner).
  // Otherwise use the full clothes advice.
  const clothesAdvice = perDayNote || generateClothesAdvice(stats, lang)

  // Condition icon — driven by feels-like for cold/windy accuracy
  let condIcon = '⛅'
  if (stats.hasStorm || stats.totalPrecip > 15)           condIcon = '⛈️'
  else if (stats.maxTemp < 3 && stats.totalPrecip > 0.5)  condIcon = '❄️'
  else if (stats.totalPrecip > 8)                         condIcon = '🌧️'
  else if (stats.totalPrecip > 1)                         condIcon = '🌦️'
  else if (stats.avgFeelsLike < 2)                        condIcon = '🥶'
  else if (stats.avgTemp > 28)                            condIcon = '☀️'
  else if (stats.avgTemp > 20)                            condIcon = '🌤️'

  // Clothes icon — driven by feels-like
  const fl = stats.avgFeelsLike
  let clothesIcon = '🧥'
  if (fl > 25 && stats.totalPrecip < 1) clothesIcon = '👕'
  else if (stats.totalPrecip > 1)       clothesIcon = '☂️'
  else if (fl > 15)                     clothesIcon = '🧣'
  else if (fl < 0)                      clothesIcon = '🧤'

  const TITLE_LABEL: Record<string, string> = {
    ca: 'Predicció properes 48h',
    es: 'Predicción próximas 48h',
    en: 'Next 48h forecast',
    fr: 'Prévision 48h',
  }
  const CLOTHES_LABEL: Record<string, string> = {
    ca: 'Consell de roba',
    es: 'Consejo de ropa',
    en: 'What to wear',
    fr: 'Quoi porter',
  }
  const tl = TITLE_LABEL[lang]   ?? TITLE_LABEL.en
  const cl = CLOTHES_LABEL[lang] ?? CLOTHES_LABEL.en

  el.innerHTML =
    '<div class="prediction-card">' +
      '<div class="prediction-row">' +
        '<div class="prediction-item">' +
          '<div class="prediction-item-header">' +
            '<span class="prediction-icon" aria-hidden="true">' + condIcon + '</span>' +
            '<span class="prediction-label">' + tl + '</span>' +
          '</div>' +
          '<p class="prediction-text">' + prediction + '</p>' +
        '</div>' +
        '<div class="prediction-divider" aria-hidden="true"></div>' +
        '<div class="prediction-item">' +
          '<div class="prediction-item-header">' +
            '<span class="prediction-icon" aria-hidden="true">' + clothesIcon + '</span>' +
            '<span class="prediction-label">' + cl + '</span>' +
          '</div>' +
          '<p class="prediction-text">' + clothesAdvice + '</p>' +
        '</div>' +
      '</div>' +
    '</div>'
}
