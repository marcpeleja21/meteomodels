/**
 * Prediction card — rendered below the alerts banner.
 *
 * Computes hourly weighted-median values across all loaded models
 * starting from the CURRENT HOUR (so a 10 pm check covers tonight + tomorrow,
 * not the already-elapsed hours of today).
 *
 * Features:
 *  • Time-aware: window = [now, now+48h], past hours ignored
 *  • Anomaly detection: compares 48 h stats against ERA5 historical normals
 *    (last 10 years, ±21-day window around today's calendar date) — the same
 *    "control" baseline that ensemble plumes draw against climatology
 *  • Text variants: seed = hour + location → fresh wording on every reload
 *
 * Wind chill (Canadian/NOAA formula, valid T ≤ 10 °C, V > 4.8 km/h):
 *   WC = 13.12 + 0.6215·T − 11.37·V^0.16 + 0.3965·T·V^0.16
 */
import { state } from '../state'
import type { OpenMeteoResponse } from '../types'
import type { ClimaStats } from '../api/climatology'

// ── Wind chill ────────────────────────────────────────────────────────────────
function windChill(tempC: number, windKmh: number): number {
  if (windKmh <= 4.8 || tempC > 10) return tempC
  const v16 = Math.pow(windKmh, 0.16)
  return 13.12 + 0.6215 * tempC - 11.37 * v16 + 0.3965 * tempC * v16
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
  avgTemp:      number
  minTemp:      number
  maxTemp:      number
  totalPrecip:  number   // mm over 48 h
  maxWind:      number   // km/h gusts
  avgWind:      number   // km/h sustained average
  avgFeelsLike: number   // wind-chill-adjusted weighted average
  minFeelsLike: number   // wind-chill-adjusted minimum
  hasStorm:     boolean
  // Anomaly vs ERA5 historical normals (null = no clima data available)
  tempDelta:    number | null  // °C above (+) or below (−) historical mean
  precipRatio:  number | null  // ratio of 48h precip to expected 48h (2× daily mean)
  windDelta:    number | null  // km/h above historical mean wind
  anomalyHot:   boolean
  anomalyCold:  boolean
  anomalyWet:   boolean  // rain in a typically dry window
  anomalyDry:   boolean  // dry in a typically wet window
  anomalyWindy: boolean
}

