/**
 * Vercel Edge Function — Weather Underground PWS proxy
 * 1. Finds nearest active PWS station for a given lat/lon
 * 2. Fetches its current observations
 * Keeps the API key server-side so it's never exposed to the browser.
 */
export const config = { runtime: 'edge' }

const WU_KEY = '3b28991981854cdba8991981851cdbb8'

/** Haversine great-circle distance in km */
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

export default async function handler(request) {
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lon = searchParams.get('lon')

  if (!lat || !lon) {
    return new Response(JSON.stringify({ error: 'Missing lat/lon' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const userLat = parseFloat(lat)
  const userLon = parseFloat(lon)

  try {
    // Step 1 — find nearest PWS stations
    const nearUrl =
      `https://api.weather.com/v3/location/near` +
      `?geocode=${lat},${lon}&product=pws&format=json&apiKey=${WU_KEY}`

    const nearRes = await fetch(nearUrl)
    if (!nearRes.ok) throw new Error(`WU near ${nearRes.status}`)
    const nearData = await nearRes.json()

    const ids        = nearData?.location?.stationId   ?? []
    const qcStatus   = nearData?.location?.qcStatus    ?? []
    const distances  = nearData?.location?.distanceKm  ?? []
    const stationLats = nearData?.location?.latitude   ?? []
    const stationLons = nearData?.location?.longitude  ?? []

    // Build a candidate list of QC-passed stations with haversine distance
    // Fall back to WU's distanceKm if per-station lat/lon is unavailable
    const candidates = []
    for (let i = 0; i < ids.length; i++) {
      if (qcStatus[i] !== 1) continue
      const sLat = stationLats[i]
      const sLon = stationLons[i]
      const dist = (sLat != null && sLon != null)
        ? haversineKm(userLat, userLon, sLat, sLon)
        : (distances[i] ?? Infinity)
      candidates.push({ id: ids[i], dist })
    }
    // Fall back: if no QC-passed station, accept any
    if (!candidates.length) {
      for (let i = 0; i < ids.length; i++) {
        const sLat = stationLats[i]
        const sLon = stationLons[i]
        const dist = (sLat != null && sLon != null)
          ? haversineKm(userLat, userLon, sLat, sLon)
          : (distances[i] ?? Infinity)
        candidates.push({ id: ids[i], dist })
      }
    }
    if (!candidates.length) throw new Error('No nearby PWS found')

    // Pick the nearest station by haversine distance
    candidates.sort((a, b) => a.dist - b.dist)
    const stationId   = candidates[0].id
    const stationDist = candidates[0].dist

    // Step 2 — fetch current observations
    const obsUrl =
      `https://api.weather.com/v2/pws/observations/current` +
      `?stationId=${stationId}&format=json&units=m&apiKey=${WU_KEY}`

    const obsRes = await fetch(obsUrl)
    if (!obsRes.ok) throw new Error(`WU obs ${obsRes.status}`)
    const obsData = await obsRes.json()

    const obs = obsData?.observations?.[0]
    if (!obs) throw new Error('No observation returned')

    // Normalise into a flat shape the frontend can consume directly
    const result = {
      stationId:      obs.stationID,
      stationName:    obs.neighborhood ?? obs.stationID,
      stationDist:    stationDist !== null ? Math.round(stationDist) : null,
      stationLat:     obs.lat,
      stationLon:     obs.lon,
      obsTimeUtc:     obs.obsTimeUtc,
      temp:           obs.metric.temp          ?? null,
      feelsLike:      obs.metric.heatIndex     ?? obs.metric.windChill ?? null,
      dewpt:          obs.metric.dewpt         ?? null,
      humidity:       obs.humidity             ?? null,
      windspeed:      obs.metric.windSpeed     ?? null,
      windGust:       obs.metric.windGust      ?? null,
      windDir:        obs.winddir              ?? null,
      pressure:       obs.metric.pressure      ?? null,
      precipRate:     obs.metric.precipRate    ?? null,
      precipTotal:    obs.metric.precipTotal   ?? null,
      uv:             obs.uv                   ?? null,
      solarRadiation: obs.solarRadiation       ?? null,
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
}
