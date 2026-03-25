/**
 * Vercel Edge Function — proxies wttr.in for real weather station data.
 * wttr.in aggregates from WMO, SYNOP, METAR and WU stations — real observations,
 * not model analysis.
 */
export const config = { runtime: 'edge' }

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
    const res = await fetch(`https://wttr.in/${lat},${lon}?format=j1`, {
      headers: { 'User-Agent': 'MeteoModels/1.0 (meteomodels.vercel.app)' },
    })
    if (!res.ok) throw new Error(`wttr.in ${res.status}`)
    const data = await res.json()
    return new Response(JSON.stringify(data), {
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
