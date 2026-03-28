/**
 * Prediction card — rendered below the alerts banner.
 *
 * Computes hourly median values across all loaded models for the next 48 h
 * and produces:
 *   1. A short weather prediction (~80–100 chars)
 *   2. A clothes-recommendation sentence (~80–100 chars)
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

  // Accumulate model readings per ISO time key
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

  // Build per-step medians, then aggregate
  const mTemps: number[] = []
  const mPrecip: number[] = []
  const mWinds: number[] = []
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

function generatePrediction(s: Stats48h, lang: string): string {
  const mn  = Math.round(s.minTemp)
  const mx  = Math.round(s.maxTemp)
  const tot = Math.round(s.totalPrecip)

  if (s.hasStorm && s.totalPrecip > 5) return pick({
    ca: `Tempestes previstes amb precipitació intensa (${tot}mm/48h). Temp. entre ${mn} i ${mx}°C.`,
    es: `Tormentas previstas con precipitación intensa (${tot}mm/48h). Temp. entre ${mn} y ${mx}°C.`,
    en: `Storms forecast with heavy rainfall (${tot}mm/48h). Temperatures between ${mn} and ${mx}°C.`,
    fr: `Orages prévus avec fortes précipitations (${tot}mm/48h). Temp. entre ${mn} et ${mx}°C.`,
  }, lang)

  if (s.maxTemp < 3 && s.totalPrecip > 1) return pick({
    ca: `Possibles nevades les pròximes 48h (${tot}mm). Temperatures entre ${mn} i ${mx}°C.`,
    es: `Posibles nevadas en las próximas 48h (${tot}mm). Temperaturas entre ${mn} y ${mx}°C.`,
    en: `Possible snowfall in the next 48 hours (${tot}mm). Temperatures between ${mn} and ${mx}°C.`,
    fr: `Chutes de neige possibles dans les 48h (${tot}mm). Températures entre ${mn} et ${mx}°C.`,
  }, lang)

  if (s.totalPrecip > 20) return pick({
    ca: `Pluges molt intenses previstes, ${tot}mm acumulats en 48h. Temp. entre ${mn} i ${mx}°C.`,
    es: `Lluvias muy intensas previstas, ${tot}mm acumulados en 48h. Temp. entre ${mn} y ${mx}°C.`,
    en: `Very heavy rainfall forecast, ${tot}mm accumulation in 48h. Temperatures ${mn}–${mx}°C.`,
    fr: `Très fortes pluies prévues, ${tot}mm cumulés en 48h. Températures entre ${mn} et ${mx}°C.`,
  }, lang)

  if (s.totalPrecip > 8) return pick({
    ca: `Pluja moderada a intensa, ${tot}mm esperats en 48h. Temperatures entre ${mn} i ${mx}°C.`,
    es: `Lluvia moderada a intensa, ${tot}mm esperados en 48h. Temperaturas entre ${mn} y ${mx}°C.`,
    en: `Moderate to heavy rain, ${tot}mm expected over 48h. Temperatures between ${mn} and ${mx}°C.`,
    fr: `Pluie modérée à forte, ${tot}mm prévus en 48h. Températures entre ${mn} et ${mx}°C.`,
  }, lang)

  if (s.totalPrecip > 2) return pick({
    ca: `Intervals de pluja possibles (${tot}mm/48h). Temperatures entre ${mn} i ${mx}°C.`,
    es: `Posibles intervalos de lluvia (${tot}mm/48h). Temperaturas entre ${mn} y ${mx}°C.`,
    en: `Some rainfall possible (${tot}mm over 48h). Temperatures ranging from ${mn} to ${mx}°C.`,
    fr: `Intervalles pluvieux possibles (${tot}mm/48h). Températures de ${mn} à ${mx}°C.`,
  }, lang)

  // Dry scenarios
  const avg = Math.round(s.avgTemp)
  if (avg > 28) return pick({
    ca: `Temps molt calorós i assolellat. Temperatures de ${mn}–${mx}°C. Sense pluja prevista.`,
    es: `Tiempo muy cálido y soleado. Temperaturas de ${mn}–${mx}°C. Sin lluvia prevista.`,
    en: `Very hot and sunny. Temperatures from ${mn} to ${mx}°C. No precipitation expected.`,
    fr: `Temps très chaud et ensoleillé. Températures de ${mn} à ${mx}°C. Pas de pluie prévue.`,
  }, lang)

  if (avg > 20) return pick({
    ca: `Temps agradable i assolellat. Temperatures entre ${mn} i ${mx}°C. Sense precipitació.`,
    es: `Tiempo agradable y soleado. Temperaturas entre ${mn} y ${mx}°C. Sin precipitación.`,
    en: `Pleasant and sunny conditions. Temperatures between ${mn} and ${mx}°C. No rain expected.`,
    fr: `Temps agréable et ensoleillé. Températures entre ${mn} et ${mx}°C. Pas de pluie.`,
  }, lang)

  if (avg > 10) return pick({
    ca: `Temps fresc i principalment sec. Temperatures entre ${mn} i ${mx}°C. Sense precipitació.`,
    es: `Tiempo fresco y principalmente seco. Temperaturas entre ${mn} y ${mx}°C. Sin precipitación.`,
    en: `Cool and mostly dry. Temperatures between ${mn} and ${mx}°C. No significant precipitation.`,
    fr: `Temps frais et principalement sec. Températures entre ${mn} et ${mx}°C. Sans précipitation.`,
  }, lang)

  return pick({
    ca: `Temperatures fredes entre ${mn} i ${mx}°C. Temps sec, sense precipitació prevista.`,
    es: `Temperaturas frías entre ${mn} y ${mx}°C. Tiempo seco, sin precipitación prevista.`,
    en: `Cold temperatures from ${mn} to ${mx}°C. Dry conditions, no precipitation forecast.`,
    fr: `Températures froides de ${mn} à ${mx}°C. Temps sec, aucune précipitation prévue.`,
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
    ca: `Abric d'hivern, capes tèrmiques, guants, gorra i botes impermeables antilliscants.`,
    es: `Abrigo de invierno, capas térmicas, guantes, gorro y botas impermeables antideslizantes.`,
    en: `Heavy winter coat, thermal layers, gloves, warm hat and waterproof non-slip boots.`,
    fr: `Manteau d'hiver, couches thermiques, gants, bonnet et bottes imperméables antidérapantes.`,
  }, lang)

  if (avg < 5) return pick({
    ca: veryWindy
      ? `Abric d'hivern imprescindible, bufanda, guants i gorra. Molt ventós: afegeix para-vent.`
      : `Abric d'hivern imprescindible, bufanda, guants i gorra. Fred intens: tapa\'t ben bé.`,
    es: veryWindy
      ? `Abrigo de invierno imprescindible, bufanda, guantes y gorro. Mucho viento: añade cortavientos.`
      : `Abrigo de invierno imprescindible, bufanda, guantes y gorro. Frío intenso, abrígate bien.`,
    en: veryWindy
      ? `Essential heavy winter coat, scarf, gloves and hat. Very windy: add a windproof layer.`
      : `Essential heavy winter coat, scarf, gloves and hat. Intense cold, make sure to layer up.`,
    fr: veryWindy
      ? `Manteau d'hiver indispensable, écharpe, gants et bonnet. Grand vent : ajoutez un coupe-vent.`
      : `Manteau d'hiver indispensable, écharpe, gants et bonnet. Grand froid, couvrez-vous bien.`,
  }, lang)

  if (avg < 12) {
    if (heavyRain) return pick({
      ca: `Jaqueta d'hivern, jersei gruixut, botes impermeables i paraigua. Pluja intensa prevista.`,
      es: `Chaqueta de invierno, jersey grueso, botas impermeables y paraguas. Lluvia intensa prevista.`,
      en: `Winter jacket, thick jumper, waterproof boots and umbrella. Heavy rain expected.`,
      fr: `Veste d'hiver, pull épais, bottes imperméables et parapluie. Pluies intenses prévues.`,
    }, lang)
    if (hasRain) return pick({
      ca: `Jaqueta tèrmica, jersei i paraigua. Temps fred i plujós, pren precaucions al sortir.`,
      es: `Chaqueta térmica, jersey y paraguas. Tiempo frío y lluvioso, toma precauciones al salir.`,
      en: `Thermal jacket, jumper and umbrella. Cold and rainy, take precautions when going out.`,
      fr: `Veste thermique, pull et parapluie. Temps froid et pluvieux, prenez vos précautions.`,
    }, lang)
    return pick({
      ca: windy
        ? `Jaqueta d'hivern o abric de mig temps, jersei i para-vent. Vent moderat.`
        : `Jaqueta d'hivern o abric de mig temps, jersei. Temps fresc i sec.`,
      es: windy
        ? `Chaqueta de invierno o abrigo de entretiempo, jersey y cortavientos. Viento moderado.`
        : `Chaqueta de invierno o abrigo de entretiempo, jersey. Tiempo fresco y seco.`,
      en: windy
        ? `Winter jacket or mid-season coat with a jumper and windproof layer. Moderate wind.`
        : `Winter jacket or mid-season coat with a jumper. Cool and dry conditions.`,
      fr: windy
        ? `Veste d'hiver ou manteau mi-saison avec pull et coupe-vent. Vent modéré.`
        : `Veste d'hiver ou manteau mi-saison avec pull. Temps frais et sec.`,
    }, lang)
  }

  if (avg < 18) {
    if (hasRain) return pick({
      ca: `Jaqueta lleugera impermeable o paraigua. Temps fresc amb pluja, roba còmoda de mig temps.`,
      es: `Chaqueta ligera impermeable o paraguas. Tiempo fresco con lluvia, ropa cómoda de entretiempo.`,
      en: `Light waterproof jacket or umbrella. Cool and wet, comfortable mid-season clothing.`,
      fr: `Veste légère imperméable ou parapluie. Frais et pluvieux, vêtements mi-saison confortables.`,
    }, lang)
    return pick({
      ca: `Jaqueta lleugera o jerseis. Temps fresc però agradable, ideal per a capes fines.`,
      es: `Chaqueta ligera o jerseis. Tiempo fresco pero agradable, ideal para capas finas.`,
      en: `Light jacket or jumper. Cool but pleasant, great for light layering.`,
      fr: `Veste légère ou pull. Temps frais mais agréable, idéal pour les couches légères.`,
    }, lang)
  }

  if (avg < 26) {
    if (hasRain) return pick({
      ca: `Roba còmoda, paraigua i una jaqueta lleugera per a les hores de pluja o vent.`,
      es: `Ropa cómoda, paraguas y una chaqueta ligera para las horas de lluvia o viento.`,
      en: `Comfortable clothes, umbrella and a light jacket for rainy or windy periods.`,
      fr: `Vêtements confortables, parapluie et veste légère pour les périodes pluvieuses.`,
    }, lang)
    return pick({
      ca: `Roba còmoda i lleugera. Porta una capa extra per al vespre o si bufa el vent.`,
      es: `Ropa cómoda y ligera. Lleva una capa extra para la tarde o si hay viento.`,
      en: `Comfortable, light clothing. Bring an extra layer for the evening or if it's windy.`,
      fr: `Vêtements légers et confortables. Prévoir une couche pour le soir ou en cas de vent.`,
    }, lang)
  }

  // Hot (≥26°C avg)
  if (hasRain) return pick({
    ca: `Roba lleugera d'estiu, protecció solar i paraigua per als possibles ruixats.`,
    es: `Ropa ligera de verano, protección solar y paraguas por los posibles chubascos.`,
    en: `Light summer clothes, sun protection and umbrella for possible showers.`,
    fr: `Vêtements légers d'été, protection solaire et parapluie pour les averses.`,
  }, lang)

  return pick({
    ca: `Roba lleugera d'estiu, gorra i protecció solar. Mantén-te hidratat, fa molta calor.`,
    es: `Ropa ligera de verano, gorra y protección solar. Mantente hidratado, hace mucho calor.`,
    en: `Light summer clothes, hat and sun protection. Stay hydrated — it's very hot out there.`,
    fr: `Vêtements légers d'été, chapeau et protection solaire. Restez hydraté, il fait très chaud.`,
  }, lang)
}

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
  if (stats.hasStorm || stats.totalPrecip > 15)       condIcon = '⛈️'
  else if (stats.maxTemp < 3 && stats.totalPrecip > 0.5) condIcon = '❄️'
  else if (stats.totalPrecip > 8)                     condIcon = '🌧️'
  else if (stats.totalPrecip > 1)                     condIcon = '🌦️'
  else if (stats.avgTemp > 28)                        condIcon = '☀️'
  else if (stats.avgTemp > 20)                        condIcon = '🌤️'

  // Clothes icon
  let clothesIcon = '🧥'
  if (stats.avgTemp > 25 && stats.totalPrecip < 1)    clothesIcon = '👕'
  else if (stats.totalPrecip > 1)                     clothesIcon = '☂️'
  else if (stats.avgTemp > 15)                        clothesIcon = '🧣'

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

  el.innerHTML = `
    <div class="prediction-card">
      <div class="prediction-row">
        <div class="prediction-item">
          <div class="prediction-item-header">
            <span class="prediction-icon" aria-hidden="true">${condIcon}</span>
            <span class="prediction-label">${TITLE_LABEL[lang] ?? TITLE_LABEL.en}</span>
          </div>
          <p class="prediction-text">${prediction}</p>
        </div>
        <div class="prediction-divider" aria-hidden="true"></div>
        <div class="prediction-item">
          <div class="prediction-item-header">
            <span class="prediction-icon" aria-hidden="true">${clothesIcon}</span>
            <span class="prediction-label">${CLOTHES_LABEL[lang] ?? CLOTHES_LABEL.en}</span>
          </div>
          <p class="prediction-text">${clothesAdvice}</p>
        </div>
      </div>
    </div>
  `
}
