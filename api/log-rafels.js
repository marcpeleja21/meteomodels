// Vercel Edge Function — daily IRFALE2 summary logger
// Runs daily at 2am UTC via Vercel cron. Env: SUPABASE_URL, SUPABASE_KEY, WU_KEY
export const config = { runtime: 'edge' }

const WU_KEY  = process.env.WU_KEY  ?? '3b28991981854cdba8991981851cdbb8'
const STATION = 'IRFALE2'
const BASE    = 'https://api.weather.com'

const avg  = arr => arr.length ? arr.reduce((a, c) => a + c, 0) / arr.length : null
const rnd1 = v   => v != null ? +v.toFixed(1) : null

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY
  if (!supabaseUrl || !supabaseKey) return new Response('missing env', { status: 503 })

  const sbHeaders = {
    'Content-Type':  'application/json',
    'apikey':        supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Prefer':        'resolution=merge-duplicates',
  }

  const [summaryRes, histRes] = await Promise.allSettled([
    // Daily summaries → observations table
    fetch(`${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`),
    // 5-min readings → observations_hourly table
    fetch(`${BASE}/v2/pws/observations/all/1day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`),
  ])

  // ── 1. Daily observations ──────────────────────────────────────────────────
  let dailyUpserted = 0
  if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
    const json = await summaryRes.value.json()
    const rows = (json?.summaries ?? json?.observations ?? [])
      .map(s => ({
        obs_date:  (s.obsTimeLocal ?? '').slice(0, 10),
        temp_high: s.metric?.tempHigh    ?? null,
        temp_low:  s.metric?.tempLow     ?? null,
        temp_avg:  s.metric?.tempAvg     ?? null,
        humidity:  s.humidityAvg != null ? Math.round(s.humidityAvg) : null,
        precip:    s.metric?.precipTotal ?? null,
        wind_high: s.metric?.windSpeedHigh ?? s.metric?.windspeedHigh ?? null,
      }))
      .filter(r => r.obs_date)

    if (rows.length) {
      await fetch(`${supabaseUrl}/rest/v1/observations`, {
        method: 'POST', headers: sbHeaders, body: JSON.stringify(rows),
      })
      dailyUpserted = rows.length
    }
  }

  // ── 2. Hourly observations (from 5-min readings) ───────────────────────────
  let hourlyUpserted = 0
  if (histRes.status === 'fulfilled' && histRes.value.ok) {
    const json = await histRes.value.json()
    const allObs = json?.observations ?? []

    // At 2am UTC Ràfels is 3-4am local, so yesterday is fully captured.
    // Find yesterday's date from the most recent reading's local timestamp.
    const mostRecentDate = (allObs[allObs.length - 1]?.obsTimeLocal ?? '').slice(0, 10)
    const prevDate = mostRecentDate
      ? new Date(new Date(mostRecentDate).getTime() - 86400000).toISOString().slice(0, 10)
      : (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) })()

    const dayObs = allObs.filter(o => (o.obsTimeLocal ?? '').slice(0, 10) === prevDate)

    if (dayObs.length) {
      // Rain column is a running daily cumulative → compute per-reading deltas
      const sorted = [...dayObs].sort((a, b) =>
        (a.obsTimeLocal ?? '').localeCompare(b.obsTimeLocal ?? ''))
      sorted.forEach((o, i) => {
        const prev = i > 0 ? (sorted[i - 1].metric?.precipTotal ?? 0) : 0
        o._rainDelta = Math.max(0, (o.metric?.precipTotal ?? prev) - prev)
      })

      // Bucket by hour
      const buckets = {}
      for (const o of sorted) {
        const h = parseInt((o.obsTimeLocal ?? '00').slice(11, 13), 10)
        if (!buckets[h]) buckets[h] = { temps: [], humids: [], rainDeltas: [], windAvgs: [], windHighs: [] }
        const b = buckets[h]
        if (o.metric?.tempAvg  != null) b.temps.push(o.metric.tempAvg)
        if (o.humidityAvg      != null) b.humids.push(o.humidityAvg)
        b.rainDeltas.push(o._rainDelta)
        const wa = o.metric?.windSpeedAvg ?? o.metric?.windspeedAvg ?? o.metric?.windSpeed
        if (wa != null) b.windAvgs.push(wa)
        const wh = o.metric?.windSpeedHigh ?? o.metric?.windspeedHigh ?? wa
        if (wh != null) b.windHighs.push(wh)
      }

      const hourlyRows = Object.entries(buckets).map(([h, b]) => ({
        obs_date:  prevDate,
        obs_hour:  parseInt(h),
        temp_avg:  rnd1(avg(b.temps)),
        temp_high: rnd1(b.temps.length ? Math.max(...b.temps) : null),
        temp_low:  rnd1(b.temps.length ? Math.min(...b.temps) : null),
        humidity:  rnd1(avg(b.humids)),
        precip:    rnd1(b.rainDeltas.reduce((a, c) => a + c, 0)),
        wind_avg:  rnd1(avg(b.windAvgs)),
        wind_high: rnd1(b.windHighs.length ? Math.max(...b.windHighs) : null),
      }))

      if (hourlyRows.length) {
        const r = await fetch(`${supabaseUrl}/rest/v1/observations_hourly`, {
          method: 'POST', headers: sbHeaders, body: JSON.stringify(hourlyRows),
        })
        if (r.ok) hourlyUpserted = hourlyRows.length
      }
    }
  }

  return new Response(JSON.stringify({ daily: dailyUpserted, hourly: hourlyUpserted }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
