/**
 * Vercel Edge Function — proxies MeteoAlarm legacy Atom feeds.
 * The feed blocks direct browser requests (CORS/network), so we fetch
 * it server-side and relay the XML back with proper CORS headers.
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
}

export default async function handler(request) {
  const { searchParams } = new URL(request.url)
  const cc = (searchParams.get('cc') ?? '').toUpperCase()

  const slug = EU_SLUGS[cc]
  if (!slug) {
    return new Response(JSON.stringify({ error: `Unsupported country: ${cc}` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const res = await fetch(
      `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${slug}`,
      { headers: { 'User-Agent': 'MeteoModels/1.0 (meteomodels.vercel.app)' } }
    )

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `MeteoAlarm ${res.status}` }), {
        status: res.status, headers: { 'Content-Type': 'application/json' },
      })
    }

    const xml = await res.text()
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
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
