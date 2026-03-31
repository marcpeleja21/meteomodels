/**
 * Prediction card — rendered below the alerts banner.
 *
 * Computes hourly median values across all loaded models for the next 48 h
 * and produces:
 *   1. A weather prediction (~120 chars) — includes wind chill when relevant
 *   2. A clothes-recommendation sentence (~120 chars) — based on feels-like temp
 *
 * Wind chill uses the Canadian Environment / NOAA formula:
 *   WC = 13.12 + 0.6215·T − 11.37·V^0.16 + 0.3965·T·V^0.16
 *   valid for T ≤ 10 °C and V > 4.8 km/h
 *
 * All text is generated in the four supported languages (ca/es/en/fr).
 */
import { state } from '../state'
import type { OpenMeteoResponse } from '../types'

// ── Wind chill ────────────────────────────────────────────────────────────────

/**
 * Returns the "feels like" temperature (°C).
 * Applies Canadian wind chill index when T ≤ 10 °C and wind > 4.8 km/h,
 * otherwise returns the dry-bulb temperature unchanged.
 */
function windChill(tempC: number, windKmh: number): number {
  if (windKmh <= 4.8 || tempC > 10) return tempC
  const v16 = Math.pow(windKmh, 0.16)
  return 13.12 + 0.6215 * tempC - 11.37 * v16 + 0.3965 * tempC * v16
}

// ── Model weights ─────────────────────────────────────────────────────────────
//
// Priority models get a fixed relative weight (out of 100).
// All other present models share the remaining 35 points equally.
// If a priority model is absent its weight redistributes proportionally.

const PRIORITY_W: Record<string, number> = {
  arome_hd: 25,
  gfs:      20,
  ecmwf:    20,
}
const OTHER_SLOT = 35 // shared among non-priority models

/** Compute a weighted average given an array of {modelKey, val} pairs. */
function weightedAvg(vals: Array<{ k: string; v: number }>): number {
  if (vals.length === 0) return 0
  if (vals.length === 1) return vals[0].v

  const priority = vals.filter(x => PRIORITY_W[x.k] !== undefined)
  const others   = vals.filter(x => PRIORITY_W[x.k] === undefined)

  const perOther = others.length > 0 ? OTHER_SLOT / others.length : 0
  let totalW = 0
  for (const x of priority) totalW += PRIORITY_W[x.k]
  totalW += others.length * perOther

  let result = 0
  for (const x of priority) result += x.v * (PRIORITY_W[x.k] / totalW)
  for (const x of others)   result += x.v * (perOther / totalW)
  return result
}

// ── Stats extraction ──────────────────────────────────────────────────────────

interface Stats48h {
  avgTemp:      number   // weighted-average hourly temperature
  minTemp:      number   // hourly minimum (weighted)
  maxTemp:      number   // hourly maximum (weighted)
  totalPrecip:  number   // weighted-average accumulated mm over 48 h
  maxWind:      number   // km/h, weighted hourly max
  avgWind:      number   // km/h, weighted hourly average
  avgFeelsLike: number   // wind-chill-adjusted weighted average feels-like
  minFeelsLike: number   // wind-chill-adjusted minimum feels-like
  hasStorm:     boolean  // any thunderstorm weather codes detected
}

