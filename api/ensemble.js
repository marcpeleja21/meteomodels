/**
 * MeteoModels — Weighted Ensemble Weather API
 * ─────────────────────────────────────────────
 * GET /api/ensemble?lat=LAT&lon=LON[&key=API_KEY]
 *
 * Returns the location-aware weighted multi-model ensemble for the current
 * hour, including a ready-to-use surcharge signal for delivery / mobility
 * platforms (rain, snow, storm → surcharge_recommended: true).
 *
 * Authentication (optional)
 *   Set the ENSEMBLE_API_KEYS env var in Vercel to a comma-separated list
 *   of valid keys.  When the variable is absent the endpoint is public.
 *   Pass the key via:
 *     ?key=YOUR_KEY
 *     Authorization: Bearer YOUR_KEY
 *     x-api-key: YOUR_KEY
 *
 * Caching
 *   Vercel Edge Cache: 5 min (s-maxage=300), stale-while-revalidate 60 s.
 *   Each unique lat/lon is cached independently.
 *
 * Model coverage
 *   - Everywhere   : ECMWF IFS 25 km + GFS 25 km
 *   - AROME domain : + AROME HD 1.5 km + AROME 2.5 km  (35–56 °N / 12°W–17°E)
 *   - Central EU   : + ICON D2 2.2 km + GeoSphere 2.5 km
 *   - UK / Ireland : + UKMO 10 km
 *   - Nordic       : + HARMONIE DMI 2.5 km
 *   - Canada       : + GEM 15 km
 */

export const config = { runtime: 'edge' }

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'
const UA         = 'MeteoModels/1.0 (meteomodels.vercel.app)'

const HOURLY_VARS = [
  'temperature_2m', 'apparent_temperature',
  'precipitation_probability', 'precipitation',
  'weather_code', 'wind_speed_10m', 'wind_gusts_10m',
  'wind_direction_10m', 'relative_humidity_2m',
  'pressure_msl', 'cloud_cover',
].join(',')

// ── Geographic helpers ────────────────────────────────────────────────────────

const isFrance  = (la, lo) => la >= 35 && la <= 56 && lo >= -12 && lo <= 17
const isCentEU  = (la, lo) => la >= 43.5 && la <= 57.5 && lo >= -4 && lo <= 20
const isUK      = (la, lo) => la >= 49.5 && la <= 61.5 && lo >= -11 && lo <= 2
const isNordic  = (la, lo) => la >= 54 && la <= 72 && lo >= -25 && lo <= 32
const isCanada  = (la, lo) => la >= 42 && la <= 84 && lo >= -141 && lo <= -52
const isEurope  = (la, lo) => la >= 27 && la <= 72 && lo >= -25 && lo <= 45
const isUSA     = (la, lo) => la >= 15 && la <= 72 && lo >= -170 && lo <= -52 && !isCanada(la, lo)

// ── Select the most relevant models for a location ───────────────────────────

function selectModels(lat, lon) {
  const fr = isFrance(lat, lon)
  const ce = isCentEU(lat, lon)
  const uk = isUK(lat, lon)
  const no = isNordic(lat, lon)
  const ca = isCanada(lat, lon)

  const models = [
    { key: 'ecmwf', apiId: 'ecmwf_ifs025',   maxDays: 2 },
    { key: 'gfs',   apiId: 'gfs_seamless',    maxDays: 2 },
  ]

  if (fr) {
    models.push({ key: 'arome_hd', apiId: 'meteofrance_arome_france_hd', maxDays: 2 })
    models.push({ key: 'arome',    apiId: 'meteofrance_arome_france',    maxDays: 2 })
  }
  if (ce) {
    models.push({ key: 'icon_d2',   apiId: 'icon_d2',                  maxDays: 2 })
    models.push({ key: 'geosphere', apiId: 'geosphere_arome_austria',   maxDays: 2 })
  }
  if (uk) {
    models.push({ key: 'ukmo', apiId: 'ukmo_seamless', maxDays: 2 })
  }
  if (no && !ce) {
    models.push({ key: 'dmi_harmonie', apiId: 'dmi_harmonie_arome_europe', maxDays: 2 })
  }
  if (ca) {
    models.push({ key: 'gem', apiId: 'gem_seamless', maxDays: 2 })
  }

  return models
}

// ── Model weights (mirrors src/utils/modelWeights.ts) ────────────────────────

