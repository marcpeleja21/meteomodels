/**
 * MeteoModels — Real-Time Station Observation API
 * ─────────────────────────────────────────────────
 * GET /api/observation?lat=LAT&lon=LON[&key=API_KEY]
 *
 * Returns the current observation from the nearest active Weather Underground
 * PWS (personal weather station), plus a multi-station rain consensus from all
 * active stations within 2 km.
 *
 * Rain detection fields:
 *   station_rain     → true if ANY station within 2 km confirms rain
 *                      (precipRate > 0, obs < 15 min old)
 *   rain_confidence  → fraction of nearby stations that confirm rain (0.0–1.0)
 *                      use this for a stricter threshold if needed
 *   stations_checked → active stations found within 2 km
 *   stations_raining → how many of those report precipRate > 0
 *
 * Authentication (optional)
 *   Set the ENSEMBLE_API_KEYS env var in Vercel to a comma-separated list
 *   of valid keys. When absent the endpoint is public.
 *   Pass via: ?key=, x-api-key header, or Authorization: Bearer
 *
 * Rate limits (Weather Underground free tier)
 *   1 near lookup + up to 5 obs fetches = up to 6 WU calls per request
 *   ~8,300 calls/day  (50,000 WU requests ÷ 6)
 *   ~16 calls/min     (100 WU requests/min ÷ 6)
 *
 * Caching
 *   Vercel Edge Cache: 5 min (s-maxage=300) — matches PWS update frequency.
 */

export const config = { runtime: 'edge' }

const WU_KEY      = '3b28991981854cdba8991981851cdbb8'
const RADIUS_KM   = 2.0   // consider stations within this radius for rain consensus
const MAX_FETCH   = 5     // max concurrent WU obs calls per request

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

// ── Fetch a single station's current observation ──────────────────────────────

async function fetchStationObs(stationId, distKm) {
  try {
    const obsUrl =
      `https://api.weather.com/v2/pws/observations/current` +
      `?stationId=${stationId}&format=json&units=m&apiKey=${WU_KEY}`
    const obsRes = await fetch(obsUrl)
    if (obsRes.status === 204) return null   // station registered but offline
    if (!obsRes.ok) return null
    const text = await obsRes.text()
    if (!text) return null
    const obsData = JSON.parse(text)
    const obs = obsData?.observations?.[0]
    if (!obs) return null

    const obsTimeUtc = obs.obsTimeUtc ?? null
    const obsAgeMin  = obsTimeUtc
      ? (Date.now() - new Date(obsTimeUtc).getTime()) / 60_000
      : Infinity

    // Reject stations with no usable readings — sensor online but reporting nothing.
    // At least one of these must be non-null for the station to be considered active.
    const hasData =
      obs.metric?.temp      != null ||
      obs.humidity          != null ||
      obs.metric?.windSpeed != null
    if (!hasData) return null

    // Reject observations older than 60 minutes — station is stale/frozen.
    if (obsAgeMin > 60) return null

    const precipRate = obs.metric?.precipRate ?? null
    const fresh      = obsAgeMin < 15

    return {
      // Station metadata
      station_id:          obs.stationID ?? stationId,
      station_name:        obs.neighborhood ?? obs.stationID ?? stationId,
      station_lat:         obs.lat ?? null,
      station_lon:         obs.lon ?? null,
      station_dist_km:     Math.round(distKm * 10) / 10,
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
      // Rain flag for this station
      confirms_rain:       fresh && precipRate != null && precipRate > 0,
    }
  } catch {
    return null
  }
}

// ── Find and fetch all active stations within RADIUS_KM ───────────────────────

