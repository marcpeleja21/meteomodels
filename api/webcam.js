/**
 * Vercel Edge Function — proxies Windy Webcams API v3
 * Avoids CORS restrictions when called from the browser.
 * Results are re-sorted by haversine distance from the user's exact coordinates.
 */
export const config = { runtime: 'edge' }

const WINDY_KEY = 'GC7hTRIRIMPMcO8qFe27DzAZIWJoOnH3'

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
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const userLat = parseFloat(lat)
  const userLon = parseFloat(lon)

  const windyUrl =
    `https://api.windy.com/webcams/api/v3/webcams` +
    `?nearby=${lat},${lon},50` +
    `&limit=10` +
    `&include=images,player,location`

  try {
    const res = await fetch(windyUrl, {
      headers: { 'x-windy-api-key': WINDY_KEY },
    })

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Windy API ${res.status}` }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const data = await res.json()

    // Re-sort webcams by true haversine distance from the user's exact coordinates.
    // Windy's default ranking considers factors beyond pure proximity; sorting by
    // haversine ensures the geographically closest webcam is always first.
    if (Array.isArray(data.webcams)) {
      data.webcams.sort((a, b) => {
        const aLat = a.location?.latitude
        const aLon = a.location?.longitude
        const bLat = b.location?.latitude
        const bLon = b.location?.longitude
        const dA = (aLat != null && aLon != null) ? haversineKm(userLat, userLon, aLat, aLon) : Infinity
        const dB = (bLat != null && bLon != null) ? haversineKm(userLat, userLon, bLat, bLon) : Infinity
        return dA - dB
      })
    }

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Proxy fetch failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