const BASE_SCORE = {
  ecmwf: 9.0, gfs: 7.2, icon: 7.0, icon_eu: 8.0, icon_d2: 8.5,
  arome_hd: 9.5, arome: 9.0, arpege: 7.5, geosphere: 8.2,
  knmi_harmonie: 8.0, dmi_harmonie: 7.8, ukmo: 8.2, gem: 6.5, meteoblue: 7.0,
}

function regionalBonus(key, lat, lon) {
  const eu = isEurope(lat, lon), ce = isCentEU(lat, lon), fr = isFrance(lat, lon)
  const uk = isUK(lat, lon),     no = isNordic(lat, lon), ca = isCanada(lat, lon)
  const us = isUSA(lat, lon)
  switch (key) {
    case 'arome_hd':      return fr ? 7.0 : 0
    case 'arome':         return fr ? 5.0 : 0
    case 'icon_d2':       return ce ? 3.0 : 0
    case 'geosphere':     return ce ? 2.5 : 0
    case 'dmi_harmonie':  return no ? 2.5 : (eu ? 1.0 : 0)
    case 'icon_eu':       return eu ? 2.0 : 0
    case 'ukmo':          return uk ? 3.0 : (eu ? 0.5 : 0.2)
    case 'gem':           return ca ? 3.5 : 0
    case 'ecmwf':         return eu ? 1.0 : 0.5
    case 'gfs':           return us ? 2.0 : (!eu ? 0.8 : 0)
    default:              return 0
  }
}

function resBonus(key) {
  const km = { arome_hd: 1.5, icon_d2: 2.2, arome: 2.5, geosphere: 2.5, dmi_harmonie: 2.5, icon_eu: 7.0, ukmo: 10, ecmwf: 25, gfs: 25, gem: 15 }[key] ?? 25
  return Math.max(0, Math.log(25 / km) / Math.log(25 / 1.5))
}

function computeWeights(keys, lat, lon) {
  const raw = {}, w = {}
  let total = 0
  for (const k of keys) { raw[k] = Math.max((BASE_SCORE[k] ?? 6) + regionalBonus(k, lat, lon) + resBonus(k), 0.1); total += raw[k] }
  for (const k of keys) w[k] = raw[k] / total
  return w
}

// ── Open-Meteo fetch ──────────────────────────────────────────────────────────

