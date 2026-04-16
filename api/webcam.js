/**
 * Vercel Edge Function — proxies Windy Webcams API v3
 * Also queries the 3cat.cat CCMA "beauties" API for Catalonia weather cameras.
 * Both sources are merged and re-sorted by haversine distance so the nearest
 * camera — regardless of source — is always returned first.
 */
export const config = { runtime: 'edge' }

const WINDY_KEY = 'GC7hTRIRIMPMcO8qFe27DzAZIWJoOnH3'
const CCMA_URL  = 'https://api.ccma.cat/beauties?_format=json&llista=totes&cache=180&version=2.0'
const CCMA_IMG  = 'https://statics.3cat.cat'

/**
 * Known coordinates for each 3cat CCMA weather camera (id → [lat, lon]).
 * Coverage is limited to Catalonia + Perpignan.
 */
const CCMA_COORDS = {
   1: [41.3870,  2.1957],   // Barcelona, Port Olímpic
   2: [41.4179,  2.1354],   // Barcelona, Collserola
   3: [41.3622,  2.0510],   // Sant Joan Despí, TV3
   4: [42.6975,  2.8956],   // Perpinyà
   5: [41.9304,  2.2537],   // Vic
   6: [42.0039,  1.8703],   // Santuari de Queralt
   7: [41.5953,  1.8374],   // Montserrat
   9: [42.0564,  3.1944],   // L'Estartit
  10: [41.2258,  1.7245],   // Vilanova i la Geltrú
  11: [41.9833,  2.8167],   // Girona
  12: [42.3667,  2.1500],   // Vall de Núria
  13: [42.3394,  1.9433],   // La Molina
  14: [42.3167,  1.8333],   // Masella
  16: [42.4967,  0.8894],   // Boí-Taüll
  17: [42.7000,  0.7944],   // Vielha
  18: [42.6967,  1.0117],   // Baqueira-Beret
  19: [41.6148,  0.6270],   // Lleida
  20: [41.1190,  1.2445],   // Tarragona
  21: [40.8122,  0.5213],   // Tortosa
  22: [40.7138,  0.5826],   // Amposta
  26: [41.7281,  1.8199],   // Manresa
  27: [42.2662,  3.1755],   // Roses
  32: [40.8860,  0.8049],   // L'Ametlla de Mar
  36: [41.1986,  1.5133],   // Calafell
  37: [41.7954,  0.8098],   // Balaguer
  39: [41.0680,  1.0539],   // Cambrils
  40: [42.5614,  1.0897],   // Espot Esquí
  43: [42.0833,  1.5667],   // Port del Comte
  44: [42.1991,  2.1916],   // Ripoll
  45: [41.3412,  2.0426],   // Sant Boi de Llobregat
  52: [42.5200,  0.9700],   // Capdella - la Vall Fosca
  53: [41.3825,  2.1656],   // Barcelona, Arts Santa Mònica
  55: [42.5333,  1.3333],   // Port Ainé
  56: [41.8167,  3.0667],   // Platja d'Aro
  57: [42.4167,  2.3833],   // Vallter
  59: [41.5630,  2.0090],   // Terrassa, MNACTEC
  60: [41.5744,  1.6232],   // Igualada
  61: [40.8656,  0.7208],   // L'Ampolla
  62: [41.3441,  1.6983],   // Vilafranca del Penedès
  63: [41.1960,  0.7310],   // La Torre de l'Espanyol
  64: [41.5250,  0.9664],   // Arbeca
  65: [41.2915,  1.2524],   // Valls
}

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

/**
 * Fetch the CCMA list and convert cameras within `maxKm` of (userLat, userLon)
 * into synthetic webcam objects that match the Windy v3 shape.
 */
async function fetchCcmaCameras(userLat, userLon, maxKm) {
  try {
    const res = await fetch(CCMA_URL)
    if (!res.ok) return []
    const data = await res.json()
    const items = data?.resposta?.items?.item ?? []

    const out = []
    for (const cam of items) {
      const coords = CCMA_COORDS[cam.id]
      if (!coords) continue
      const [camLat, camLon] = coords
      const dist = haversineKm(userLat, userLon, camLat, camLon)
      if (dist > maxKm) continue

      // Pick the "petit" (small/preview) snapshot, fall back to "gran"
      const petit = cam.snapshots?.find(s => s.format === 'petit')
      const gran  = cam.snapshots?.find(s => s.format === 'gran')
      const snap  = petit ?? gran
      if (!snap) continue

      out.push({
        webcamId: `3cat_${cam.id}`,
        title:    cam.nom,
        status:   'active',
        location: { latitude: camLat, longitude: camLon, city: cam.nom },
        images: {
          current: {
            preview:   CCMA_IMG + snap.fitxer,
            thumbnail: CCMA_IMG + snap.fitxer,
          },
        },
        player: { day: null },
      })
    }
    return out
  } catch {
    return []
  }
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

  // Fetch Windy and CCMA in parallel
  const [windyResult, ccmaCams] = await Promise.allSettled([
    fetch(windyUrl, { headers: { 'x-windy-api-key': WINDY_KEY } })
      .then(r => r.ok ? r.json() : Promise.reject(r.status)),
    fetchCcmaCameras(userLat, userLon, 50),
  ])

  // If Windy hard-failed, return error
  if (windyResult.status === 'rejected' && (ccmaCams.status === 'rejected' || !ccmaCams.value?.length)) {
    return new Response(JSON.stringify({ error: 'Webcam sources unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const windyCams  = windyResult.status === 'fulfilled' ? (windyResult.value?.webcams ?? []) : []
  const extraCams  = ccmaCams.status  === 'fulfilled'  ? (ccmaCams.value  ?? [])             : []

  // Merge and sort by haversine distance — nearest camera wins regardless of source
  const allCams = [...windyCams, ...extraCams]
  allCams.sort((a, b) => {
    const aLat = a.location?.latitude
    const aLon = a.location?.longitude
    const bLat = b.location?.latitude
    const bLon = b.location?.longitude
    const dA = (aLat != null && aLon != null) ? haversineKm(userLat, userLon, aLat, aLon) : Infinity
    const dB = (bLat != null && bLon != null) ? haversineKm(userLat, userLon, bLat, bLon) : Infinity
    return dA - dB
  })

  return new Response(JSON.stringify({ webcams: allCams }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
