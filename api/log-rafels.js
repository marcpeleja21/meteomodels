// Vercel Edge Function — poll IRFALE2 and upsert into Supabase
// Triggered by Vercel Cron (vercel.json). Env: SUPABASE_URL, SUPABASE_KEY, WU_KEY
export const config = { runtime: 'edge' }

const WU_KEY  = process.env.WU_KEY  ?? '3b28991981854cdba8991981851cdbb8'
const STATION = 'IRFALE2'
const BASE    = 'https://api.weather.com'

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response('SUPABASE_URL / SUPABASE_KEY not configured', { status: 503 })
  }

  // Fetch the last 24h of 5-min readings (same endpoint as the day view)
  const obsUrl = `${BASE}/v2/pws/observations/all/1day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`
  const res = await fetch(obsUrl)
  if (!res.ok) {
    return new Response(`WU fetch failed: ${res.status}`, { status: 502 })
  }
  const { observations } = await res.json()
  if (!observations?.length) {
    return new Response('No observations returned', { status: 204 })
  }

  const rows = observations.map(o => ({
    ts:           o.obsTimeUtc,
    temp:         o.metric?.temp          ?? null,
    feels_like:   o.metric?.heatIndex     ?? o.metric?.windChill ?? null,
    dewpt:        o.metric?.dewpt         ?? null,
    humidity:     o.humidityAvg           ?? o.humidity ?? null,
    wind_speed:   o.metric?.windSpeed     ?? null,
    wind_gust:    o.metric?.windGust      ?? null,
    wind_dir:     o.winddir               ?? null,
    pressure:     o.metric?.pressure      ?? null,
    precip_rate:  o.metric?.precipRate    ?? null,
    precip_total: o.metric?.precipTotal   ?? null,
  })).filter(r => r.ts)

  // Upsert via Supabase REST API — on_conflict=ts deduplicates re-runs
  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/observations`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  })

  if (!upsertRes.ok) {
    const err = await upsertRes.text()
    return new Response(`Supabase upsert failed: ${err}`, { status: 502 })
  }

  return new Response(JSON.stringify({ inserted: rows.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