async function fetchModel(lat, lon, apiId, maxDays) {
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: HOURLY_VARS, timezone: 'auto',
    forecast_days: String(maxDays), models: apiId,
  })
  const r = await fetch(`${OPEN_METEO}?${params}`, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  if (j.error) throw new Error(j.reason ?? 'API error')
  return j
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentIdx(times) {
  const now = Date.now()
  let best = 0
  for (let i = 0; i < times.length; i++) {
    if (new Date(times[i]).getTime() <= now) best = i; else break
  }
  return best
}

function codeToCondition(code) {
  if (code == null) return 'unknown'
  if (code === 0)             return 'clear'
  if (code <= 3)              return 'partly_cloudy'
  if (code <= 49)             return 'fog_or_haze'
  if (code <= 69)             return 'rain'
  if (code <= 79)             return 'snow'
  if (code <= 82)             return 'rain'
  if (code <= 86)             return 'snow'
  if (code <= 99)             return 'storm'
  return 'unknown'
}

const BAD_WEATHER = new Set(['rain', 'snow', 'storm'])

// ── Build weighted ensemble ───────────────────────────────────────────────────

function buildEnsemble(results, weights, lat, lon) {
  const entries = Object.entries(results).filter(([, v]) => v !== null)
  if (!entries.length) return null

  function wavg(field) {
    let wSum = 0, vSum = 0
    for (const [key, data] of entries) {
      const i = currentIdx(data.hourly.time)
      const v = data.hourly[field]?.[i] ?? null
      if (v !== null) { const w = weights[key] ?? 0; wSum += w; vSum += w * v }
    }
    return wSum > 0 ? Math.round(vSum / wSum * 10) / 10 : null
  }

  // AROME HD → AROME → weighted modal (mirrors getEnsembleCurrent in data.ts)
  let code = null
  for (const prefKey of ['arome_hd', 'arome']) {
    const e = entries.find(([k]) => k === prefKey)
    if (e) { const v = e[1].hourly.weather_code?.[currentIdx(e[1].hourly.time)] ?? null; if (v !== null) { code = v; break } }
  }
  if (code === null) {
    const scores = {}
    for (const [key, data] of entries) {
      const v = data.hourly.weather_code?.[currentIdx(data.hourly.time)] ?? null
      if (v !== null) scores[v] = (scores[v] ?? 0) + (weights[key] ?? 0)
    }
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
    if (best) code = +best[0]
  }

  const condition      = codeToCondition(code)
  const precipProb     = wavg('precipitation_probability')
  const windSpeed      = wavg('wind_speed_10m')
  const windGusts      = wavg('wind_gusts_10m')
  const isBad          = BAD_WEATHER.has(condition)
  const highRainProb   = precipProb !== null && precipProb >= 50
  const surcharge      = isBad || highRainProb

  let surchargeReason  = null
  if (isBad)         surchargeReason = `Active ${condition} conditions`
  else if (highRainProb) surchargeReason = `${precipProb}% precipitation probability`

  return {
    current: {
      condition,
      weather_code:          code,
      temp_c:                wavg('temperature_2m'),
      feels_like_c:          wavg('apparent_temperature'),
      precip_probability_pct: precipProb,
      precip_mm:             wavg('precipitation'),
      wind_speed_kmh:        windSpeed,
      wind_gusts_kmh:        windGusts,
      wind_direction_deg:    wavg('wind_direction_10m'),
      humidity_pct:          wavg('relative_humidity_2m'),
      pressure_hpa:          wavg('pressure_msl'),
      cloud_cover_pct:       wavg('cloud_cover'),
    },
    surcharge: {
      recommended:  surcharge,
      reason:       surchargeReason,
      condition,
      severity:     code >= 95 ? 'extreme' : (isBad ? 'moderate' : (highRainProb ? 'low' : 'none')),
    },
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, x-api-key',
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  })
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

  // ── Auth ──────────────────────────────────────────────────────────────────
  const validKeys = (process.env.ENSEMBLE_API_KEYS ?? '').split(',').filter(Boolean)
  if (validKeys.length) {
    const { searchParams: sp } = new URL(request.url)
    const provided =
      sp.get('key') ??
      request.headers.get('x-api-key') ??
      (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')

    if (!provided || !validKeys.includes(provided)) {
      return json({
        error:  'Unauthorized',
        hint:   'Pass your API key via ?key=, x-api-key header, or Authorization: Bearer',
      }, 401)
    }
  }

  // ── Params ────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url)
  const latStr = searchParams.get('lat')
  const lonStr = searchParams.get('lon')

  if (!latStr || !lonStr) {
    return json({
      error:   'Missing required parameters',
      required: ['lat (latitude)', 'lon (longitude)'],
      example: '/api/ensemble?lat=41.38&lon=2.17',
    }, 400)
  }

  const lat = parseFloat(latStr)
  const lon = parseFloat(lonStr)

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return json({ error: 'lat must be −90…90, lon must be −180…180' }, 400)
  }

  // ── Fetch models ──────────────────────────────────────────────────────────
  try {
    const models  = selectModels(lat, lon)
    const results = {}

    await Promise.all(
      models.map(async ({ key, apiId, maxDays }) => {
        try   { results[key] = await fetchModel(lat, lon, apiId, maxDays) }
        catch { results[key] = null }
      })
    )

    const loadedKeys = Object.entries(results).filter(([, v]) => v !== null).map(([k]) => k)
    if (!loadedKeys.length) {
      return json({ error: 'All model fetches failed — upstream unavailable' }, 502)
    }

    const weights  = computeWeights(loadedKeys, lat, lon)
    const ensemble = buildEnsemble(results, weights, lat, lon)
    const primary  = [...loadedKeys].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))[0]

    return json({
      meta: {
        timestamp: new Date().toISOString(),
        location:  { lat, lon },
        powered_by: 'Open-Meteo (open-meteo.com)',
        docs:       'https://meteomodels.vercel.app/api/ensemble?lat=LAT&lon=LON',
      },
      ...ensemble,
      models: {
        loaded:  loadedKeys,
        primary,
        weights: Object.fromEntries(
          Object.entries(weights)
            .sort((a, b) => b[1] - a[1])
            .map(([k, w]) => [k, Math.round(w * 1000) / 1000])
        ),
      },
    }, 200, {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
    })

  } catch (e) {
    return json({ error: String(e) }, 500)
  }
}
