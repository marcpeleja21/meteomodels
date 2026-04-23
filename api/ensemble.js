/**
 * MeteoModels — Weighted Ensemble Weather API
 * ─────────────────────────────────────────────
 * GET /api/ensemble?lat=LAT&lon=LON[&key=API_KEY]
 *
 * Returns the location-aware weighted multi-model ensemble for the current
 * hour: a weighted average across the best models for that location, plus
 * the individual reading from each loaded model.
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
const WU_KEY     = '3b28991981854cdba8991981851cdbb8'
const UA         = 'MeteoModels/1.0 (meteomodels.vercel.app)'

const HOURLY_VARS = [
  'temperature_2m', 'apparent_temperature',
  'precipitation_probability', 'precipitation',
  'weather_code', 'wind_speed_10m', 'wind_gusts_10m',
  'wind_direction_10m', 'relative_humidity_2m',
  'pressure_msl', 'cloud_cover',
].join(',')

// ── Geographic helpers ────────────────────────────────────────────────────────

const isFrance = (la, lo) => la >= 35 && la <= 56 && lo >= -12 && lo <= 17
const isCentEU = (la, lo) => la >= 43.5 && la <= 57.5 && lo >= -4 && lo <= 20
const isUK     = (la, lo) => la >= 49.5 && la <= 61.5 && lo >= -11 && lo <= 2
const isNordic = (la, lo) => la >= 54 && la <= 72 && lo >= -25 && lo <= 32
const isCanada = (la, lo) => la >= 42 && la <= 84 && lo >= -141 && lo <= -52
const isEurope = (la, lo) => la >= 27 && la <= 72 && lo >= -25 && lo <= 45
const isUSA    = (la, lo) => la >= 15 && la <= 72 && lo >= -170 && lo <= -52 && !isCanada(la, lo)
// HRRR CONUS domain: ~3 km, runs hourly, best short-range accuracy in the contiguous US
const isHRRR   = (la, lo) => la >= 22 && la <= 52 && lo >= -134 && lo <= -61

// ── Haversine distance ────────────────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── PWS observation fetch (mirrors api/pws.js logic) ─────────────────────────

async function fetchPwsObs(lat, lon) {
  try {
    const nearUrl =
      `https://api.weather.com/v3/location/near` +
      `?geocode=${lat},${lon}&product=pws&format=json&apiKey=${WU_KEY}`
    const nearRes = await fetch(nearUrl)
    if (!nearRes.ok) return null
    const nearData = await nearRes.json()

    const ids         = nearData?.location?.stationId  ?? []
    const qcStatus    = nearData?.location?.qcStatus   ?? []
    const distances   = nearData?.location?.distanceKm ?? []
    const stationLats = nearData?.location?.latitude   ?? []
    const stationLons = nearData?.location?.longitude  ?? []

    const candidates = []
    for (let i = 0; i < ids.length; i++) {
      if (qcStatus[i] !== 1) continue
      const sLat = stationLats[i], sLon = stationLons[i]
      const dist = (sLat != null && sLon != null)
        ? haversineKm(lat, lon, sLat, sLon)
        : (distances[i] ?? Infinity)
      candidates.push({ id: ids[i], dist })
    }
    if (!candidates.length) {
      for (let i = 0; i < ids.length; i++) {
        const sLat = stationLats[i], sLon = stationLons[i]
        const dist = (sLat != null && sLon != null)
          ? haversineKm(lat, lon, sLat, sLon)
          : (distances[i] ?? Infinity)
        candidates.push({ id: ids[i], dist })
      }
    }
    if (!candidates.length) return null

    candidates.sort((a, b) => a.dist - b.dist)

    for (const candidate of candidates) {
      try {
        const obsUrl =
          `https://api.weather.com/v2/pws/observations/current` +
          `?stationId=${candidate.id}&format=json&units=m&apiKey=${WU_KEY}`
        const obsRes = await fetch(obsUrl)
        if (obsRes.status === 204) continue
        if (!obsRes.ok) continue
        const text = await obsRes.text()
        if (!text) continue
        const obsData = JSON.parse(text)
        const obs = obsData?.observations?.[0]
        if (!obs) continue

        const obsTimeUtc  = obs.obsTimeUtc ?? null
        const obsAgeMin   = obsTimeUtc
          ? (Date.now() - new Date(obsTimeUtc).getTime()) / 60_000
          : Infinity
        const precipRate  = obs.metric?.precipRate ?? null

        return {
          // Station metadata
          station_id:           obs.stationID ?? candidate.id,
          station_name:         obs.neighborhood ?? obs.stationID ?? candidate.id,
          station_lat:          obs.lat            ?? null,
          station_lon:          obs.lon            ?? null,
          station_dist_km:      candidate.dist !== null ? Math.round(candidate.dist * 10) / 10 : null,
          obs_time_utc:         obsTimeUtc,
          obs_age_min:          obsAgeMin !== Infinity ? Math.round(obsAgeMin * 10) / 10 : null,
          // Temperature
          temp_c:               obs.metric?.temp          ?? null,
          feels_like_c:         obs.metric?.heatIndex     ?? obs.metric?.windChill ?? null,
          dewpoint_c:           obs.metric?.dewpt         ?? null,
          // Humidity & pressure
          humidity_pct:         obs.humidity              ?? null,
          pressure_hpa:         obs.metric?.pressure      ?? null,
          // Wind
          wind_speed_kmh:       obs.metric?.windSpeed     ?? null,
          wind_gust_kmh:        obs.metric?.windGust      ?? null,
          wind_dir_deg:         obs.winddir               ?? null,
          // Precipitation  ← key fields for rain billing
          precip_rate_mmhr:     precipRate,
          precip_total_mm:      obs.metric?.precipTotal   ?? null,
          // Solar
          uv:                   obs.uv                    ?? null,
          solar_radiation_wm2:  obs.solarRadiation        ?? null,
          // Ground-truth flag: raining NOW if precipRate > 0 and obs is fresh (<15 min)
          station_rain:         obsAgeMin < 15 && precipRate != null && precipRate > 0,
        }
      } catch {
        continue
      }
    }
    return null
  } catch {
    return null
  }
}

// ── Select the most relevant models for a location ───────────────────────────

function selectModels(lat, lon) {
  const models = [
    { key: 'ecmwf', apiId: 'ecmwf_ifs025',  maxDays: 2 },
    { key: 'gfs',   apiId: 'gfs_seamless',   maxDays: 2 },
  ]
  if (isFrance(lat, lon)) {
    models.push({ key: 'arome_hd', apiId: 'meteofrance_arome_france_hd', maxDays: 2 })
    models.push({ key: 'arome',    apiId: 'meteofrance_arome_france',    maxDays: 2 })
  }
  if (isCentEU(lat, lon)) {
    models.push({ key: 'icon_d2',   apiId: 'icon_d2',                 maxDays: 2 })
    models.push({ key: 'geosphere', apiId: 'geosphere_arome_austria',  maxDays: 2 })
  }
  if (isUK(lat, lon))
    models.push({ key: 'ukmo', apiId: 'ukmo_seamless', maxDays: 2 })
  if (isNordic(lat, lon) && !isCentEU(lat, lon))
    models.push({ key: 'dmi_harmonie', apiId: 'dmi_harmonie_arome_europe', maxDays: 2 })
  if (isCanada(lat, lon))
    models.push({ key: 'gem', apiId: 'gem_seamless', maxDays: 2 })
  if (isHRRR(lat, lon))
    models.push({ key: 'hrrr', apiId: 'gfs_hrrr', maxDays: 2 })
  return models
}

// ── Model weights (mirrors src/utils/modelWeights.ts) ────────────────────────

const BASE_SCORE = {
  ecmwf: 9.0, gfs: 7.2, icon_d2: 8.5, arome_hd: 9.5, arome: 9.0,
  geosphere: 8.2, dmi_harmonie: 7.8, ukmo: 8.2, gem: 6.5,
  hrrr: 9.0,   // 3 km, runs every hour — premier short-range model for CONUS
}

function regionalBonus(key, lat, lon) {
  const eu = isEurope(lat, lon), ce = isCentEU(lat, lon), fr = isFrance(lat, lon)
  const uk = isUK(lat, lon), no = isNordic(lat, lon), ca = isCanada(lat, lon)
  const us = isUSA(lat, lon)
  switch (key) {
    case 'hrrr':         return isHRRR(lat, lon) ? 7.0 : 0   // dominant in CONUS
    case 'arome_hd':     return fr ? 7.0 : 0
    case 'arome':        return fr ? 5.0 : 0
    case 'icon_d2':      return ce ? 3.0 : 0
    case 'geosphere':    return ce ? 2.5 : 0
    case 'dmi_harmonie': return no ? 2.5 : (eu ? 1.0 : 0)
    case 'ukmo':         return uk ? 3.0 : (eu ? 0.5 : 0.2)
    case 'gem':          return ca ? 3.5 : 0
    case 'ecmwf':        return eu ? 1.0 : 0.5
    case 'gfs':          return us ? 2.0 : (!eu ? 0.8 : 0)
    default:             return 0
  }
}

function resBonus(key) {
  const km = { arome_hd: 1.5, icon_d2: 2.2, arome: 2.5, geosphere: 2.5, dmi_harmonie: 2.5, hrrr: 3.0, ukmo: 10, ecmwf: 25, gfs: 25, gem: 15 }[key] ?? 25
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
  if (code === 0)  return 'clear'
  if (code <= 3)   return 'partly_cloudy'
  if (code <= 49)  return 'fog_or_haze'
  if (code <= 69)  return 'rain'
  if (code <= 79)  return 'snow'
  if (code <= 82)  return 'rain'
  if (code <= 86)  return 'snow'
  if (code <= 99)  return 'storm'
  return 'unknown'
}

// ── Build weighted ensemble ───────────────────────────────────────────────────

function buildEnsemble(results, weights) {
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

  // AROME HD → AROME → weighted modal
  let code = null
  for (const pref of ['arome_hd', 'arome']) {
    const e = entries.find(([k]) => k === pref)
    if (e) {
      const v = e[1].hourly.weather_code?.[currentIdx(e[1].hourly.time)] ?? null
      if (v !== null) { code = v; break }
    }
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

  // Per-model current readings
  const by_model = {}
  for (const [key, data] of entries) {
    const h = data.hourly
    const i = currentIdx(h.time)
    const c = h.weather_code?.[i] ?? null
    by_model[key] = {
      condition:              codeToCondition(c),
      weather_code:           c,
      temp_c:                 h.temperature_2m?.[i]            ?? null,
      feels_like_c:           h.apparent_temperature?.[i]      ?? null,
      precip_probability_pct: h.precipitation_probability?.[i] ?? null,
      precip_mm:              h.precipitation?.[i]             ?? null,
      wind_speed_kmh:         h.wind_speed_10m?.[i]            ?? null,
      wind_gusts_kmh:         h.wind_gusts_10m?.[i]            ?? null,
      wind_direction_deg:     h.wind_direction_10m?.[i]        ?? null,
      humidity_pct:           h.relative_humidity_2m?.[i]      ?? null,
      pressure_hpa:           h.pressure_msl?.[i]              ?? null,
      cloud_cover_pct:        h.cloud_cover?.[i]               ?? null,
    }
  }

  return {
    ensemble: {
      condition:              codeToCondition(code),
      weather_code:           code,
      temp_c:                 wavg('temperature_2m'),
      feels_like_c:           wavg('apparent_temperature'),
      precip_probability_pct: wavg('precipitation_probability'),
      precip_mm:              wavg('precipitation'),
      wind_speed_kmh:         wavg('wind_speed_10m'),
      wind_gusts_kmh:         wavg('wind_gusts_10m'),
      wind_direction_deg:     wavg('wind_direction_10m'),
      humidity_pct:           wavg('relative_humidity_2m'),
      pressure_hpa:           wavg('pressure_msl'),
      cloud_cover_pct:        wavg('cloud_cover'),
    },
    by_model,
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

  // ── Optional auth ─────────────────────────────────────────────────────────
  const validKeys = (process.env.ENSEMBLE_API_KEYS ?? '').split(',').filter(Boolean)
  if (validKeys.length) {
    const { searchParams: sp } = new URL(request.url)
    const provided =
      sp.get('key') ??
      request.headers.get('x-api-key') ??
      (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!provided || !validKeys.includes(provided))
      return json({ error: 'Unauthorized', hint: 'Pass your API key via ?key=, x-api-key header, or Authorization: Bearer' }, 401)
  }

  // ── Params ────────────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url)
  const latStr = searchParams.get('lat')
  const lonStr = searchParams.get('lon')

  if (!latStr || !lonStr)
    return json({ error: 'Missing required parameters', required: ['lat', 'lon'], example: '/api/ensemble?lat=41.38&lon=2.17' }, 400)

  const lat = parseFloat(latStr)
  const lon = parseFloat(lonStr)

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
    return json({ error: 'lat must be −90…90, lon must be −180…180' }, 400)

  // ── Fetch & assemble ──────────────────────────────────────────────────────
  try {
    const models  = selectModels(lat, lon)
    const results = {}

    // Fetch all models + PWS observation in parallel
    const [, pwsObs] = await Promise.all([
      Promise.all(
        models.map(async ({ key, apiId, maxDays }) => {
          try   { results[key] = await fetchModel(lat, lon, apiId, maxDays) }
          catch { results[key] = null }
        })
      ),
      fetchPwsObs(lat, lon),
    ])

    const loadedKeys = Object.entries(results).filter(([, v]) => v !== null).map(([k]) => k)
    if (!loadedKeys.length)
      return json({ error: 'All model fetches failed — upstream unavailable' }, 502)

    const weights = computeWeights(loadedKeys, lat, lon)
    const data    = buildEnsemble(results, weights)
    const primary = [...loadedKeys].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))[0]

    // Rain signals
    const ensCondition = data?.ensemble?.condition ?? 'unknown'
    const modelRain    = ensCondition === 'rain' || ensCondition === 'storm'
    const stationRain  = pwsObs?.station_rain ?? false

    return json({
      meta: {
        timestamp:  new Date().toISOString(),
        location:   { lat, lon },
        powered_by: 'Open-Meteo (open-meteo.com)',
        docs:       'https://meteomodels.vercel.app/api/ensemble?lat=LAT&lon=LON',
      },
      ...data,
      /**
       * Precipitation signals — two independent sources:
       *   model_rain   → weighted ensemble WMO code says it's raining/storming
       *   station_rain → nearest PWS reports precipRate > 0, obs < 15 min old
       *
       * For rain-billing use cases, prefer station_rain (ground truth).
       * Fall back to model_rain when no station data is available.
       */
      precipitation: {
        model_rain:   modelRain,
        station_rain: stationRain,
        /** Convenience: at least one source confirms rain */
        raining:      modelRain || stationRain,
      },
      /**
       * Real-time observation from the nearest Weather Underground PWS.
       * null when no active station is found within range.
       * obs_age_min < 15 guarantees the data is fresh enough for ground-truth decisions.
       */
      observation: pwsObs ? {
        station_id:          pwsObs.station_id,
        station_name:        pwsObs.station_name,
        station_lat:         pwsObs.station_lat,
        station_lon:         pwsObs.station_lon,
        station_dist_km:     pwsObs.station_dist_km,
        obs_time_utc:        pwsObs.obs_time_utc,
        obs_age_min:         pwsObs.obs_age_min,
        temp_c:              pwsObs.temp_c,
        feels_like_c:        pwsObs.feels_like_c,
        dewpoint_c:          pwsObs.dewpoint_c,
        humidity_pct:        pwsObs.humidity_pct,
        pressure_hpa:        pwsObs.pressure_hpa,
        wind_speed_kmh:      pwsObs.wind_speed_kmh,
        wind_gust_kmh:       pwsObs.wind_gust_kmh,
        wind_dir_deg:        pwsObs.wind_dir_deg,
        precip_rate_mmhr:    pwsObs.precip_rate_mmhr,
        precip_total_mm:     pwsObs.precip_total_mm,
        uv:                  pwsObs.uv,
        solar_radiation_wm2: pwsObs.solar_radiation_wm2,
      } : null,
      models: {
        loaded:  loadedKeys,
        primary,
        weights: Object.fromEntries(
          Object.entries(weights)
            .sort((a, b) => b[1] - a[1])
            .map(([k, w]) => [k, Math.round(w * 1000) / 1000])
        ),
      },
    }, 200, { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' })

  } catch (e) {
    return json({ error: String(e) }, 500)
  }
}
