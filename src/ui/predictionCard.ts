/**
 * Prediction card — rendered below the alerts banner.
 *
 * Computes hourly median values across all loaded models for the next 48 h
 * and produces:
 *   1. A weather prediction (~120 chars)
 *   2. A clothes-recommendation sentence (~120 chars)
 *
 * All text is generated in the four supported languages (ca/es/en/fr).
 */
import { state } from '../state'
import type { OpenMeteoResponse } from '../types'

// ── Stats extraction ──────────────────────────────────────────────────────────

interface Stats48h {
  avgTemp:    number
  minTemp:    number
  maxTemp:    number
  totalPrecip: number   // median-model accumulated mm over 48 h
  maxWind:    number    // km/h, per-step median max
  hasStorm:   boolean   // any thunderstorm weather codes detected
}

function stepMedian(arr: number[]): number {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function compute48hStats(
  wxData: Record<string, OpenMeteoResponse | null>,
): Stats48h | null {
  const now  = Date.now()
  const end  = now + 48 * 3600_000

  const tempMap:   Map<string, number[]> = new Map()
  const precipMap: Map<string, number[]> = new Map()
  const windMap:   Map<string, number[]> = new Map()
  const codeMap:   Map<string, number[]> = new Map()

  for (const data of Object.values(wxData)) {
    if (!data?.hourly) continue
    const { time, temperature_2m, precipitation, windspeed_10m, weathercode } = data.hourly
    for (let i = 0; i < time.length; i++) {
      const ts = new Date(time[i]).getTime()
      if (ts < now || ts > end) continue
      const k = time[i]
      if (!tempMap.has(k)) {
        tempMap.set(k, [])
        precipMap.set(k, [])
        windMap.set(k, [])
        codeMap.set(k, [])
      }
      if (temperature_2m[i] != null) tempMap.get(k)!.push(temperature_2m[i]!)
      if (precipitation[i] != null)  precipMap.get(k)!.push(precipitation[i]!)
      if (windspeed_10m[i] != null)  windMap.get(k)!.push(windspeed_10m[i]!)
      if (weathercode[i] != null)    codeMap.get(k)!.push(weathercode[i]!)
    }
  }

  if (tempMap.size === 0) return null

  const mTemps:  number[] = []
  const mPrecip: number[] = []
  const mWinds:  number[] = []
  let   hasStorm = false

  for (const k of tempMap.keys()) {
    const t = tempMap.get(k)!
    const p = precipMap.get(k) ?? []
    const w = windMap.get(k) ?? []
    const c = codeMap.get(k) ?? []
    if (t.length) mTemps.push(stepMedian(t))
    if (p.length) mPrecip.push(stepMedian(p))
    if (w.length) mWinds.push(stepMedian(w))
    if (c.length && stepMedian(c) >= 95) hasStorm = true
  }

  if (!mTemps.length) return null

  return {
    avgTemp:     mTemps.reduce((a, b) => a + b, 0) / mTemps.length,
    minTemp:     Math.min(...mTemps),
    maxTemp:     Math.max(...mTemps),
    totalPrecip: mPrecip.reduce((a, b) => a + b, 0),
    maxWind:     mWinds.length ? Math.max(...mWinds) : 0,
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

  if (s.hasStorm && s.totalPrecip > 5) return pick({
    ca: 'Tempestes previstes amb precipitació intensa (' + tot + 'mm en 48h). Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Ràfegues de vent fins a ' + wnd + 'km/h.',
    es: 'Tormentas previstas con precipitación intensa (' + tot + 'mm en 48h). Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Rachas de viento de hasta ' + wnd + 'km/h.',
    en: 'Storms forecast with heavy rainfall (' + tot + 'mm over 48h). Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind gusts expected up to ' + wnd + 'km/h.',
    fr: 'Orages prévus avec fortes précipitations (' + tot + 'mm en 48h). Températures entre ' + mn + ' et ' + mx + '\u00b0C. Rafales de vent jusqu\'à ' + wnd + 'km/h.',
  }, lang)

  if (s.maxTemp < 3 && s.totalPrecip > 1) return pick({
    ca: 'Possibles nevades les pròximes 48h (' + tot + 'mm acumulats). Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h. Superfícies lliscants probables.',
    es: 'Posibles nevadas en las próximas 48h (' + tot + 'mm acumulados). Temperatures entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h. Superficies resbaladizas probables.',
    en: 'Possible snowfall over the next 48 hours (' + tot + 'mm). Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h. Watch out for icy and slippery surfaces.',
    fr: 'Chutes de neige possibles dans les 48h (' + tot + 'mm). Températures entre ' + mn + ' et ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h. Surfaces glissantes possibles.',
  }, lang)

  if (s.totalPrecip > 20) return pick({
    ca: 'Pluges molt intenses: ' + tot + 'mm acumulats en 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Risc d\'inundacions puntuals; vent fins a ' + wnd + 'km/h.',
    es: 'Lluvias muy intensas: ' + tot + 'mm acumulados en 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Riesgo de inundaciones puntuales; viento hasta ' + wnd + 'km/h.',
    en: 'Very heavy rainfall: ' + tot + 'mm accumulation over 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Risk of localised flooding; wind gusts up to ' + wnd + 'km/h.',
    fr: 'Pluies très fortes\u00a0: ' + tot + 'mm cumulés en 48h. Températures entre ' + mn + ' et ' + mx + '\u00b0C. Risque d\'inondations locales\u00a0; vent jusqu\'à ' + wnd + 'km/h.',
  }, lang)

  if (s.totalPrecip > 8) return pick({
    ca: 'Pluja moderada a intensa: ' + tot + 'mm previstos en 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h. Episodis de pluja persistent esperats.',
    es: 'Lluvia moderada a intensa: ' + tot + 'mm previstos en 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h. Episodios de lluvia persistente esperados.',
    en: 'Moderate to heavy rain: ' + tot + 'mm expected over 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h. Persistent spells of rain likely.',
    fr: 'Pluie modérée à forte\u00a0: ' + tot + 'mm prévus en 48h. Températures entre ' + mn + ' et ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h. Épisodes pluvieux persistants attendus.',
  }, lang)

  if (s.totalPrecip > 2) return pick({
    ca: 'Intervals de pluja possibles al llarg de les 48h (' + tot + 'mm). Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h. Cel variable amb algun ruixat.',
    es: 'Posibles intervalos de lluvia a lo largo de 48h (' + tot + 'mm). Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h. Cielo variable con algún chubasco.',
    en: 'Scattered rainfall possible over the next 48h (' + tot + 'mm total). Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h. Variable skies with occasional showers.',
    fr: 'Intervalles pluvieux possibles sur 48h (' + tot + 'mm). Températures de ' + mn + ' à ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h. Ciel variable avec quelques averses.',
  }, lang)

  if (avg > 28) return pick({
    ca: 'Temps molt calorós i assolellat les pròximes 48h. Temperatures de ' + mn + ' a ' + mx + '\u00b0C. Vent feble fins a ' + wnd + 'km/h. Sense precipitació prevista.',
    es: 'Tiempo muy cálido y soleado en las próximas 48h. Temperaturas de ' + mn + ' a ' + mx + '\u00b0C. Viento suave hasta ' + wnd + 'km/h. Sin precipitación prevista.',
    en: 'Very hot and sunny for the next 48 hours. Temperatures from ' + mn + ' to ' + mx + '\u00b0C. Light wind up to ' + wnd + 'km/h. No precipitation expected.',
    fr: 'Temps très chaud et ensoleillé pour les 48h à venir. Températures de ' + mn + ' à ' + mx + '\u00b0C. Vent faible jusqu\'à ' + wnd + 'km/h. Aucune précipitation prévue.',
  }, lang)

  if (avg > 20) return pick({
    ca: 'Temps agradable i assolellat les pròximes 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h. Les nits poden ser fresques.',
    es: 'Tiempo agradable y soleado en las próximas 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h. Las noches pueden ser frescas.',
    en: 'Pleasant and sunny conditions over the next 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h. Nights may turn noticeably cooler.',
    fr: 'Temps agréable et ensoleillé pour les 48h à venir. Températures entre ' + mn + ' et ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h. Nuits fraîches possibles.',
  }, lang)

  if (avg > 10) return pick({
    ca: 'Temps fresc i principalment sec les pròximes 48h. Temperatures entre ' + mn + ' i ' + mx + '\u00b0C. Vent fins a ' + wnd + 'km/h. Cap precipitació significativa prevista.',
    es: 'Tiempo fresco y principalmente seco en las próximas 48h. Temperaturas entre ' + mn + ' y ' + mx + '\u00b0C. Viento hasta ' + wnd + 'km/h. Sin precipitación significativa prevista.',
    en: 'Cool and mostly dry conditions over the next 48h. Temperatures ' + mn + '\u2013' + mx + '\u00b0C. Wind up to ' + wnd + 'km/h. No significant precipitation expected.',
    fr: 'Temps frais et principalement sec pour les 48h à venir. Températures entre ' + mn + ' et ' + mx + '\u00b0C. Vent jusqu\'à ' + wnd + 'km/h. Aucune précipitation significative prévue.',
  }, lang)

  return pick({
    ca: 'Temperatures fredes entre ' + mn + ' i ' + mx + '\u00b0C les pròximes 48h. Vent fins a ' + wnd + 'km/h. Temps sec, sense precipitació prevista. Possible gelada nocturna.',
    es: 'Temperaturas frías entre ' + mn + ' y ' + mx + '\u00b0C en las próximas 48h. Viento hasta ' + wnd + 'km/h. Tiempo seco, sin precipitación prevista. Posible helada nocturna.',
    en: 'Cold temperatures between ' + mn + ' and ' + mx + '\u00b0C over the next 48 hours. Wind up to ' + wnd + 'km/h. Dry conditions, no precipitation forecast. Possible overnight frost.',
    fr: 'Températures froides entre ' + mn + ' et ' + mx + '\u00b0C dans les 48h. Vent jusqu\'à ' + wnd + 'km/h. Temps sec, sans précipitation prévue. Gel nocturne possible.',
  }, lang)
}

function generateClothesAdvice(s: Stats48h, lang: string): string {
  const avg       = s.avgTemp
  const hasRain   = s.totalPrecip > 1
  const heavyRain = s.totalPrecip > 10
  const hasSnow   = s.maxTemp < 3 && s.totalPrecip > 0.5
  const veryWindy = s.maxWind > 55
  const windy     = s.maxWind > 35

  if (hasSnow) return pick({
    ca: 'Abric d\'hivern, capes tèrmiques, guants, gorra, bufanda i botes impermeables antilliscants imprescindibles.',
    es: 'Abrigo de invierno, capas térmicas, guantes, gorro, bufanda y botas impermeables antideslizantes imprescindibles.',
    en: 'Heavy winter coat, thermal layers, gloves, warm hat, scarf and waterproof non-slip boots are all essential today.',
    fr: 'Manteau d\'hiver, couches thermiques, gants, bonnet, écharpe et bottes imperméables antidérapantes indispensables.',
  }, lang)

  if (avg < 5) return pick({
    ca: veryWindy
      ? 'Abric d\'hivern, bufanda, guants i gorra imprescindibles. Molt ventós: afegeix una capa para-vent per protegir-te del fred.'
      : 'Abric d\'hivern, bufanda, guants i gorra imprescindibles. Fred molt intens: porta capes tèrmiques per mantenir la calor.',
    es: veryWindy
      ? 'Abrigo de invierno, bufanda, guantes y gorro imprescindibles. Mucho viento: añade una capa cortavientos para protegerte del frío.'
      : 'Abrigo de invierno, bufanda, guantes y gorro imprescindibles. Frío muy intenso: lleva capas térmicas para mantener el calor.',
    en: veryWindy
      ? 'Heavy winter coat, scarf, gloves and hat are essential. Very windy: add a windproof outer layer to stay warm and protected.'
      : 'Heavy winter coat, scarf, gloves and hat are essential. Intense cold: add thermal underlayers to retain body heat.',
    fr: veryWindy
      ? 'Manteau d\'hiver, écharpe, gants et bonnet indispensables. Vent fort\u00a0: ajoutez un coupe-vent pour vous protéger du froid.'
      : 'Manteau d\'hiver, écharpe, gants et bonnet indispensables. Grand froid\u00a0: portez des sous-couches thermiques pour garder la chaleur.',
  }, lang)

  if (avg < 12) {
    if (heavyRain) return pick({
      ca: 'Jaqueta d\'hivern, jersei gruixut, botes impermeables i paraigua imprescindibles. Pluja intensa prevista; evita sortir si no és necessari.',
      es: 'Chaqueta de invierno, jersey grueso, botas impermeables y paraguas imprescindibles. Lluvia intensa prevista; evita salir si no es necesario.',
      en: 'Winter jacket, thick jumper, waterproof boots and umbrella are a must. Heavy rain forecast; avoid going out unless necessary.',
      fr: 'Veste d\'hiver, pull épais, bottes imperméables et parapluie indispensables. Fortes pluies prévues\u00a0; évitez de sortir si possible.',
    }, lang)
    if (hasRain) return pick({
      ca: 'Jaqueta tèrmica, jersei i paraigua recomanats. Temps fred i plujós; porta roba que s\'asseca ràpid i calçat impermeable.',
      es: 'Chaqueta térmica, jersey y paraguas recomendados. Tiempo frío y lluvioso; lleva ropa que se seca rápido y calzado impermeable.',
      en: 'Thermal jacket, jumper and umbrella are recommended. Cold and rainy; opt for quick-dry fabrics and waterproof footwear.',
      fr: 'Veste thermique, pull et parapluie recommandés. Temps froid et pluvieux\u00a0; préférez des tissus séchant vite et des chaussures imperméables.',
    }, lang)
    return pick({
      ca: windy
        ? 'Jaqueta d\'hivern o abric de mig temps, jersei i capa para-vent. Vent moderat que augmenta la sensació de fred.'
        : 'Jaqueta d\'hivern o abric de mig temps amb jersei. Temps fresc i sec; còmode per a activitats a l\'exterior.',
      es: windy
        ? 'Chaqueta de invierno o abrigo de entretiempo, jersey y capa cortavientos. El viento moderado aumenta la sensación de frío.'
        : 'Chaqueta de invierno o abrigo de entretiempo con jersey. Tiempo fresco y seco; cómodo para actividades al aire libre.',
      en: windy
        ? 'Winter jacket or mid-season coat with a jumper and a windproof layer. Moderate wind will make it feel colder than it is.'
        : 'Winter jacket or mid-season coat with a jumper. Cool and dry; comfortable for outdoor activities.',
      fr: windy
        ? 'Veste d\'hiver ou manteau mi-saison, pull et coupe-vent. Le vent modéré accentue la sensation de froid.'
        : 'Veste d\'hiver ou manteau mi-saison avec pull. Temps frais et sec\u00a0; agréable pour les activités en extérieur.',
    }, lang)
  }

  if (avg < 18) {
    if (hasRain) return pick({
      ca: 'Jaqueta lleugera impermeable i paraigua recomanats. Temps fresc amb pluja; roba còmoda de mig temps i calçat resistent a l\'aigua.',
      es: 'Chaqueta ligera impermeable y paraguas recomendados. Tiempo fresco con lluvia; ropa cómoda de entretiempo y calzado resistente al agua.',
      en: 'Light waterproof jacket and umbrella are recommended. Cool and wet; comfortable mid-season clothing and water-resistant footwear.',
      fr: 'Veste légère imperméable et parapluie recommandés. Frais et pluvieux\u00a0; vêtements mi-saison confortables et chaussures résistantes à l\'eau.',
    }, lang)
    return pick({
      ca: 'Jaqueta lleugera o jerseis. Temps fresc però agradable, ideal per a capes fines. Porta alguna capa extra per si refresca.',
      es: 'Chaqueta ligera o jerseis. Tiempo fresco pero agradable, ideal para capas finas. Lleva alguna capa extra por si refresca.',
      en: 'Light jacket or jumper. Cool but pleasant; ideal for layering. Carry an extra layer in case temperatures drop later.',
      fr: 'Veste légère ou pull. Temps frais mais agréable, idéal pour les couches légères. Prévoyez une couche en plus si les températures baissent.',
    }, lang)
  }

  if (avg < 26) {
    if (hasRain) return pick({
      ca: 'Roba còmoda i lleugera, paraigua i una jaqueta fina per als intervals de pluja o les estones de vent.',
      es: 'Ropa cómoda y ligera, paraguas y una chaqueta fina para los intervalos de lluvia o las rachas de viento.',
      en: 'Comfortable, light clothing with an umbrella and a thin jacket for rainy spells or gusty moments.',
      fr: 'Vêtements légers et confortables, parapluie et veste fine pour les intervalles pluvieux ou les coups de vent.',
    }, lang)
    return pick({
      ca: 'Roba còmoda i lleugera. Porta una capa extra per al vespre o si bufa el vent; el temps és agradable durant el dia.',
      es: 'Ropa cómoda y ligera. Lleva una capa extra para la tarde o si hay viento; el tiempo es agradable durante el día.',
      en: 'Comfortable, light clothing. Bring an extra layer for the evening or in case the wind picks up; pleasant daytime conditions.',
      fr: 'Vêtements légers et confortables. Prévoyez une couche supplémentaire pour le soir ou en cas de vent\u00a0; journée agréable.',
    }, lang)
  }

  // Hot (≥26°C avg)
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

  // Condition icon
  let condIcon = '⛅'
  if (stats.hasStorm || stats.totalPrecip > 15)            condIcon = '⛈️'
  else if (stats.maxTemp < 3 && stats.totalPrecip > 0.5)   condIcon = '❄️'
  else if (stats.totalPrecip > 8)                          condIcon = '🌧️'
  else if (stats.totalPrecip > 1)                          condIcon = '🌦️'
  else if (stats.avgTemp > 28)                             condIcon = '☀️'
  else if (stats.avgTemp > 20)                             condIcon = '🌤️'

  // Clothes icon
  let clothesIcon = '🧥'
  if (stats.avgTemp > 25 && stats.totalPrecip < 1)         clothesIcon = '👕'
  else if (stats.totalPrecip > 1)                          clothesIcon = '☂️'
  else if (stats.avgTemp > 15)                             clothesIcon = '🧣'

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

  const tl = TITLE_LABEL[lang] ?? TITLE_LABEL.en
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