async function fetchAreaObs(lat, lon) {
  // Step 1 — get nearby station list from WU
  const nearUrl =
    `https://api.weather.com/v3/location/near` +
    `?geocode=${lat},${lon}&product=pws&format=json&apiKey=${WU_KEY}`
  const nearRes = await fetch(nearUrl)
  if (!nearRes.ok) throw new Error(`WU near ${nearRes.status}`)
  const nearData = await nearRes.json()

  const ids         = nearData?.location?.stationId  ?? []
  const distances   = nearData?.location?.distanceKm ?? []
  const stationLats = nearData?.location?.latitude   ?? []
  const stationLons = nearData?.location?.longitude  ?? []

  if (!ids.length) throw new Error('No nearby PWS found')

  // Step 2 — compute haversine distance for each station, sort nearest-first
  const all = ids.map((id, i) => {
    const sLat = stationLats[i], sLon = stationLons[i]
    const dist = (sLat != null && sLon != null)
      ? haversineKm(lat, lon, sLat, sLon)
      : (distances[i] ?? Infinity)
    return { id, dist }
  }).sort((a, b) => a.dist - b.dist)

  // Step 3 — partition into within-radius and beyond-radius
  const withinRadius = all.filter(s => s.dist <= RADIUS_KM).slice(0, MAX_FETCH)
  const beyond       = all.filter(s => s.dist >  RADIUS_KM)

  // Step 4 — fetch all within-radius stations concurrently
  const withinResults = await Promise.all(
    withinRadius.map(s => fetchStationObs(s.id, s.dist))
  )
  const activeWithin = withinResults.filter(Boolean)

  // Step 5 — if no active station found within radius, fall back to nearest overall
  let primaryObs = activeWithin[0] ?? null
  if (!primaryObs) {
    for (const s of beyond) {
      const obs = await fetchStationObs(s.id, s.dist)
      if (obs) { primaryObs = obs; break }
    }
  }

  return { primaryObs, activeWithin }
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
    const { primaryObs, activeWithin } = await fetchAreaObs(lat, lon)

    if (!primaryObs)
      return json({
        meta: { timestamp: new Date().toISOString(), location: { lat, lon } },
        station_rain:     false,
        rain_confidence:  0,
        stations_checked: 0,
        stations_raining: 0,
        observation:      null,
        nearby_stations:  [],
        error:            'No active PWS found nearby',
      }, 502, { 'Cache-Control': 'public, s-maxage=60' })

    // ── Rain consensus across all active stations within 2 km ──────────────
    const checked  = activeWithin.length
    const raining  = activeWithin.filter(s => s.confirms_rain).length
    const anyRain  = raining > 0
    const confidence = checked > 0 ? Math.round((raining / checked) * 100) / 100 : 0

    // Compact summary for nearby_stations (just rain-relevant fields)
    const nearbySummary = activeWithin.map(s => ({
      station_id:       s.station_id,
      station_name:     s.station_name,
      dist_km:          s.station_dist_km,
      obs_age_min:      s.obs_age_min,
      temp_c:           s.temp_c,
      precip_rate_mmhr: s.precip_rate_mmhr,
      confirms_rain:    s.confirms_rain,
    }))

    return json({
      meta: {
        timestamp:       new Date().toISOString(),
        location:        { lat, lon },
        source:          'Weather Underground PWS (wunderground.com)',
        radius_km:       RADIUS_KM,
        docs:            'https://meteomodels.vercel.app/api/observation?lat=LAT&lon=LON',
      },
      /**
       * station_rain    → true if ANY station within 2 km confirms rain.
       * rain_confidence → fraction of nearby stations confirming rain (0.0–1.0).
       *                   Useful for stricter thresholds:
       *                     ≥ 0.5  → majority of nearby stations confirm rain
       *                     = 1.0  → all nearby stations confirm rain
       */
      station_rain:     anyRain,
      rain_confidence:  confidence,
      stations_checked: checked,
      stations_raining: raining,
      /** Full observation from the nearest active station */
      observation:      primaryObs,
      /** Compact rain snapshot for every active station within 2 km */
      nearby_stations:  nearbySummary,
    }, 200, { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' })

  } catch (e) {
    return json({
      meta:             { timestamp: new Date().toISOString(), location: { lat, lon } },
      station_rain:     false,
      rain_confidence:  0,
      stations_checked: 0,
      stations_raining: 0,
      observation:      null,
      nearby_stations:  [],
      error:            String(e),
    }, 502, { 'Cache-Control': 'public, s-maxage=60' })
  }
}