function compute48hStats(
  wxData: Record<string, OpenMeteoResponse | null>,
): Stats48h | null {
  const now = Date.now()
  const end = now + 48 * 3600_000

  // Per-timestamp, per-model values
  type ModelVal = { k: string; v: number }
  const tempMap:   Map<string, ModelVal[]> = new Map()
  const precipMap: Map<string, ModelVal[]> = new Map()
  const windMap:   Map<string, ModelVal[]> = new Map()
  const codeMap:   Map<string, ModelVal[]> = new Map()

  for (const [modelKey, data] of Object.entries(wxData)) {
    if (!data?.hourly) continue
    const { time, temperature_2m, precipitation, windspeed_10m, weathercode } = data.hourly
    for (let i = 0; i < time.length; i++) {
      const ts = new Date(time[i]).getTime()
      if (ts < now || ts > end) continue
      const k = time[i]
      if (!tempMap.has(k)) {
        tempMap.set(k, []);  precipMap.set(k, [])
        windMap.set(k, []);  codeMap.set(k, [])
      }
      if (temperature_2m?.[i] != null) tempMap.get(k)!.push({ k: modelKey, v: temperature_2m[i]! })
      if (precipitation?.[i]  != null) precipMap.get(k)!.push({ k: modelKey, v: precipitation[i]! })
      if (windspeed_10m?.[i]  != null) windMap.get(k)!.push({ k: modelKey, v: windspeed_10m[i]! })
      if (weathercode?.[i]    != null) codeMap.get(k)!.push({ k: modelKey, v: weathercode[i]! })
    }
  }

  if (tempMap.size === 0) return null

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
    // Storm: use majority vote — if weighted-avg code ≥ 95, storm present
    if (cVals.length && weightedAvg(cVals) >= 95) hasStorm = true
  }

  if (!wTemps.length) return null

  const avgTemp = wTemps.reduce((a, b) => a + b, 0) / wTemps.length
  const avgFL   = wFeelsLike.reduce((a, b) => a + b, 0) / wFeelsLike.length
  const avgWind = wWinds.length ? wWinds.reduce((a, b) => a + b, 0) / wWinds.length : 0

  return {
    avgTemp,
    minTemp:      Math.min(...wTemps),
    maxTemp:      Math.max(...wTemps),
    totalPrecip:  wPrecip.reduce((a, b) => a + b, 0),
    maxWind:      wWinds.length ? Math.max(...wWinds) : 0,
    avgWind:      Math.round(avgWind),
    avgFeelsLike: avgFL,
    minFeelsLike: Math.min(...wFeelsLike),
    hasStorm,
  }
}

// ── Text generation ───────────────────────────────────────────────────────────

type LangMap = Record<'ca' | 'es' | 'en' | 'fr', string>

function pick(m: LangMap, lang: string): string {
  return (m as Record<string, string>)[lang] ?? m.en
}

