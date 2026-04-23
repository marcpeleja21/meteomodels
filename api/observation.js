/**
 * MeteoModels — Real-Time Station Observation API
 * ─────────────────────────────────────────────────
 * GET /api/observation?lat=LAT&lon=LON[&key=API_KEY]
 *
 * Returns the current observation from the nearest active Weather Underground
 * PWS (personal weather station) for the given coordinates.
 *
 * Primary use case: ground-truth rain detection for location-based billing.
 * Check `station_rain` (true when precipRate > 0 and obs is < 15 min old).
 *
 * Authentication (optional)
 *   Set the ENSEMBLE_API_KEYS env var in Vercel to a comma-separated list
 *   of valid keys. When absent the endpoint is public.
 *   Pass via: ?key=, x-api-key header, or Authorization: Bearer
 *
 * Rate limits (Weather Underground free tier)
 *   ~25,000 calls/day  (50,000 WU requests ÷ 2 per call)
 *   ~50 calls/min      (100 WU requests/min ÷ 2 per call)
 *
 * Caching
 *   Vercel Edge Cache: 5 min (s-maxage=300) — matches PWS update frequency.
 */

export const config = { runtime: 'edge' }

const WU_KEY = '3b28991981854cdba8991981851cdbb8'

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

// ── Haversine great-circle distance (km) ─────────────────────────────────────

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

// ── Fetch nearest active PWS observation ─────────────────────────────────────

async function fetchPwsObs(lat, lon) {
  // Step 1 — find candidate stations near the coordinates
  const nearUrl =
    `https://api.weather.com/v3/location/near` +
    `?geocode=${lat},${lon}&product=pws&format=json&apiKey=${WU_KEY}`
  const nearRes = await fetch(nearUrl)
  if (!nearRes.ok) throw new Error(`WU near ${nearRes.status}`)
  const nearData = await nearRes.json()

  const ids         = nearData?.location?.stationId  ?? []
  const qcStatus    = nearData?.location?.qcStatus   ?? []
  const distances   = nearData?.location?.distanceKm ?? []
  const stationLats = nearData?.location?.latitude   ?? []
  const stationLons = nearData?.location?.longitude  ?? []

  // Build haversine-sorted candidate list, QC-passed first
  const candidates = []
  for (let i = 0; i < ids.length; i++) {
    if (qcStatus[i] !== 1) continue
    const sLat = stationLats[i], sLon = stationLons[i]
    const dist = (sLat != null && sLon != null)
      ? haversineKm(lat, lon, sLat, sLon)
      : (distances[i] ?? Infinity)
    candidates.push({ id: ids[i], dist })
  }
  // Fallback: accept any station if none pass QC
  if (!candidates.length) {
    for (let i = 0; i < ids.length; i++) {
      const sLat = stationLats[i], sLon = stationLons[i]
      const dist = (sLat != null && sLon != null)
        ? haversineKm(lat, lon, sLat, sLon)
        : (distances[i] ?? Infinity)
      candidates.push({ id: ids[i], dist })
    }
  }
  if (!candidates.length) throw new Error('No nearby PWS found')

  candidates.sort((a, b) => a.dist - b.dist)

  // Step 2 — try each station in order, skip offline ones (204 / empty body)
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

      const obsTimeUtc = obs.obsTimeUtc ?? null
      const obsAgeMin  = obsTimeUtc
        ? (Date.now() - new Date(obsTimeUtc).getTime()) / 60_000
        : Infinity
      const precipRate = obs.metric?.precipRate ?? null

      return {
        station_id:          obs.stationID ?? candidate.id,
        station_name:        obs.neighborhood ?? obs.stationID ?? candidate.id,
        station_lat:         obs.lat ?? null,
        station_lon:         obs.lon ?? null,
        station_dist_km:     Math.round(candidate.dist * 10) / 10,
        obs_time_utc:        obsTimeUtc,
        obs_age_min:         obsAgeMin !== Infinity ? Math.round(obsAgeMin * 10) / 10 : null,
        // Temperature
        temp_c:              obs.metric?.temp      ?? null,
        feels_like_c:        obs.metric?.heatIndex ?? obs.metric?.windChill ?? null,
        dewpoint_c:          obs.metric?.dewpt     ?? null,
        // Humidity & pressure
        humidity_pct:        obs.humidity          ?? null,
        pressure_hpa:        obs.metric?.pressure  ?? null,
        // Wind
        wind_speed_kmh:      obs.metric?.windSpeed ?? null,
        wind_gust_kmh:       obs.metric?.windGust  ?? null,
        wind_dir_deg:        obs.winddir           ?? null,
        // Precipitation
        precip_rate_mmhr:    precipRate,
        precip_total_mm:     obs.metric?.precipTotal ?? null,
        // Solar
        uv:                  obs.uv             ?? null,
        solar_radiation_wm2: obs.solarRadiation ?? null,
        // Derived: raining NOW = fresh obs (<15 min) with precipRate > 0
        station_rain:        obsAgeMin < 15 && precipRate != null && precipRate > 0,
      }
    } catch {
      continue
    }
  }
  throw new Error('No active PWS found nearby')
}

// ── Handler ───────────────────────────────────────────────────────────────────

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
    return json({ error: 'Missing required parameters', required: ['lat', 'lon'], example: '/api/observation?lat=41.40&lon=2.20' }, 400)

  const lat = parseFloat(latStr)
  const lon = parseFloat(lonStr)

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
    return json({ error: 'lat must be −90…90, lon must be −180…180' }, 400)

  // ── Fetch & respond ───────────────────────────────────────────────────────
  try {
    const obs = await fetchPwsObs(lat, lon)
    return json({
      meta: {
        timestamp: new Date().toISOString(),
        location:  { lat, lon },
        source:    'Weather Underground PWS (wunderground.com)',
        docs:      'https://meteomodels.vercel.app/api/observation?lat=LAT&lon=LON',
      },
      /**
       * true  → station confirms rain right now (precipRate > 0, obs < 15 min old)
       * false → not raining, or no fresh station data available
       * Use this field for rain-billing decisions.
       */
      station_rain: obs.station_rain,
      observation:  obs,
    }, 200, { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' })
  } catch (e) {
    return json({
      meta: {
        timestamp: new Date().toISOString(),
        location:  { lat, lon },
      },
      station_rain: false,
      observation:  null,
      error:        String(e),
    }, 502, { 'Cache-Control': 'public, s-maxage=60' })
  }
}
