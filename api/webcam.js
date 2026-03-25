/**
 * Vercel Edge Function — proxies Windy Webcams API v3
 * Avoids CORS restrictions when called from the browser.
 */
export const config = { runtime: 'edge' }

const WINDY_KEY = 'GC7hTRIRIMPMcO8qFe27DzAZIWJoOnH3'

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

  const windyUrl =
    `https://api.windy.com/webcams/api/v3/webcams` +
    `?nearby=${lat},${lon},25` +
    `&limit=5&sortKey=popularity&sortDirection=desc` +
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
