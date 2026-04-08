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
const PRIORITY_W: Record<string, number> = { arome_hd: 25, gfs: 20, ecmwf: 20 }
const OTHER_SLOT = 35

function weightedAvg(vals: Array<{ k: string; v: number }>): number {
  if (!vals.length) return 0
  if (vals.length === 1) return vals[0].v
  const priority = vals.filter(x => PRIORITY_W[x.k] !== undefined)
  const others   = vals.filter(x => PRIORITY_W[x.k] === undefined)
  const perOther = others.length ? OTHER_SLOT / others.length : 0
  let totalW = others.length * perOther
  for (const x of priority) totalW += PRIORITY_W[x.k]
  let result = 0
  for (const x of priority) result += x.v * (PRIORITY_W[x.k] / totalW)
  for (const x of others)   result += x.v * (perOther / totalW)
  return result
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

// ── Prediction text (day/night-aware) ─────────────────────────────────────────
/* eslint-disable prefer-template */
function generatePrediction(s: Stats48h, lang: string): string {
  const seed = variantSeed()
  const wnd  = Math.round(s.maxWind)

  // Resolved day/night temps with overall fallbacks
  const dMax  = s.dayMaxTemp   != null ? Math.round(s.dayMaxTemp)   : Math.round(s.maxTemp)
  const dMin  = s.dayMinTemp   != null ? Math.round(s.dayMinTemp)   : Math.round(s.minTemp)
  const nMin  = s.nightMinTemp != null ? Math.round(s.nightMinTemp) : Math.round(s.minTemp)
  const nMax  = s.nightMaxTemp != null ? Math.round(s.nightMaxTemp) : Math.round(s.maxTemp)
  const dFL   = s.dayAvgFL     != null ? Math.round(s.dayAvgFL)     : null
  const nFL   = s.nightAvgFL   != null ? Math.round(s.nightAvgFL)   : null
  const tot   = Math.round(s.totalPrecip)
  const dTot  = Math.round(s.dayPrecip)
  const nTot  = Math.round(s.nightPrecip)

  // Wind chill note for night (most impactful when cold + windy)
  const nWCDiff = (nFL != null && s.nightAvgTemp != null) ? s.nightAvgTemp - nFL : 0
  const nHasWC  = nWCDiff >= 4 && (s.nightAvgTemp ?? 99) <= 12
  const nWCNote = nHasWC && nFL != null ? pick({
    ca: ' (sensació ' + nFL + '\u00b0C)',
    es: ' (sensación ' + nFL + '\u00b0C)',
    en: ' (feels like ' + nFL + '\u00b0C)',
    fr: ' (ressenti ' + nFL + '\u00b0C)',
  }, lang) : ''

  // Day wind chill note
  const dWCDiff = (dFL != null && s.dayAvgTemp != null) ? s.dayAvgTemp - dFL : 0
  const dHasWC  = dWCDiff >= 4 && (s.dayAvgTemp ?? 99) <= 12
  const dWCNote = dHasWC && dFL != null ? pick({
    ca: ' (sensació ' + dFL + '\u00b0C)',
    es: ' (sensación ' + dFL + '\u00b0C)',
    en: ' (feels like ' + dFL + '\u00b0C)',
    fr: ' (ressenti ' + dFL + '\u00b0C)',
  }, lang) : ''

  // Wind descriptor
  const windDesc = pick({
    ca: 'Ratxes fins a ' + wnd + '\u00a0km/h.',
    es: 'Rachas hasta ' + wnd + '\u00a0km/h.',
    en: 'Gusts up to ' + wnd + '\u00a0km/h.',
    fr: 'Rafales jusqu\'\u00e0 ' + wnd + '\u00a0km/h.',
  }, lang)

  // ── Storm ──
  if (s.hasStorm && s.totalPrecip > 5) return pickV([
    pick({
      ca: 'Tempestes amb ' + tot + 'mm. Dia: fins a ' + dMax + '\u00b0C' + dWCNote + '. Nit: ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
      es: 'Tormentas con ' + tot + 'mm. Día: hasta ' + dMax + '\u00b0C' + dWCNote + '. Noche: ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
      en: 'Storms with ' + tot + 'mm of rain. Day highs ' + dMax + '\u00b0C' + dWCNote + '. Night lows ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
      fr: 'Orages avec ' + tot + 'mm. Jour\u00a0: jusqu\'\u00e0 ' + dMax + '\u00b0C' + dWCNote + '. Nuit\u00a0: ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
    }, lang),
    pick({
      ca: 'Activitat tempestuosa: ' + tot + 'mm, ratxes ' + wnd + '\u00a0km/h. M\u00e0x diürna ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn nocturna ' + nMin + '\u00b0C' + nWCNote + '.',
      es: 'Actividad tormentosa: ' + tot + 'mm, rachas ' + wnd + '\u00a0km/h. M\u00e1x diurna ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn nocturna ' + nMin + '\u00b0C' + nWCNote + '.',
      en: 'Storm activity: ' + tot + 'mm, gusts ' + wnd + '\u00a0km/h. Day peak ' + dMax + '\u00b0C' + dWCNote + ', overnight low ' + nMin + '\u00b0C' + nWCNote + '.',
      fr: 'Activit\u00e9 orageuse\u00a0: ' + tot + 'mm, rafales ' + wnd + '\u00a0km/h. Pic diurne ' + dMax + '\u00b0C' + dWCNote + ', min nocturne ' + nMin + '\u00b0C' + nWCNote + '.',
    }, lang),
  ], seed)

  // ── Snow ──
  if (s.maxTemp < 3 && s.totalPrecip > 1) return pickV([
    pick({
      ca: 'Nevada probable: ' + tot + 'mm. Dia entre ' + dMin + ' i ' + dMax + '\u00b0C. Nit fins a ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
      es: 'Nevada probable: ' + tot + 'mm. D\u00eda entre ' + dMin + ' y ' + dMax + '\u00b0C. Noche hasta ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
      en: 'Snowfall likely: ' + tot + 'mm. Day ' + dMin + '\u2013' + dMax + '\u00b0C. Night down to ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
      fr: 'Neige probable\u00a0: ' + tot + 'mm. Jour ' + dMin + '\u2013' + dMax + '\u00b0C. Nuit jusqu\'\u00e0 ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
    }, lang),
    pick({
      ca: 'Nevades en les pr\u00f2ximes 48h (' + tot + 'mm). Temperatures de dia ' + dMax + '\u00b0C, de nit ' + nMin + '\u00b0C' + nWCNote + '. Superfícies lliscants probables. ' + windDesc,
      es: 'Nevadas en las pr\u00f3ximas 48h (' + tot + 'mm). Temperatures de d\u00eda ' + dMax + '\u00b0C, de noche ' + nMin + '\u00b0C' + nWCNote + '. Superficies resbaladizas probables. ' + windDesc,
      en: 'Snow over the next 48h (' + tot + 'mm). Daytime ' + dMax + '\u00b0C, overnight ' + nMin + '\u00b0C' + nWCNote + '. Watch for icy surfaces. ' + windDesc,
      fr: 'Neige sur 48h (' + tot + 'mm). Jour ' + dMax + '\u00b0C, nuit ' + nMin + '\u00b0C' + nWCNote + '. Surfaces glissantes probables. ' + windDesc,
    }, lang),
  ], seed)

  // ── Very heavy rain ──
  if (s.totalPrecip > 20) return pickV([
    pick({
      ca: 'Pluges molt intenses: ' + tot + 'mm en 48h. ' + (dTot > 2 ? 'Dia pluj\u00f3s fins a ' + dMax + '\u00b0C' + dWCNote + '. ' : 'Dia: ' + dMax + '\u00b0C. ') + 'Nit: ' + nMin + '\u00b0C' + nWCNote + '. Risc d\'inundacions. ' + windDesc,
      es: 'Lluvias muy intensas: ' + tot + 'mm en 48h. ' + (dTot > 2 ? 'D\u00eda lluvioso hasta ' + dMax + '\u00b0C' + dWCNote + '. ' : 'D\u00eda: ' + dMax + '\u00b0C. ') + 'Noche: ' + nMin + '\u00b0C' + nWCNote + '. Riesgo de inundaciones. ' + windDesc,
      en: 'Very heavy rain: ' + tot + 'mm over 48h. ' + (dTot > 2 ? 'Wet day up to ' + dMax + '\u00b0C' + dWCNote + '. ' : 'Day: ' + dMax + '\u00b0C. ') + 'Night: ' + nMin + '\u00b0C' + nWCNote + '. Localised flood risk. ' + windDesc,
      fr: 'Pluies tr\u00e8s fortes\u00a0: ' + tot + 'mm/48h. ' + (dTot > 2 ? 'Jour pluvieux jusqu\'\u00e0 ' + dMax + '\u00b0C' + dWCNote + '. ' : 'Jour\u00a0: ' + dMax + '\u00b0C. ') + 'Nuit\u00a0: ' + nMin + '\u00b0C' + nWCNote + '. Risque d\'inondations locales. ' + windDesc,
    }, lang),
    pick({
      ca: 'Precipitaci\u00f3 molt acumulada (' + tot + 'mm/48h). M\u00e0x dia ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn nit ' + nMin + '\u00b0C' + nWCNote + '. Possible afectaci\u00f3 per aigues superficials. ' + windDesc,
      es: 'Precipitaci\u00f3n muy acumulada (' + tot + 'mm/48h). M\u00e1x d\u00eda ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn noche ' + nMin + '\u00b0C' + nWCNote + '. Posible afectaci\u00f3n por agua acumulada. ' + windDesc,
      en: 'High rainfall totals (' + tot + 'mm/48h). Day high ' + dMax + '\u00b0C' + dWCNote + ', overnight low ' + nMin + '\u00b0C' + nWCNote + '. Surface water disruption possible. ' + windDesc,
      fr: 'Cumuls \u00e9lev\u00e9s (' + tot + 'mm/48h). Max jour ' + dMax + '\u00b0C' + dWCNote + ', min nuit ' + nMin + '\u00b0C' + nWCNote + '. Perturbations dues aux eaux de surface possibles. ' + windDesc,
    }, lang),
  ], seed)

  // ── Moderate-heavy rain ──
  if (s.totalPrecip > 8) return pickV([
    pick({
      ca: 'Temps pluj\u00f3s: ' + tot + 'mm en 48h. Dia fins a ' + dMax + '\u00b0C' + dWCNote + (dTot > 1 ? ' (' + dTot + 'mm de dia)' : '') + '. Nit ' + nMin + '\u00b0C' + nWCNote + (nTot > 1 ? ' (' + nTot + 'mm de nit)' : '') + '. ' + windDesc,
      es: 'Tiempo lluvioso: ' + tot + 'mm en 48h. D\u00eda hasta ' + dMax + '\u00b0C' + dWCNote + (dTot > 1 ? ' (' + dTot + 'mm de d\u00eda)' : '') + '. Noche ' + nMin + '\u00b0C' + nWCNote + (nTot > 1 ? ' (' + nTot + 'mm de noche)' : '') + '. ' + windDesc,
      en: 'Rainy 48h: ' + tot + 'mm total. Day up to ' + dMax + '\u00b0C' + dWCNote + (dTot > 1 ? ' (' + dTot + 'mm daytime)' : '') + '. Night ' + nMin + '\u00b0C' + nWCNote + (nTot > 1 ? ' (' + nTot + 'mm overnight)' : '') + '. ' + windDesc,
      fr: 'Temps pluvieux\u00a0: ' + tot + 'mm/48h. Jour jusqu\'\u00e0 ' + dMax + '\u00b0C' + dWCNote + (dTot > 1 ? ' (' + dTot + 'mm le jour)' : '') + '. Nuit ' + nMin + '\u00b0C' + nWCNote + (nTot > 1 ? ' (' + nTot + 'mm la nuit)' : '') + '. ' + windDesc,
    }, lang),
    pick({
      ca: 'Pluja moderada a intensa: m\u00e0x ' + dMax + '\u00b0C' + dWCNote + ' de dia, m\u00edn ' + nMin + '\u00b0C' + nWCNote + ' de nit. Total ' + tot + 'mm. ' + windDesc,
      es: 'Lluvia moderada a intensa: m\u00e1x ' + dMax + '\u00b0C' + dWCNote + ' de d\u00eda, m\u00edn ' + nMin + '\u00b0C' + nWCNote + ' de noche. Total ' + tot + 'mm. ' + windDesc,
      en: 'Moderate to heavy rain: day high ' + dMax + '\u00b0C' + dWCNote + ', night low ' + nMin + '\u00b0C' + nWCNote + '. Total ' + tot + 'mm. ' + windDesc,
      fr: 'Pluie mod\u00e9r\u00e9e \u00e0 forte\u00a0: max ' + dMax + '\u00b0C' + dWCNote + ' le jour, min ' + nMin + '\u00b0C' + nWCNote + ' la nuit. Total ' + tot + 'mm. ' + windDesc,
    }, lang),
  ], seed)

  // ── Light rain / showers ──
  if (s.totalPrecip > 2) return pickV([
    pick({
      ca: 'Ruixats dispersos (' + tot + 'mm). Dia fins a ' + dMax + '\u00b0C' + dWCNote + (dTot > 1 ? ', pluja principalment de dia' : '') + '. Nit ' + nMin + '\u00b0C' + nWCNote + (nTot > 1 ? ', ruixats nocturns' : '') + '. ' + windDesc,
      es: 'Chubascos dispersos (' + tot + 'mm). D\u00eda hasta ' + dMax + '\u00b0C' + dWCNote + (dTot > 1 ? ', lluvia principalmente de d\u00eda' : '') + '. Noche ' + nMin + '\u00b0C' + nWCNote + (nTot > 1 ? ', chubascos nocturnos' : '') + '. ' + windDesc,
      en: 'Scattered showers (' + tot + 'mm). Day up to ' + dMax + '\u00b0C' + dWCNote + (dTot > 1 ? ', mainly daytime rain' : '') + '. Night ' + nMin + '\u00b0C' + nWCNote + (nTot > 1 ? ', overnight showers' : '') + '. ' + windDesc,
      fr: 'Averses \u00e9parses (' + tot + 'mm). Jour jusqu\'\u00e0 ' + dMax + '\u00b0C' + dWCNote + (dTot > 1 ? ', pluie principalement le jour' : '') + '. Nuit ' + nMin + '\u00b0C' + nWCNote + (nTot > 1 ? ', averses nocturnes' : '') + '. ' + windDesc,
    }, lang),
    pick({
      ca: 'Cel variable amb algun ruixat (' + tot + 'mm/48h). M\u00e0x diürna ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn nocturna ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
      es: 'Cielo variable con alg\u00fan chubasco (' + tot + 'mm/48h). M\u00e1x diurna ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn nocturna ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
      en: 'Variable skies with some showers (' + tot + 'mm/48h). Day high ' + dMax + '\u00b0C' + dWCNote + ', night low ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
      fr: 'Ciel variable avec quelques averses (' + tot + 'mm/48h). Max jour ' + dMax + '\u00b0C' + dWCNote + ', min nuit ' + nMin + '\u00b0C' + nWCNote + '. ' + windDesc,
    }, lang),
  ], seed)

  // ── Very hot & dry ──
  if ((s.dayAvgTemp ?? s.avgTemp) > 28) return pickV([
    pick({
      ca: 'Calor intensa de dia: m\u00e0x ' + dMax + '\u00b0C. Nits c\u00e0lides entorn dels ' + nMin + '\u2013' + nMax + '\u00b0C. Sense precipitaci\u00f3. ' + windDesc,
      es: 'Calor intensa de d\u00eda: m\u00e1x ' + dMax + '\u00b0C. Noches c\u00e1lidas en torno a ' + nMin + '\u2013' + nMax + '\u00b0C. Sin precipitaci\u00f3n. ' + windDesc,
      en: 'Intense daytime heat: highs of ' + dMax + '\u00b0C. Warm nights around ' + nMin + '\u2013' + nMax + '\u00b0C. No rain. ' + windDesc,
      fr: 'Forte chaleur diurne\u00a0: max ' + dMax + '\u00b0C. Nuits chaudes autour de ' + nMin + '\u2013' + nMax + '\u00b0C. Aucune pr\u00e9cipitation. ' + windDesc,
    }, lang),
    pick({
      ca: 'Dia molt calorós amb pic de ' + dMax + '\u00b0C. Hores centrals especialment tòrrides. Nit: ' + nMin + '\u00b0C. Cel serè. ' + windDesc,
      es: 'D\u00eda muy caluroso con pico de ' + dMax + '\u00b0C. Horas centrales especialmente tórridas. Noche: ' + nMin + '\u00b0C. Cielo despejado. ' + windDesc,
      en: 'Very hot day peaking at ' + dMax + '\u00b0C. Midday hours scorching. Night: ' + nMin + '\u00b0C. Clear skies. ' + windDesc,
      fr: 'Journ\u00e9e tr\u00e8s chaude avec pic \u00e0 ' + dMax + '\u00b0C. Mi-journ\u00e9e torride. Nuit\u00a0: ' + nMin + '\u00b0C. Ciel d\u00e9gag\u00e9. ' + windDesc,
    }, lang),
  ], seed)

  // ── Warm & dry ──
  if ((s.dayAvgTemp ?? s.avgTemp) > 20) return pickV([
    pick({
      ca: 'Dies agradables amb m\u00e0ximes de ' + dMax + '\u00b0C. Nits fresques: ' + nMin + '\u00b0C' + nWCNote + '. Sec i assolellat. ' + windDesc,
      es: 'D\u00edas agradables con m\u00e1ximas de ' + dMax + '\u00b0C. Noches frescas: ' + nMin + '\u00b0C' + nWCNote + '. Seco y soleado. ' + windDesc,
      en: 'Pleasant days with highs of ' + dMax + '\u00b0C. Cool nights: ' + nMin + '\u00b0C' + nWCNote + '. Dry and sunny. ' + windDesc,
      fr: 'Journ\u00e9es agr\u00e9ables avec max ' + dMax + '\u00b0C. Nuits fra\u00eeches\u00a0: ' + nMin + '\u00b0C' + nWCNote + '. Sec et ensoleill\u00e9. ' + windDesc,
    }, lang),
    pick({
      ca: 'Bon temps: m\u00e0x ' + dMax + '\u00b0C de dia' + dWCNote + ', ' + nMin + '\u00b0C de nit' + nWCNote + '. Predominantment sec. ' + windDesc,
      es: 'Buen tiempo: m\u00e1x ' + dMax + '\u00b0C de d\u00eda' + dWCNote + ', ' + nMin + '\u00b0C de noche' + nWCNote + '. Predominantemente seco. ' + windDesc,
      en: 'Good weather: day high ' + dMax + '\u00b0C' + dWCNote + ', night low ' + nMin + '\u00b0C' + nWCNote + '. Mostly dry. ' + windDesc,
      fr: 'Beau temps\u00a0: max ' + dMax + '\u00b0C le jour' + dWCNote + ', ' + nMin + '\u00b0C la nuit' + nWCNote + '. Principalement sec. ' + windDesc,
    }, lang),
  ], seed)

  // ── Cool & dry ──
  if ((s.dayAvgTemp ?? s.avgTemp) > 10) return pickV([
    pick({
      ca: 'Temps fresc: m\u00e0x ' + dMax + '\u00b0C de dia' + dWCNote + ', m\u00edn ' + nMin + '\u00b0C de nit' + nWCNote + '. Sense precipitaci\u00f3 significativa. ' + windDesc,
      es: 'Tiempo fresco: m\u00e1x ' + dMax + '\u00b0C de d\u00eda' + dWCNote + ', m\u00edn ' + nMin + '\u00b0C de noche' + nWCNote + '. Sin precipitaci\u00f3n significativa. ' + windDesc,
      en: 'Cool conditions: day high ' + dMax + '\u00b0C' + dWCNote + ', night low ' + nMin + '\u00b0C' + nWCNote + '. No significant rain. ' + windDesc,
      fr: 'Temps frais\u00a0: max ' + dMax + '\u00b0C le jour' + dWCNote + ', min ' + nMin + '\u00b0C la nuit' + nWCNote + '. Aucune pr\u00e9cipitation significative. ' + windDesc,
    }, lang),
    pick({
      ca: 'M\u00e0x diürna ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn nocturna ' + nMin + '\u00b0C' + nWCNote + '. Ambient fresc i principalment sec. ' + windDesc,
      es: 'M\u00e1x diurna ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn nocturna ' + nMin + '\u00b0C' + nWCNote + '. Ambiente fresco y principalmente seco. ' + windDesc,
      en: 'Daytime high ' + dMax + '\u00b0C' + dWCNote + ', overnight low ' + nMin + '\u00b0C' + nWCNote + '. Cool and mainly dry. ' + windDesc,
      fr: 'Max diurne ' + dMax + '\u00b0C' + dWCNote + ', min nocturne ' + nMin + '\u00b0C' + nWCNote + '. Frais et principalement sec. ' + windDesc,
    }, lang),
  ], seed)

  // ── Cold & dry (fallback) ──
  return pickV([
    pick({
      ca: 'Fred: m\u00e0x de dia ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn de nit ' + nMin + '\u00b0C' + nWCNote + '. Possible gelada nocturna. ' + windDesc,
      es: 'Fr\u00edo: m\u00e1x de d\u00eda ' + dMax + '\u00b0C' + dWCNote + ', m\u00edn de noche ' + nMin + '\u00b0C' + nWCNote + '. Posible helada nocturna. ' + windDesc,
      en: 'Cold: day high ' + dMax + '\u00b0C' + dWCNote + ', night low ' + nMin + '\u00b0C' + nWCNote + '. Possible overnight frost. ' + windDesc,
      fr: 'Froid\u00a0: max jour ' + dMax + '\u00b0C' + dWCNote + ', min nuit ' + nMin + '\u00b0C' + nWCNote + '. Gel nocturne possible. ' + windDesc,
    }, lang),
    pick({
      ca: 'Fred intens: dia fins a ' + dMax + '\u00b0C' + dWCNote + ', nit fins a ' + nMin + '\u00b0C' + nWCNote + '. Sec i ennuvolat. Risc de gelades. ' + windDesc,
      es: 'Fr\u00edo intenso: d\u00eda hasta ' + dMax + '\u00b0C' + dWCNote + ', noche hasta ' + nMin + '\u00b0C' + nWCNote + '. Seco y nublado. Riesgo de heladas. ' + windDesc,
      en: 'Intense cold: daytime up to ' + dMax + '\u00b0C' + dWCNote + ', nights down to ' + nMin + '\u00b0C' + nWCNote + '. Dry, overcast. Frost risk. ' + windDesc,
      fr: 'Grand froid\u00a0: jour jusqu\'\u00e0 ' + dMax + '\u00b0C' + dWCNote + ', nuit jusqu\'\u00e0 ' + nMin + '\u00b0C' + nWCNote + '. Sec, nuageux. Risque de gel. ' + windDesc,
    }, lang),
  ], seed)
}

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
/* eslint-enable prefer-template */

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
  const clothesAdvice = generateClothesAdvice(stats, lang)

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