/* eslint-disable prefer-template */
function generatePrediction(s: Stats48h, lang: string): string {
  const mn  = Math.round(s.minTemp)
  const mx  = Math.round(s.maxTemp)
  const tot = Math.round(s.totalPrecip)
  const wnd = Math.round(s.maxWind)
  const avg = Math.round(s.avgTemp)
  const fl  = Math.round(s.avgFeelsLike)
  const mfl = Math.round(s.minFeelsLike)

  // How much colder it feels vs actual — used to inject wind chill note
  const wcDiff       = s.avgTemp - s.avgFeelsLike
  const significantWC = wcDiff >= 4 && s.avgTemp <= 15

  // Wind chill note appended to cold/dry scenarios
  const wcNote = significantWC ? pick({
    ca: ' Sensació tèrmica real de ' + fl + '\u00b0C pel vent (' + wnd + 'km/h).',
    es: ' Sensación térmica real de ' + fl + '\u00b0C por el viento (' + wnd + 'km/h).',
    en: ' Wind chill brings the real feel to ' + fl + '\u00b0C (' + wnd + 'km/h gusts).',
    fr: ' Le vent (' + wnd + 'km/h) ramène le ressenti à ' + fl + '\u00b0C réels.',
  }, lang) : ''

  if (s.hasStorm && s.totalPrecip > 5) return pick({
    ca: 'Tempestes previstes amb precipitació intensa (' + tot + 'mm en 48h). Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Ràfegues de vent fins a ' + wnd + 'km/h.' + (significantWC ? ' Sensació tèrmica de ' + fl + '\u00b0C.' : ''),
    es: 'Tormentas previstas con precipitación intensa (' + tot + 'mm en 48h). Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Rachas de viento de hasta ' + wnd + 'km/h.' + (significantWC ? ' Sensación térmica de ' + fl + '\u00b0C.' : ''),
    en: 'Storms forecast with heavy rainfall (' + tot + 'mm over 48h). Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind gusts up to ' + wnd + 'km/h.' + (significantWC ? ' Feels like ' + fl + '\u00b0C.' : ''),
    fr: 'Orages prévus avec fortes précipitations (' + tot + 'mm en 48h). Températures entre ' + mn + ' et ' + mx + '\u00b0C. Rafales jusqu\'à ' + wnd + 'km/h.' + (significantWC ? ' Ressenti\u00a0: ' + fl + '\u00b0C.' : ''),
  }, lang)

  if (s.maxTemp < 3 && s.totalPrecip > 1) return pick({
    ca: 'Possibles nevades les pròximes 48h (' + tot + 'mm acumulats). Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h.' + (significantWC ? ' Sensació tèrmica de ' + mfl + '\u00b0C.' : ' Superfícies lliscants probables.'),
    es: 'Posibles nevadas en las próximas 48h (' + tot + 'mm acumulados). Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h.' + (significantWC ? ' Sensación térmica de ' + mfl + '\u00b0C.' : ' Superficies resbaladizas probables.'),
    en: 'Possible snowfall over the next 48 hours (' + tot + 'mm). Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h.' + (significantWC ? ' Feels like ' + mfl + '\u00b0C with wind chill.' : ' Watch for icy, slippery surfaces.'),
    fr: 'Chutes de neige possibles dans les 48h (' + tot + 'mm). Températures entre ' + mn + ' et ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h.' + (significantWC ? ' Ressenti\u00a0: ' + mfl + '\u00b0C.' : ' Surfaces glissantes possibles.'),
  }, lang)

  if (s.totalPrecip > 20) return pick({
    ca: 'Pluges molt intenses: ' + tot + 'mm acumulats en 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Risc d\'inundacions puntuals; vent fins a ' + wnd + 'km/h.' + wcNote,
    es: 'Lluvias muy intensas: ' + tot + 'mm acumulados en 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Riesgo de inundaciones puntuales; viento hasta ' + wnd + 'km/h.' + wcNote,
    en: 'Very heavy rainfall: ' + tot + 'mm over 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Risk of localised flooding; wind gusts up to ' + wnd + 'km/h.' + wcNote,
    fr: 'Pluies très fortes\u00a0: ' + tot + 'mm en 48h. Températures entre ' + mn + ' et ' + mx + '\u00b0C. Risque d\'inondations locales\u00a0; vent jusqu\'à ' + wnd + 'km/h.' + wcNote,
  }, lang)

  if (s.totalPrecip > 8) return pick({
    ca: 'Pluja moderada a intensa: ' + tot + 'mm previstos en 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h.' + (wcNote || ' Episodis de pluja persistent esperats.'),
    es: 'Lluvia moderada a intensa: ' + tot + 'mm previstos en 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h.' + (wcNote || ' Episodios de lluvia persistente esperados.'),
    en: 'Moderate to heavy rain: ' + tot + 'mm expected over 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h.' + (wcNote || ' Persistent spells of rain likely.'),
    fr: 'Pluie modérée à forte\u00a0: ' + tot + 'mm en 48h. Températures entre ' + mn + ' et ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h.' + (wcNote || ' Épisodes pluvieux persistants attendus.'),
  }, lang)

  if (s.totalPrecip > 2) return pick({
    ca: 'Intervals de pluja possibles al llarg de les 48h (' + tot + 'mm). Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h.' + (wcNote || ' Cel variable amb algun ruixat.'),
    es: 'Posibles intervalos de lluvia a lo largo de 48h (' + tot + 'mm). Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h.' + (wcNote || ' Cielo variable con algún chubasco.'),
    en: 'Scattered rainfall possible over the next 48h (' + tot + 'mm total). Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h.' + (wcNote || ' Variable skies with occasional showers.'),
    fr: 'Intervalles pluvieux possibles sur 48h (' + tot + 'mm). Températures de ' + mn + ' à ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h.' + (wcNote || ' Ciel variable avec quelques averses.'),
  }, lang)

  if (avg > 28) return pick({
    ca: 'Temps molt calorós i assolellat les pròximes 48h. Temperatures de ' + mn + ' a ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h. Sense precipitació prevista.',
    es: 'Tiempo muy cálido y soleado en las próximas 48h. Temperaturas de ' + mn + ' a ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h. Sin precipitación prevista.',
    en: 'Very hot and sunny for the next 48 hours. Temperatures from ' + mn + ' to ' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h. No precipitation expected.',
    fr: 'Temps très chaud et ensoleillé pour les 48h à venir. Températures de ' + mn + ' à ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h. Aucune précipitation prévue.',
  }, lang)

  if (avg > 20) return pick({
    ca: 'Temps agradable i assolellat les pròximes 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h. Les nits poden ser fresques.',
    es: 'Tiempo agradable y soleado en las próximas 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h. Las noches pueden ser frescas.',
    en: 'Pleasant and sunny conditions over the next 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h. Nights may turn noticeably cooler.',
    fr: 'Temps agréable et ensoleillé pour les 48h à venir. Températures entre ' + mn + ' et ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h. Nuits fraîches possibles.',
  }, lang)

  if (avg > 10) return pick({
    ca: 'Temps fresc i principalment sec les pròximes 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h.' + wcNote,
    es: 'Tiempo fresco y principalmente seco en las próximas 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h.' + wcNote,
    en: 'Cool and mostly dry conditions over the next 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h.' + wcNote,
    fr: 'Temps frais et principalement sec pour les 48h à venir. Températures entre ' + mn + ' et ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h.' + wcNote,
  }, lang)

  // Cold / dry — always mention wind chill
  return pick({
    ca: 'Temperatures fredes entre ' + mn + ' i ' + mx + '\u00b0C les pròximes 48h. Vent fins a ' + wnd + 'km/h.' + (significantWC ? ' Sensació tèrmica real de ' + fl + '\u00b0C. Fred accentuat pel vent.' : ' Temps sec, sense precipitació prevista. Possible gelada nocturna.'),
    es: 'Temperaturas frías entre ' + mn + ' y ' + mx + '\u00b0C en las próximas 48h. Viento hasta ' + wnd + 'km/h.' + (significantWC ? ' Sensación térmica real de ' + fl + '\u00b0C. Frío acentuado por el viento.' : ' Tiempo seco, sin precipitación prevista. Posible helada nocturna.'),
    en: 'Cold temperatures between ' + mn + ' and ' + mx + '\u00b0C over the next 48 hours. Wind up to ' + wnd + 'km/h.' + (significantWC ? ' Wind chill brings the real feel to ' + fl + '\u00b0C. Biting cold when exposed.' : ' Dry conditions, no precipitation forecast. Possible overnight frost.'),
    fr: 'Températures froides entre ' + mn + ' et ' + mx + '\u00b0C dans les 48h. Vent jusqu\'à ' + wnd + 'km/h.' + (significantWC ? ' Le vent ramène le ressenti à ' + fl + '\u00b0C réels. Froid mordant.' : ' Temps sec, sans précipitation prévue. Gel nocturne possible.'),
  }, lang)
}

