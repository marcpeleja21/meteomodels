// Vercel Edge Function — daily IRFALE2 summary logger
// Runs daily at 2am UTC via Vercel cron. Env: SUPABASE_URL, SUPABASE_KEY
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

  const res = await fetch(
    `${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`
  )
  if (!res.ok) {
    return new Response(`WU fetch failed: ${res.status}`, { status: 502 })
  }

  const json = await res.json()
  const rows = (json?.summaries ?? json?.observations ?? [])
    .map(s => ({
      obs_date:  (s.obsTimeLocal ?? '').slice(0, 10),
      temp_high: s.metric?.tempHigh    ?? null,
      temp_low:  s.metric?.tempLow     ?? null,
      temp_avg:  s.metric?.tempAvg     ?? null,
      humidity:  s.humidityAvg         ?? null,
      precip:    s.metric?.precipTotal ?? null,
    }))
    .filter(r => r.obs_date)

  if (!rows.length) {
    return new Response(JSON.stringify({ upserted: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

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

  return new Response(JSON.stringify({ upserted: rows.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
