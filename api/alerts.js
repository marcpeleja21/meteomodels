/**
 * Vercel Edge Function — proxies MeteoAlarm legacy Atom feeds.
 * The feed blocks direct browser requests (CORS/network), so we fetch
 * it server-side and relay the XML back with proper CORS headers.
 *
 * Alert filtering is done entirely client-side in alerts.ts using
 * text-based location matching (city name + admin3/comarca).
 * The MeteoAlarm zones API (EMMA point lookup) was removed in 2026.
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

// ── MeteoAlarm zones API ───────────────────────────────────────────────────────
// NOTE: The MeteoAlarm zones API (feeds.meteoalarm.org/api/v1/zones/feeds-XX/)
// has been permanently removed (returns 404 for all countries as of 2026).
// EMMA zone ID lookup is therefore disabled; alert filtering falls back to
// text-based matching in the client (alertMatchesLocation in alerts.ts).
// Keeping the helper as a no-op so the handler below needs no restructuring.
async function getEmmaIdsForPoint(_slug, _lat, _lon) {   // eslint-disable-line no-unused-vars
  return null
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