function generateClothesAdvice(s: Stats48h, lang: string): string {
  // Use feels-like temperature for all threshold decisions.
  // This means 5 °C actual + 30 km/h wind (~2 °C feels-like) → winter gear.
  const fl        = s.avgFeelsLike
  const mfl       = s.minFeelsLike
  const wnd       = Math.round(s.maxWind)
  const hasRain   = s.totalPrecip > 1
  const heavyRain = s.totalPrecip > 10
  const hasSnow   = s.maxTemp < 3 && s.totalPrecip > 0.5
  const veryWindy = s.maxWind > 55
  const windy     = s.maxWind > 35
  // Significant wind chill: actual temp noticeably warmer than feels-like
  const wcDiff    = s.avgTemp - fl
  const hasWC     = wcDiff >= 4 && s.avgTemp <= 15
  const wcSuffix  = hasWC ? pick({
    ca: ' La sensació tèrmica és de ' + Math.round(fl) + '\u00b0C pel vent (' + wnd + 'km/h).',
    es: ' La sensación térmica es de ' + Math.round(fl) + '\u00b0C por el viento (' + wnd + 'km/h).',
    en: ' Wind chill makes it feel like ' + Math.round(fl) + '\u00b0C (' + wnd + 'km/h wind).',
    fr: ' Le vent (' + wnd + 'km/h) fait ressentir ' + Math.round(fl) + '\u00b0C.',
  }, lang) : ''

  if (hasSnow) return pick({
    ca: 'Abric d\'hivern, capes tèrmiques, guants, gorra, bufanda i botes impermeables antilliscants imprescindibles.' + wcSuffix,
    es: 'Abrigo de invierno, capas térmicas, guantes, gorro, bufanda y botas impermeables antideslizantes imprescindibles.' + wcSuffix,
    en: 'Heavy winter coat, thermal layers, gloves, warm hat, scarf and waterproof non-slip boots are all essential.' + wcSuffix,
    fr: 'Manteau d\'hiver, couches thermiques, gants, bonnet, écharpe et bottes imperméables antidérapantes indispensables.' + wcSuffix,
  }, lang)

  // All thresholds below use feels-like (fl / mfl) not avgTemp
  if (fl < 0) return pick({
    ca: 'Fred extrem: abric d\'hivern, guants tèrmics, gorra, bufanda gruixuda i botes d\'hivern imprescindibles. Sensació de ' + Math.round(mfl) + '\u00b0C mínima.' + (veryWindy ? ' Para-vent obligatori.' : ''),
    es: 'Frío extremo: abrigo de invierno, guantes térmicos, gorro, bufanda gruesa y botas de invierno imprescindibles. Sensación de ' + Math.round(mfl) + '\u00b0C mínima.' + (veryWindy ? ' Cortavientos obligatorio.' : ''),
    en: 'Extreme cold: heavy winter coat, thermal gloves, hat, thick scarf and winter boots essential. Wind chill down to ' + Math.round(mfl) + '\u00b0C.' + (veryWindy ? ' Windproof layer mandatory.' : ''),
    fr: 'Grand froid\u00a0: manteau d\'hiver, gants thermiques, bonnet, écharpe épaisse et bottes d\'hiver indispensables. Ressenti jusqu\'à ' + Math.round(mfl) + '\u00b0C.' + (veryWindy ? ' Coupe-vent obligatoire.' : ''),
  }, lang)

  if (fl < 5) return pick({
    ca: veryWindy
      ? 'Abric d\'hivern, bufanda, guants i gorra imprescindibles. Molt ventós (' + wnd + 'km/h): la sensació tèrmica és de ' + Math.round(fl) + '\u00b0C. Capa para-vent necessària.'
      : 'Abric d\'hivern, bufanda, guants i gorra imprescindibles. Fred intens' + (hasWC ? ' amb sensació de ' + Math.round(fl) + '\u00b0C pel vent.' : ': porta capes tèrmiques per mantenir la calor.'),
    es: veryWindy
      ? 'Abrigo de invierno, bufanda, guantes y gorro imprescindibles. Muy ventoso (' + wnd + 'km/h): la sensación térmica es de ' + Math.round(fl) + '\u00b0C. Capa cortavientos necesaria.'
      : 'Abrigo de invierno, bufanda, guantes y gorro imprescindibles. Frío intenso' + (hasWC ? ' con sensación de ' + Math.round(fl) + '\u00b0C por el viento.' : ': lleva capas térmicas para mantener el calor.'),
    en: veryWindy
      ? 'Heavy winter coat, scarf, gloves and hat essential. Very windy (' + wnd + 'km/h): feels like ' + Math.round(fl) + '\u00b0C. A windproof outer layer is necessary.'
      : 'Heavy winter coat, scarf, gloves and hat essential. Intense cold' + (hasWC ? ' — feels like ' + Math.round(fl) + '\u00b0C with wind chill.' : ': add thermal underlayers to retain body heat.'),
    fr: veryWindy
      ? 'Manteau d\'hiver, écharpe, gants et bonnet indispensables. Vent fort (' + wnd + 'km/h)\u00a0: ressenti ' + Math.round(fl) + '\u00b0C. Coupe-vent nécessaire.'
      : 'Manteau d\'hiver, écharpe, gants et bonnet indispensables. Grand froid' + (hasWC ? '\u00a0: ressenti ' + Math.round(fl) + '\u00b0C avec le vent.' : '\u00a0: portez des sous-couches thermiques.'),
  }, lang)

  if (fl < 12) {
    if (heavyRain) return pick({
      ca: 'Jaqueta d\'hivern, jersei gruixut, botes impermeables i paraigua imprescindibles. Pluja intensa prevista.' + wcSuffix,
      es: 'Chaqueta de invierno, jersey grueso, botas impermeables y paraguas imprescindibles. Lluvia intensa prevista.' + wcSuffix,
      en: 'Winter jacket, thick jumper, waterproof boots and umbrella are a must. Heavy rain forecast.' + wcSuffix,
      fr: 'Veste d\'hiver, pull épais, bottes imperméables et parapluie indispensables. Fortes pluies prévues.' + wcSuffix,
    }, lang)
    if (hasRain) return pick({
      ca: 'Jaqueta tèrmica, jersei i paraigua recomanats. Temps fred i plujós; roba que s\'asseca ràpid i calçat impermeable.' + wcSuffix,
      es: 'Chaqueta térmica, jersey y paraguas recomendados. Tiempo frío y lluvioso; ropa de secado rápido y calzado impermeable.' + wcSuffix,
      en: 'Thermal jacket, jumper and umbrella recommended. Cold and rainy; opt for quick-dry fabrics and waterproof footwear.' + wcSuffix,
      fr: 'Veste thermique, pull et parapluie recommandés. Froid et pluvieux\u00a0; préférez tissus séchant vite et chaussures imperméables.' + wcSuffix,
    }, lang)
    return pick({
      ca: windy
        ? 'Jaqueta d\'hivern o abric de mig temps, jersei i capa para-vent. Vent de ' + wnd + 'km/h' + (hasWC ? ' fa sentir ' + Math.round(fl) + '\u00b0C' : '') + ': augmenta la sensació de fred.'
        : 'Jaqueta d\'hivern o abric de mig temps amb jersei. Temps fresc i sec; còmode per a activitats a l\'exterior.' + wcSuffix,
      es: windy
        ? 'Chaqueta de invierno o abrigo de entretiempo, jersey y capa cortavientos. Viento de ' + wnd + 'km/h' + (hasWC ? ' hace sentir ' + Math.round(fl) + '\u00b0C' : '') + ': aumenta la sensación de frío.'
        : 'Chaqueta de invierno o abrigo de entretiempo con jersey. Tiempo fresco y seco; cómodo para actividades al aire libre.' + wcSuffix,
      en: windy
        ? 'Winter jacket or mid-season coat with a jumper and windproof layer. ' + wnd + 'km/h wind' + (hasWC ? ' makes it feel like ' + Math.round(fl) + '\u00b0C' : '') + ': colder than it looks.'
        : 'Winter jacket or mid-season coat with a jumper. Cool and dry; comfortable for outdoor activities.' + wcSuffix,
      fr: windy
        ? 'Veste d\'hiver ou manteau mi-saison, pull et coupe-vent. Vent de ' + wnd + 'km/h' + (hasWC ? ' fait ressentir ' + Math.round(fl) + '\u00b0C' : '') + '\u00a0: accentue la sensation de froid.'
        : 'Veste d\'hiver ou manteau mi-saison avec pull. Temps frais et sec\u00a0; agréable pour les activités en extérieur.' + wcSuffix,
    }, lang)
  }

  if (fl < 18) {
    if (hasRain) return pick({
      ca: 'Jaqueta lleugera impermeable i paraigua recomanats. Temps fresc amb pluja; roba còmoda de mig temps i calçat resistent a l\'aigua.' + wcSuffix,
      es: 'Chaqueta ligera impermeable y paraguas recomendados. Fresco con lluvia; ropa cómoda de entretiempo y calzado resistente al agua.' + wcSuffix,
      en: 'Light waterproof jacket and umbrella recommended. Cool and wet; comfortable mid-season clothing and water-resistant footwear.' + wcSuffix,
      fr: 'Veste légère imperméable et parapluie recommandés. Frais et pluvieux\u00a0; vêtements mi-saison et chaussures résistantes à l\'eau.' + wcSuffix,
    }, lang)
    return pick({
      ca: 'Jaqueta lleugera o jersei. Temps fresc però agradable.' + (windy ? ' Vent de ' + wnd + 'km/h: porta una capa extra, la sensació és més fresca del que indica el termòmetre.' : ' Porta alguna capa extra per si refresca a la tarda.'),
      es: 'Chaqueta ligera o jersey. Tiempo fresco pero agradable.' + (windy ? ' Viento de ' + wnd + 'km/h: lleva una capa extra, la sensación es más fresca de lo que marca el termómetro.' : ' Lleva alguna capa extra por si refresca por la tarde.'),
      en: 'Light jacket or jumper. Cool but pleasant.' + (windy ? ' ' + wnd + 'km/h wind: bring an extra layer — it feels fresher than the thermometer suggests.' : ' Carry an extra layer in case temperatures drop in the evening.'),
      fr: 'Veste légère ou pull. Frais mais agréable.' + (windy ? ' Vent de ' + wnd + 'km/h\u00a0: prévoyez une couche en plus, le ressenti est plus frais que le thermomètre.' : ' Prévoyez une couche supplémentaire si les températures baissent le soir.'),
    }, lang)
  }

  if (fl < 26) {
    if (hasRain) return pick({
      ca: 'Roba còmoda i lleugera, paraigua i una jaqueta fina per als intervals de pluja o les estones de vent.' + wcSuffix,
      es: 'Ropa cómoda y ligera, paraguas y una chaqueta fina para los intervalos de lluvia o las rachas de viento.' + wcSuffix,
      en: 'Comfortable, light clothing with an umbrella and a thin jacket for rainy spells or gusty moments.' + wcSuffix,
      fr: 'Vêtements légers et confortables, parapluie et veste fine pour les intervalles pluvieux ou les coups de vent.' + wcSuffix,
    }, lang)
    return pick({
      ca: 'Roba còmoda i lleugera. Porta una capa extra per al vespre o si bufa el vent; el temps és agradable durant el dia.',
      es: 'Ropa cómoda y ligera. Lleva una capa extra para la tarde o si hay viento; el tiempo es agradable durante el día.',
      en: 'Comfortable, light clothing. Bring an extra layer for the evening or in case the wind picks up; pleasant daytime conditions.',
      fr: 'Vêtements légers et confortables. Prévoyez une couche supplémentaire pour le soir ou en cas de vent\u00a0; journée agréable.',
    }, lang)
  }

  // Hot (≥26 °C feels-like)
  if (hasRain) return pick({
    ca: 'Roba lleugera d\'estiu, protecció solar (FPS 30+) i paraigua o poncho impermeable lleuger per als possibles ruixats.',
    es: 'Ropa ligera de verano, protección solar (FPS 30+) y paraguas o poncho impermeable ligero para los posibles chubascos.',
    en: 'Light summer clothes, sun protection (SPF 30+) and a compact umbrella or light rain poncho for possible showers.',
    fr: 'Vêtements légers d\'été, protection solaire (FPS 30+) et parapluie compact ou poncho léger pour les averses possibles.',
  }, lang)

  return pick({
    ca: 'Roba lleugera d\'estiu, gorra o barret i protecció solar FPS 30+. Mantén-te ben hidratat i busca l\'ombra a les hores centrals.',
    es: 'Ropa ligera de verano, gorra o sombrero y protección solar FPS 30+. Mantente bien hidratado y busca la sombra en las horas centrales.',
    en: 'Light summer clothes, hat and SPF 30+ sun protection. Stay well hydrated and seek shade during the hottest part of the day.',
    fr: 'Vêtements légers d\'été, chapeau et protection solaire FPS 30+. Restez bien hydraté et recherchez l\'ombre aux heures les plus chaudes.',
  }, lang)
}
/* eslint-enable prefer-template */

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderPredictionCard(
  wxData: Record<string, OpenMeteoResponse | null>,
) {
  const el = document.getElementById('predictionCard')
  if (!el) return

  if (!wxData || Object.keys(wxData).length === 0) {
    el.innerHTML = ''
    return
  }

  const lang  = state.lang
  const stats = compute48hStats(wxData)
  if (!stats) { el.innerHTML = ''; return }

  const prediction    = generatePrediction(stats, lang)
  const clothesAdvice = generateClothesAdvice(stats, lang)

  // Condition icon — driven by feels-like for cold/windy accuracy
  let condIcon = '⛅'
  if (stats.hasStorm || stats.totalPrecip > 15)              condIcon = '⛈️'
  else if (stats.maxTemp < 3 && stats.totalPrecip > 0.5)     condIcon = '❄️'
  else if (stats.totalPrecip > 8)                            condIcon = '🌧️'
  else if (stats.totalPrecip > 1)                            condIcon = '🌦️'
  else if (stats.avgFeelsLike < 2)                           condIcon = '🥶'
  else if (stats.avgTemp > 28)                               condIcon = '☀️'
  else if (stats.avgTemp > 20)                               condIcon = '🌤️'

  // Clothes icon — driven by feels-like
  const fl = stats.avgFeelsLike
  let clothesIcon = '🧥'
  if (fl > 25 && stats.totalPrecip < 1)                      clothesIcon = '👕'
  else if (stats.totalPrecip > 1)                            clothesIcon = '☂️'
  else if (fl > 15)                                          clothesIcon = '🧣'
  else if (fl < 0)                                           clothesIcon = '🧤'

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
  const INFO_TOOLTIP: Record<string, string> = {
    ca: 'Mitjana ponderada dels models disponibles:\nAROME HD 25% · GFS 20% · ECMWF 20%\nResta repartida a parts iguals entre ICON, ICON EU, ARPEGE i altres.\nS\'aplica wind chill quan T ≤ 10 °C i vent > 5 km/h.',
    es: 'Media ponderada de los modelos disponibles:\nAROME HD 25% · GFS 20% · ECMWF 20%\nEl resto se reparte a partes iguales entre ICON, ICON EU, ARPEGE y otros.\nSe aplica sensación térmica cuando T ≤ 10 °C y viento > 5 km/h.',
    en: 'Weighted average of available models:\nAROME HD 25% · GFS 20% · ECMWF 20%\nRemaining 35% split equally among ICON, ICON EU, ARPEGE and others.\nWind chill applied when T ≤ 10 °C and wind > 5 km/h.',
    fr: 'Moyenne pondérée des modèles disponibles :\nAROME HD 25% · GFS 20% · ECMWF 20%\nLes 35% restants répartis entre ICON, ICON EU, ARPEGE et autres.\nRefroidissement éolien appliqué quand T ≤ 10 °C et vent > 5 km/h.',
  }

  const tl      = TITLE_LABEL[lang]  ?? TITLE_LABEL.en
  const cl      = CLOTHES_LABEL[lang] ?? CLOTHES_LABEL.en
  const tipText = (INFO_TOOLTIP[lang] ?? INFO_TOOLTIP.en).replace(/'/g, '&#39;').replace(/"/g, '&quot;')

  el.innerHTML =
    '<div class="prediction-card">' +
      '<div class="prediction-row">' +
        '<div class="prediction-item">' +
          '<div class="prediction-item-header">' +
            '<span class="prediction-icon" aria-hidden="true">' + condIcon + '</span>' +
            '<span class="prediction-label">' + tl + '</span>' +
            '<span class="pred-info-btn" aria-label="Model info" tabindex="0">' +
              'ⓘ' +
              '<span class="pred-info-tooltip">' + tipText + '</span>' +
            '</span>' +
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
