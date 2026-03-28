/**
 * Vercel Edge Function — proxies MeteoAlarm legacy Atom feeds.
 * The feed blocks direct browser requests (CORS/network), so we fetch
 * it server-side and relay the XML back with proper CORS headers.
 *
 * Accepts optional ?lat=&lon= params.  When provided the function also
 * queries the MeteoAlarm zones API to find which EMMA zone IDs contain
 * the requested point and returns them in the X-Emma-Ids header so the
 * client can filter alerts precisely without text matching.
 */
export const config = { runtime: 'edge' }

const EU_SLUGS = {
  ES:'spain', FR:'france', DE:'germany', IT:'italy', PT:'portugal',
  AT:'austria', BE:'belgium', GB:'united-kingdom', CH:'switzerland',
  NL:'netherlands', PL:'poland', SE:'sweden', NO:'norway', DK:'denmark',
  FI:'finland', CZ:'czech-republic', SK:'slovakia', HU:'hungary',
  RO:'romania', HR:'croatia', SI:'slovenia', BG:'bulgaria', GR:'greece',
  CY:'cyprus', LU:'luxembourg', LT:'lithuania', LV:'latvia', EE:'estonia',
  IE:'ireland', MT:'malta', RS:'serbia', BA:'bosnia-and-herzegovina',
  ME:'montenegro', MK:'north-macedonia', AL:'albania', IS:'iceland',
  MD:'moldova', UA:'ukraine', XK:'kosovo',
}

const UA = 'MeteoModels/1.0 (meteomodels.vercel.app)'

// ── Point-in-polygon (ray casting) ────────────────────────────────────────────
function pointInPolygon(lat, lon, ring) {
  // ring = [[lon, lat], ...] (GeoJSON order)
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

function pointInGeom(lat, lon, geom) {
  if (!geom) return false
  if (geom.type === 'Polygon') {
    return pointInPolygon(lat, lon, geom.coordinates[0])
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(poly => pointInPolygon(lat, lon, poly[0]))
  }
  return false
}

function pointInBbox(lat, lon, bbox) {
  // GeoJSON bbox: [west, south, east, north]
  if (!Array.isArray(bbox) || bbox.length < 4) return false
  const [west, south, east, north] = bbox
  return lat >= south && lat <= north && lon >= west && lon <= east
}

// ── MeteoAlarm zones API ───────────────────────────────────────────────────────
async function getEmmaIdsForPoint(slug, lat, lon) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(
      `https://feeds.meteoalarm.org/api/v1/zones/feeds-${slug}/`,
      { headers: { 'User-Agent': UA }, signal: controller.signal },
    )
    clearTimeout(timer)
    if (!res.ok) return null

    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('json')) return null

    const data = await res.json()

    // Normalise to a flat array of { id, bbox?, geometry? }
    let zones = []
    if (Array.isArray(data)) {
      zones = data
    } else if (Array.isArray(data.zones)) {
      zones = data.zones
    } else if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      zones = data.features.map(f => ({
        id:       f.id ?? f.properties?.id ?? f.properties?.emma_id,
        bbox:     f.bbox,
        geometry: f.geometry,
        ...f.properties,
      }))
    } else {
      return null
    }

    const matching = []
    for (const zone of zones) {
      const id = zone.id ?? zone.emma_id ?? zone.emmaId
      if (!id) continue

      // Prefer full polygon, fall back to bounding box
      if (zone.geometry && pointInGeom(lat, lon, zone.geometry)) {
        matching.push(String(id))
      } else if (zone.bbox && pointInBbox(lat, lon, zone.bbox)) {
        matching.push(String(id))
      }
    }

    return matching.length > 0 ? matching : null
  } catch {
    clearTimeout(timer)
    return null
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(request) {
  const { searchParams } = new URL(request.url)
  const cc  = (searchParams.get('cc') ?? '').toUpperCase()
  const lat = parseFloat(searchParams.get('lat') ?? '')
  const lon = parseFloat(searchParams.get('lon') ?? '')
  const hasCoords = !isNaN(lat) && !isNaN(lon)

  const slug = EU_SLUGS[cc]
  if (!slug) {
    return new Response(JSON.stringify({ error: `Unsupported country: ${cc}` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // Fetch the XML feed and (optionally) EMMA zone IDs in parallel
    const [xmlRes, emmaIds] = await Promise.all([
      fetch(
        `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${slug}`,
        { headers: { 'User-Agent': UA } },
      ),
      hasCoords ? getEmmaIdsForPoint(slug, lat, lon) : Promise.resolve(null),
    ])

    if (!xmlRes.ok) {
      return new Response(JSON.stringify({ error: `MeteoAlarm ${xmlRes.status}` }), {
        status: xmlRes.status, headers: { 'Content-Type': 'application/json' },
      })
    }

    const xml = await xmlRes.text()

    const headers = {
      'Content-Type':                'application/xml; charset=utf-8',
      'Cache-Control':               'public, max-age=300, s-maxage=300',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Emma-Ids',
    }

    if (emmaIds && emmaIds.length > 0) {
      headers['X-Emma-Ids'] = emmaIds.join(',')
    }

    return new Response(xml, { headers })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    })
  }
}