function compute48hStats(
  wxData: Record<string, OpenMeteoResponse | null>,
  clima: ClimaStats | null,
): Stats48h | null {
  const now   = Date.now()
  const end   = now + 48 * 3600_000

  // Determine how many daily slots overlap with the 48 h window
  // (a 10 pm check spans 3 calendar days)
  const todayStart = (() => {
    const d = new Date(now)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  })()
  const gustDayCount = Math.min(3, Math.ceil((end - todayStart) / 86_400_000))

  type MV = { k: string; v: number }
  const tempMap:   Map<string, MV[]> = new Map()
  const precipMap: Map<string, MV[]> = new Map()
  const windMap:   Map<string, MV[]> = new Map()
  const codeMap:   Map<string, MV[]> = new Map()
  const gustVals:  MV[] = []


  for (const [modelKey, data] of Object.entries(wxData)) {
    if (!data?.hourly) continue
    const { time, temperature_2m, precipitation, windspeed_10m, weathercode } = data.hourly

    for (let i = 0; i < time.length; i++) {
      const ts = new Date(time[i]).getTime()
      if (ts < now) continue   // skip past hours

      if (ts > end) continue  // outside 48 h window

      const k = time[i]
      if (!tempMap.has(k)) {
        tempMap.set(k, []); precipMap.set(k, [])
        windMap.set(k, []); codeMap.set(k, [])
      }
      if (temperature_2m?.[i] != null) tempMap.get(k)!.push({ k: modelKey, v: temperature_2m[i]! })
      if (precipitation?.[i]  != null) precipMap.get(k)!.push({ k: modelKey, v: precipitation[i]! })
      if (windspeed_10m?.[i]  != null) windMap.get(k)!.push({ k: modelKey, v: windspeed_10m[i]! })
      if (weathercode?.[i]    != null) codeMap.get(k)!.push({ k: modelKey, v: weathercode[i]! })
    }

    // Gusts from daily data — cover up to 3 calendar days so late-night
    // checks (e.g. 10 pm) include tomorrow AND the day after
    const dg = data.daily?.windgusts_10m_max
    if (dg) {
      for (let d = 0; d < Math.min(gustDayCount, dg.length); d++) {
        if (dg[d] != null) gustVals.push({ k: modelKey, v: dg[d]! })
      }
    }
  }

  if (!tempMap.size) return null

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

  const avgTemp  = wTemps.reduce((a, b) => a + b, 0) / wTemps.length
  const avgFL    = wFeelsLike.reduce((a, b) => a + b, 0) / wFeelsLike.length
  const avgWind  = wWinds.length ? wWinds.reduce((a, b) => a + b, 0) / wWinds.length : 0
  const maxWind  = gustVals.length
    ? weightedAvg(gustVals)
    : (wWinds.length ? Math.max(...wWinds) : 0)
  const totalPrecip = wPrecip.reduce((a, b) => a + b, 0)

  // ── Anomaly detection vs ERA5 historical normals ──────────────────────────
  // clima = last 10 years, ±21-day window around today's calendar date
  // (same "control" baseline that ensemble plumes draw against climatology)
  const expPrecip48h = clima ? clima.precipPerDay * 2 : null   // expected mm over 48 h
  const tempDelta    = clima ? avgTemp - clima.tempMean : null
  const precipRatio  = (expPrecip48h != null && expPrecip48h > 0)
    ? totalPrecip / expPrecip48h
    : null
  const windDelta    = clima ? maxWind - clima.windMean : null

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
    tempDelta,
    precipRatio,
    windDelta,
    // Anomaly thresholds: meaningful deviations from historical norm
    anomalyHot:   tempDelta != null && tempDelta >= 4,
    anomalyCold:  tempDelta != null && tempDelta <= -4,
    anomalyWet:   precipRatio != null && precipRatio > 2.5 && totalPrecip > 5
                  && (expPrecip48h ?? 0) < 4,     // normally dry → rain is unusual
    anomalyDry:   precipRatio != null && precipRatio < 0.1 && (expPrecip48h ?? 0) > 4,
    anomalyWindy: windDelta != null && windDelta >= 20,
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

// ── Prediction text ───────────────────────────────────────────────────────────
/* eslint-disable prefer-template */
function generatePrediction(s: Stats48h, lang: string): string {
  const mn   = Math.round(s.minTemp)
  const mx   = Math.round(s.maxTemp)
  const tot  = Math.round(s.totalPrecip)
  const wnd  = Math.round(s.maxWind)
  const avg  = Math.round(s.avgTemp)
  const fl   = Math.round(s.avgFeelsLike)
  const mfl  = Math.round(s.minFeelsLike)
  const seed = variantSeed()

  const wcDiff       = s.avgTemp - s.avgFeelsLike
  const significantWC = wcDiff >= 4 && s.avgTemp <= 15

  // Anomaly suffix — quantified delta vs ERA5 historical normals for this date
  const absDelta  = s.tempDelta  != null ? Math.abs(Math.round(s.tempDelta))  : 0
  const absWDelta = s.windDelta  != null ? Math.abs(Math.round(s.windDelta))  : 0
  const anomalySuffix = s.anomalyHot ? pick({
    ca: ' \u26a0\ufe0f ' + absDelta + '\u00b0C per sobre de la mitjana hist\u00f2rica per a aquestes dates.',
    es: ' \u26a0\ufe0f ' + absDelta + '\u00b0C por encima de la media hist\u00f3rica para estas fechas.',
    en: ' \u26a0\ufe0f ' + absDelta + '\u00b0C above the historical average for this time of year.',
    fr: ' \u26a0\ufe0f ' + absDelta + '\u00b0C au-dessus de la moyenne historique pour cette p\u00e9riode.',
  }, lang) : s.anomalyCold ? pick({
    ca: ' \u26a0\ufe0f ' + absDelta + '\u00b0C per sota de la mitjana hist\u00f2rica per a aquestes dates.',
    es: ' \u26a0\ufe0f ' + absDelta + '\u00b0C por debajo de la media hist\u00f3rica para estas fechas.',
    en: ' \u26a0\ufe0f ' + absDelta + '\u00b0C below the historical average for this time of year.',
    fr: ' \u26a0\ufe0f ' + absDelta + '\u00b0C en dessous de la moyenne historique pour cette p\u00e9riode.',
  }, lang) : s.anomalyWet ? pick({
    ca: ' \u26a0\ufe0f Precipitaci\u00f3 molt superior a l\'habitual per a la zona en aquesta \u00e8poca.',
    es: ' \u26a0\ufe0f Precipitaci\u00f3n muy superior a la habitual para la zona en esta \u00e9poca.',
    en: ' \u26a0\ufe0f Rainfall well above what is historically typical for this area and date.',
    fr: ' \u26a0\ufe0f Pr\u00e9cipitations nettement sup\u00e9rieures \u00e0 la normale historique pour cette zone.',
  }, lang) : s.anomalyDry ? pick({
    ca: ' \u26a0\ufe0f Seq\u00fcera excepcional: molt menys pluja de l\'esperada per a la zona i \u00e8poca.',
    es: ' \u26a0\ufe0f Sequ\u00eda excepcional: mucha menos lluvia de la esperada para la zona y \u00e9poca.',
    en: ' \u26a0\ufe0f Exceptional dry spell: far less rain than historically expected for this area.',
    fr: ' \u26a0\ufe0f S\u00e9cheresse exceptionnelle\u00a0: bien moins de pluie que la normale historique pour cette zone.',
  }, lang) : s.anomalyWindy ? pick({
    ca: ' \u26a0\ufe0f Vent ' + absWDelta + '\u00a0km/h per sobre de la mitjana hist\u00f2rica per a aquesta data.',
    es: ' \u26a0\ufe0f Viento ' + absWDelta + '\u00a0km/h por encima de la media hist\u00f3rica para esta fecha.',
    en: ' \u26a0\ufe0f Wind ' + absWDelta + '\u00a0km/h above the historical average for this date.',
    fr: ' \u26a0\ufe0f Vent ' + absWDelta + '\u00a0km/h au-dessus de la moyenne historique pour cette date.',
  }, lang) : ''

  const wcNote = significantWC ? pick({
    ca: ' Sensació tèrmica real de ' + fl + '\u00b0C pel vent (' + wnd + 'km/h).',
    es: ' Sensación térmica real de ' + fl + '\u00b0C por el viento (' + wnd + 'km/h).',
    en: ' Wind chill brings the real feel to ' + fl + '\u00b0C (' + wnd + 'km/h).',
    fr: ' Le vent (' + wnd + 'km/h) ramène le ressenti à ' + fl + '\u00b0C.',
  }, lang) : ''

  // ── Storm ──
  if (s.hasStorm && s.totalPrecip > 5) return pickV([
    pick({
      ca: 'Tempestes previstes amb precipitació intensa (' + tot + 'mm en 48h). Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Ràfegues fins a ' + wnd + 'km/h.' + (significantWC ? ' Sensació de ' + fl + '\u00b0C.' : ''),
      es: 'Tormentas previstas con precipitación intensa (' + tot + 'mm en 48h). Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Rachas hasta ' + wnd + 'km/h.' + (significantWC ? ' Sensación de ' + fl + '\u00b0C.' : ''),
      en: 'Storms forecast with heavy rainfall (' + tot + 'mm over 48h). Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Gusts up to ' + wnd + 'km/h.' + (significantWC ? ' Feels like ' + fl + '\u00b0C.' : ''),
      fr: 'Orages avec fortes précipitations (' + tot + 'mm/48h). Températures ' + mn + '\u2013' + mx + '\u00b0C. Rafales à ' + wnd + 'km/h.' + (significantWC ? ' Ressenti\u00a0: ' + fl + '\u00b0C.' : ''),
    }, lang),
    pick({
      ca: 'Activitat tempestuosa significant: ' + tot + 'mm en 48h. Màx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Vent ratxat fins a ' + wnd + 'km/h.' + (significantWC ? ' Sensació de ' + fl + '\u00b0C.' : ''),
      es: 'Actividad tormentosa significativa: ' + tot + 'mm en 48h. Máx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Viento en racha a ' + wnd + 'km/h.' + (significantWC ? ' Sensación de ' + fl + '\u00b0C.' : ''),
      en: 'Significant storm activity: ' + tot + 'mm over 48h. High ' + mx + '\u00b0C, low ' + mn + '\u00b0C. Winds gusting to ' + wnd + 'km/h.' + (significantWC ? ' Real-feel ' + fl + '\u00b0C.' : ''),
      fr: 'Activité orageuse notable\u00a0: ' + tot + 'mm/48h. Max ' + mx + '\u00b0C, min ' + mn + '\u00b0C. Rafales à ' + wnd + 'km/h.' + (significantWC ? ' Ressenti\u00a0: ' + fl + '\u00b0C.' : ''),
    }, lang),
  ], seed) + anomalySuffix

  // ── Snow ──
  if (s.maxTemp < 3 && s.totalPrecip > 1) return pickV([
    pick({
      ca: 'Possibles nevades les pròximes 48h (' + tot + 'mm). Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h.' + (significantWC ? ' Sensació de ' + mfl + '\u00b0C.' : ' Superfícies lliscants probables.'),
      es: 'Posibles nevadas en las próximas 48h (' + tot + 'mm). Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h.' + (significantWC ? ' Sensación de ' + mfl + '\u00b0C.' : ' Superficies resbaladizas probables.'),
      en: 'Possible snowfall over the next 48h (' + tot + 'mm). Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h.' + (significantWC ? ' Feels like ' + mfl + '\u00b0C.' : ' Watch for icy, slippery surfaces.'),
      fr: 'Chutes de neige possibles dans les 48h (' + tot + 'mm). Températures ' + mn + '\u2013' + mx + '\u00b0C. Vent à ' + wnd + 'km/h.' + (significantWC ? ' Ressenti\u00a0: ' + mfl + '\u00b0C.' : ' Surfaces glissantes possibles.'),
    }, lang),
    pick({
      ca: 'Nevada probable: ' + tot + 'mm de precipitació amb temperatures de ' + mn + ' a ' + mx + '\u00b0C. Ràfegues de ' + wnd + 'km/h.' + (significantWC ? ' Sensació de ' + mfl + '\u00b0C.' : ' Precaució amb el gel a les superfícies.'),
      es: 'Nevada probable: ' + tot + 'mm con temperaturas de ' + mn + ' a ' + mx + '\u00b0C. Rachas de ' + wnd + 'km/h.' + (significantWC ? ' Sensación de ' + mfl + '\u00b0C.' : ' Precaución con el hielo en superficies.'),
      en: 'Snow likely: ' + tot + 'mm, temperatures ' + mn + '\u2013' + mx + '\u00b0C. Gusts ' + wnd + 'km/h.' + (significantWC ? ' Wind chill to ' + mfl + '\u00b0C.' : ' Caution on icy surfaces.'),
      fr: 'Neige probable\u00a0: ' + tot + 'mm, températures ' + mn + '\u2013' + mx + '\u00b0C. Rafales ' + wnd + 'km/h.' + (significantWC ? ' Ressenti\u00a0: ' + mfl + '\u00b0C.' : ' Prudence sur surfaces verglacées.'),
    }, lang),
  ], seed) + anomalySuffix

  // ── Very heavy rain ──
  if (s.totalPrecip > 20) return pickV([
    pick({
      ca: 'Pluges molt intenses: ' + tot + 'mm en 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Risc d\'inundacions puntuals; ràfegues fins a ' + wnd + 'km/h.' + wcNote,
      es: 'Lluvias muy intensas: ' + tot + 'mm en 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Riesgo de inundaciones; rachas hasta ' + wnd + 'km/h.' + wcNote,
      en: 'Very heavy rainfall: ' + tot + 'mm over 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Risk of localised flooding; gusts to ' + wnd + 'km/h.' + wcNote,
      fr: 'Pluies très fortes\u00a0: ' + tot + 'mm/48h. Températures ' + mn + '\u2013' + mx + '\u00b0C. Risque d\'inondations locales\u00a0; rafales à ' + wnd + 'km/h.' + wcNote,
    }, lang),
    pick({
      ca: 'Precipitació molt acumulada (' + tot + 'mm/48h). Màx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Vent ratxat a ' + wnd + 'km/h. Possibles afectacions per acumulació d\'aigua.' + wcNote,
      es: 'Precipitación muy acumulada (' + tot + 'mm/48h). Máx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Viento en racha a ' + wnd + 'km/h. Posibles afectaciones por acumulación de agua.' + wcNote,
      en: 'Very high rainfall totals (' + tot + 'mm/48h). High ' + mx + '\u00b0C, low ' + mn + '\u00b0C. Gusts ' + wnd + 'km/h. Possible disruption from surface water.' + wcNote,
      fr: 'Cumuls très élevés (' + tot + 'mm/48h). Max ' + mx + '\u00b0C, min ' + mn + '\u00b0C. Rafales à ' + wnd + 'km/h. Risque de perturbations liées aux eaux de surface.' + wcNote,
    }, lang),
  ], seed) + anomalySuffix

  // ── Moderate-heavy rain ──
  if (s.totalPrecip > 8) return pickV([
    pick({
      ca: 'Pluja moderada a intensa: ' + tot + 'mm en 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h.' + (wcNote || ' Episodis de pluja persistent esperats.'),
      es: 'Lluvia moderada a intensa: ' + tot + 'mm en 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h.' + (wcNote || ' Episodios de lluvia persistente esperados.'),
      en: 'Moderate to heavy rain: ' + tot + 'mm over 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind ' + wnd + 'km/h.' + (wcNote || ' Persistent rain spells likely.'),
      fr: 'Pluie modérée à forte\u00a0: ' + tot + 'mm/48h. Températures ' + mn + '\u2013' + mx + '\u00b0C. Vent ' + wnd + 'km/h.' + (wcNote || ' Épisodes pluvieux persistants attendus.'),
    }, lang),
    pick({
      ca: 'Temps plujós durant les pròximes 48h (' + tot + 'mm). Màx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Ràfegues de ' + wnd + 'km/h.' + (wcNote || ' Períodes de pluja continuada possibles.'),
      es: 'Tiempo lluvioso en las próximas 48h (' + tot + 'mm). Máx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Rachas de ' + wnd + 'km/h.' + (wcNote || ' Posibles periodos de lluvia continuada.'),
      en: 'Rainy conditions for the next 48h (' + tot + 'mm). High ' + mx + '\u00b0C, low ' + mn + '\u00b0C. Gusts ' + wnd + 'km/h.' + (wcNote || ' Spells of sustained rainfall possible.'),
      fr: 'Temps pluvieux pour les 48h à venir (' + tot + 'mm). Max ' + mx + '\u00b0C, min ' + mn + '\u00b0C. Rafales ' + wnd + 'km/h.' + (wcNote || ' Périodes de pluie prolongée possibles.'),
    }, lang),
  ], seed) + anomalySuffix

  // ── Light rain / showers ──
  if (s.totalPrecip > 2) return pickV([
    pick({
      ca: 'Intervals de pluja possibles (' + tot + 'mm/48h). Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h.' + (wcNote || ' Cel variable amb algun ruixat.'),
      es: 'Posibles intervalos de lluvia (' + tot + 'mm/48h). Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h.' + (wcNote || ' Cielo variable con algún chubasco.'),
      en: 'Scattered showers possible (' + tot + 'mm/48h). Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind ' + wnd + 'km/h.' + (wcNote || ' Variable skies with occasional rain.'),
      fr: 'Averses éparses possibles (' + tot + 'mm/48h). Températures ' + mn + '\u2013' + mx + '\u00b0C. Vent ' + wnd + 'km/h.' + (wcNote || ' Ciel variable avec quelques pluies.'),
    }, lang),
    pick({
      ca: 'Ruixats dispersos probables (' + tot + 'mm/48h). Màx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Ràfegues de ' + wnd + 'km/h. Intervals de sol entre els núvols.' + wcNote,
      es: 'Chubascos dispersos probables (' + tot + 'mm/48h). Máx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Rachas de ' + wnd + 'km/h. Intervalos de sol entre nubes.' + wcNote,
      en: 'Patchy showers likely (' + tot + 'mm/48h). High ' + mx + '\u00b0C, low ' + mn + '\u00b0C. Gusts ' + wnd + 'km/h. Some sunny spells between the clouds.' + wcNote,
      fr: 'Averses isolées probables (' + tot + 'mm/48h). Max ' + mx + '\u00b0C, min ' + mn + '\u00b0C. Rafales ' + wnd + 'km/h. Éclaircies entre les nuages.' + wcNote,
    }, lang),
  ], seed) + anomalySuffix

  // ── Very hot & dry ──
  if (avg > 28) return pickV([
    pick({
      ca: 'Temps molt calorós les pròximes 48h. Temperatures de ' + mn + ' a ' + mx + '\u00b0C. Vent ' + wnd + 'km/h. Sense precipitació prevista.',
      es: 'Tiempo muy cálido en las próximas 48h. Temperaturas de ' + mn + ' a ' + mx + '\u00b0C. Viento ' + wnd + 'km/h. Sin precipitación prevista.',
      en: 'Very hot conditions for the next 48h. Temperatures from ' + mn + ' to ' + mx + '\u00b0C. Wind ' + wnd + 'km/h. No rainfall expected.',
      fr: 'Temps très chaud pour les 48h. Températures de ' + mn + ' à ' + mx + '\u00b0C. Vent ' + wnd + 'km/h. Aucune précipitation prévue.',
    }, lang),
    pick({
      ca: 'Calor intensa: màxima de ' + mx + '\u00b0C, mínima de ' + mn + '\u00b0C. Vent ' + wnd + 'km/h. Cel serè, sense precipitació. Hores centrals especialment caloroses.',
      es: 'Calor intenso: máxima ' + mx + '\u00b0C, mínima ' + mn + '\u00b0C. Viento ' + wnd + 'km/h. Cielo despejado, sin precipitación. Horas centrales especialmente calurosas.',
      en: 'Intense heat: high ' + mx + '\u00b0C, low ' + mn + '\u00b0C. Wind ' + wnd + 'km/h. Clear skies, no rain. Midday hours will be particularly scorching.',
      fr: 'Chaleur intense\u00a0: max ' + mx + '\u00b0C, min ' + mn + '\u00b0C. Vent ' + wnd + 'km/h. Ciel dégagé, aucune pluie. Mi-journée particulièrement torride.',
    }, lang),
  ], seed) + anomalySuffix

  // ── Warm & dry ──
  if (avg > 20) return pickV([
    pick({
      ca: 'Temps agradable les pròximes 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent ' + wnd + 'km/h. Les nits poden ser fresques.',
      es: 'Tiempo agradable en las próximas 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento ' + wnd + 'km/h. Las noches pueden ser frescas.',
      en: 'Pleasant conditions for the next 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind ' + wnd + 'km/h. Nights may turn noticeably cooler.',
      fr: 'Temps agréable pour les 48h. Températures ' + mn + '\u2013' + mx + '\u00b0C. Vent ' + wnd + 'km/h. Nuits fraîches possibles.',
    }, lang),
    pick({
      ca: 'Condicions suaus: màx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Ràfegues de ' + wnd + 'km/h. Predominantment sec i assolellat. Bona visibilitat.',
      es: 'Condiciones suaves: máx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Rachas de ' + wnd + 'km/h. Predominantemente seco y soleado. Buena visibilidad.',
      en: 'Mild conditions: high ' + mx + '\u00b0C, low ' + mn + '\u00b0C. Gusts ' + wnd + 'km/h. Mostly dry and sunny. Good visibility throughout.',
      fr: 'Conditions douces\u00a0: max ' + mx + '\u00b0C, min ' + mn + '\u00b0C. Rafales ' + wnd + 'km/h. Largement sec et ensoleillé. Bonne visibilité.',
    }, lang),
  ], seed) + anomalySuffix

  // ── Cool & dry ──
  if (avg > 10) return pickV([
    pick({
      ca: 'Temps fresc i principalment sec. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent ' + wnd + 'km/h.' + wcNote,
      es: 'Tiempo fresco y principalmente seco. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento ' + wnd + 'km/h.' + wcNote,
      en: 'Cool and mostly dry. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind ' + wnd + 'km/h.' + wcNote,
      fr: 'Frais et principalement sec. Températures ' + mn + '\u2013' + mx + '\u00b0C. Vent ' + wnd + 'km/h.' + wcNote,
    }, lang),
    pick({
      ca: 'Màx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Ràfegues de ' + wnd + 'km/h. Sense precipitació significativa.' + (wcNote || ' Ambient fresc però confortable.'),
      es: 'Máx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Rachas de ' + wnd + 'km/h. Sin precipitación significativa.' + (wcNote || ' Ambiente fresco pero confortable.'),
      en: 'High ' + mx + '\u00b0C, low ' + mn + '\u00b0C. Gusts ' + wnd + 'km/h. No significant rain.' + (wcNote || ' Cool but comfortable.'),
      fr: 'Max ' + mx + '\u00b0C, min ' + mn + '\u00b0C. Rafales ' + wnd + 'km/h. Aucune précipitation significative.' + (wcNote || ' Frais mais confortable.'),
    }, lang),
  ], seed) + anomalySuffix

  // ── Cold & dry (fallback) ──
  return pickV([
    pick({
      ca: 'Temperatures fredes entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h.' + (significantWC ? ' Sensació tèrmica real de ' + fl + '\u00b0C. Fred accentuat pel vent.' : ' Temps sec. Possible gelada nocturna.'),
      es: 'Temperaturas frías entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h.' + (significantWC ? ' Sensación térmica de ' + fl + '\u00b0C. Frío acentuado por el viento.' : ' Tiempo seco. Posible helada nocturna.'),
      en: 'Cold temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind ' + wnd + 'km/h.' + (significantWC ? ' Wind chill to ' + fl + '\u00b0C. Biting cold in exposed areas.' : ' Dry. Possible overnight frost.'),
      fr: 'Températures froides ' + mn + '\u2013' + mx + '\u00b0C. Vent ' + wnd + 'km/h.' + (significantWC ? ' Ressenti ' + fl + '\u00b0C. Froid mordant au vent.' : ' Sec. Gel nocturne possible.'),
    }, lang),
    pick({
      ca: 'Fred intens: màx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Ràfegues de ' + wnd + 'km/h.' + (significantWC ? ' La sensació tèrmica baixa fins a ' + fl + '\u00b0C.' : ' Ambient sec i fred. Risc de gelades nocturnes.'),
      es: 'Frío intenso: máx ' + mx + '\u00b0C, mín ' + mn + '\u00b0C. Rachas de ' + wnd + 'km/h.' + (significantWC ? ' La sensación térmica baja hasta ' + fl + '\u00b0C.' : ' Ambiente seco y frío. Riesgo de heladas nocturnas.'),
      en: 'Intense cold: high ' + mx + '\u00b0C, low ' + mn + '\u00b0C. Gusts ' + wnd + 'km/h.' + (significantWC ? ' Real feel drops to ' + fl + '\u00b0C.' : ' Dry and frigid. Frost risk overnight.'),
      fr: 'Froid intense\u00a0: max ' + mx + '\u00b0C, min ' + mn + '\u00b0C. Rafales ' + wnd + 'km/h.' + (significantWC ? ' Ressenti réel jusqu\'à ' + fl + '\u00b0C.' : ' Sec et froid. Risque de gel la nuit.'),
    }, lang),
  ], seed) + anomalySuffix
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
  clima: ClimaStats | null = null,
) {
  const el = document.getElementById('predictionCard')
  if (!el) return
  if (!wxData || !Object.keys(wxData).length) { el.innerHTML = ''; return }

  const lang  = state.lang
  const stats = compute48hStats(wxData, clima)
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
