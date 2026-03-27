/**
 * Vercel Edge Function — Weather Underground PWS proxy
 * 1. Finds nearest active PWS station for a given lat/lon
 * 2. Fetches its current observations
 * Keeps the API key server-side so it's never exposed to the browser.
 */
export const config = { runtime: 'edge' }

const WU_KEY = '3b28991981854cdba8991981851cdbb8'

export default async function handler(request) {
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lon = searchParams.get('lon')

  if (!lat || !lon) {
    return new Response(JSON.stringify({ error: 'Missing lat/lon' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // Step 1 — find nearest PWS stations
    const nearUrl =
      `https://api.weather.com/v3/location/near` +
      `?geocode=${lat},${lon}&product=pws&format=json&apiKey=${WU_KEY}`

    const nearRes = await fetch(nearUrl)
    if (!nearRes.ok) throw new Error(`WU near ${nearRes.status}`)
    const nearData = await nearRes.json()

    const ids       = nearData?.location?.stationId   ?? []
    const qcStatus  = nearData?.location?.qcStatus    ?? []
    const distances = nearData?.location?.distanceKm  ?? []

    // Pick the first QC-passed station (qcStatus === 1)
    let stationId   = null
    let stationDist = null
    for (let i = 0; i < ids.length; i++) {
      if (qcStatus[i] === 1) {
        stationId   = ids[i]
        stationDist = distances[i] ?? null
        break
      }
    }
    // Fall back to first result if none pass QC
    if (!stationId && ids.length) {
      stationId   = ids[0]
      stationDist = distances[0] ?? null
    }
    if (!stationId) throw new Error('No nearby PWS found')

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
