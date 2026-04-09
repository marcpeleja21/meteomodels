/**
 * Vercel Edge Function — proxies MeteoBlue basic-1h_basic-day package.
 * MeteoBlue does not send Access-Control-Allow-Origin headers so direct
 * browser fetches are blocked by CORS. This function runs server-side,
 * forwards the request and adds the required CORS header.
 */
export const config = { runtime: 'edge' }

export default async function handler(request) {
  const { searchParams } = new URL(request.url)
  const lat    = searchParams.get('lat')
  const lon    = searchParams.get('lon')
  const apikey = searchParams.get('apikey')

  if (!lat || !lon || !apikey) {
    return new Response(JSON.stringify({ error: 'Missing lat, lon or apikey' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    const url = `https://my.meteoblue.com/packages/basic-1h_basic-day` +
      `?lat=${lat}&lon=${lon}&apikey=${encodeURIComponent(apikey)}&format=json&temperature=C&windspeed=kmh`

    const res = await fetch(url)
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `MeteoBlue HTTP ${res.status}` }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const data = await res.text()
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}
