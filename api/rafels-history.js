export const config = { runtime: 'edge' }

const avg = arr => arr.length ? arr.reduce((a, c) => a + c, 0) / arr.length : null
const rnd = (v, d = 1) => v != null ? +v.toFixed(d) : null

function toMonthly(rows) {
  const bkt = {}
  for (const r of rows) {
    const m = (r.obs_date ?? '').slice(0, 7)
    if (!m) continue
    if (!bkt[m]) bkt[m] = { ths: [], tls: [], tas: [], hs: [], ps: [], ws: [] }
    const b = bkt[m]
    if (r.temp_high != null) b.ths.push(+r.temp_high)
    if (r.temp_low  != null) b.tls.push(+r.temp_low)
    if (r.temp_avg  != null) b.tas.push(+r.temp_avg)
    if (r.humidity  != null) b.hs.push(+r.humidity)
    if (r.precip    != null) b.ps.push(+r.precip)
    if (r.wind_high != null) b.ws.push(+r.wind_high)
  }
  return Object.entries(bkt)
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([m, b]) => ({
      obs_date:  m,
      temp_high: b.ths.length ? rnd(Math.max(...b.ths)) : null,
      temp_low:  b.tls.length ? rnd(Math.min(...b.tls)) : null,
      temp_avg:  rnd(avg(b.tas)),
      humidity:  rnd(avg(b.hs)),
      precip:    rnd(b.ps.reduce((a, c) => a + c, 0)),
      wind_high: b.ws.length ? rnd(Math.max(...b.ws)) : null,
    }))
}

export default async function handler(req) {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY
  if (!supabaseUrl || !supabaseKey) return new Response('missing env', { status: 503 })

  const url  = new URL(req.url)
  const mode = url.searchParams.get('mode') ?? ''
  const sbH  = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  const cors = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' }

  async function sb(table, qs) {
    const r = await fetch(`${supabaseUrl}/rest/v1/${table}?${qs}`, { headers: sbH })
    if (!r.ok) throw new Error('sb ' + r.status)
    return r.json()
  }

  async function sbAll(table, qs) {
    const PAGE = 1000
    let all = [], offset = 0
    while (true) {
      const batch = await sb(table, `${qs}&limit=${PAGE}&offset=${offset}`)
      all = all.concat(batch)
      if (batch.length < PAGE) break
      offset += PAGE
    }
    return all
  }

  try {
    // ── Day mode: hourly table ─────────────────────────────────────────────
    if (mode === 'day') {
      const date = url.searchParams.get('date') ?? ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('bad date', { status: 400 })
      const [hourlyRows, dailyRows] = await Promise.all([
        sb('observations_hourly',
          `obs_date=eq.${date}&select=obs_date,obs_hour,temp_avg,temp_high,temp_low,humidity,precip,wind_avg,wind_high&order=obs_hour`),
        sb('observations',
          `obs_date=eq.${date}&select=temp_high,temp_low,temp_avg,precip&limit=1`),
      ])

      // Anchor hourly slots to the verified daily summary — mirrors the week-chart WU anchor in
      // rafels.js. Needed because hourly rows can come from ERA5 gap-fill (wrong coordinates,
      // capped temps, missing rain) while the daily summary is correct from WU.
      if (hourlyRows.length && dailyRows.length) {
        const daily = dailyRows[0]
        const rows  = hourlyRows.map(r => ({ ...r }))  // shallow copy

        if (daily.temp_high != null) {
          const peak = rows.reduce((a, b) => ((b.temp_high ?? -Infinity) > (a.temp_high ?? -Infinity) ? b : a))
          if ((peak.temp_high ?? -Infinity) < daily.temp_high) peak.temp_high = daily.temp_high
        }
        if (daily.temp_low != null) {
          const trough = rows.reduce((a, b) => ((b.temp_low ?? Infinity) < (a.temp_low ?? Infinity) ? b : a))
          if ((trough.temp_low ?? Infinity) > daily.temp_low) trough.temp_low = daily.temp_low
        }
        if (daily.precip != null && daily.precip > 0) {
          const slotTotal = rows.reduce((a, r) => a + (r.precip ?? 0), 0)
          if (slotTotal === 0) rows[0].precip = daily.precip
        }

        return new Response(JSON.stringify({ mode, hourly: true, monthly: false, rows }), { headers: cors })
      }

      return new Response(JSON.stringify({ mode, hourly: true, monthly: false, rows: hourlyRows }), { headers: cors })
    }

    // ── All other modes: daily observations table ──────────────────────────
    let from, to
    if (mode === 'year') {
      const y = url.searchParams.get('year') ?? ''
      if (!/^\d{4}$/.test(y)) return new Response('bad year', { status: 400 })
      from = `${y}-01-01`; to = `${y}-12-31`
    } else if (mode === 'month') {
      const y  = url.searchParams.get('year')  ?? ''
      const m  = url.searchParams.get('month') ?? ''
      if (!y || !m) return new Response('bad params', { status: 400 })
      const mm = m.padStart(2, '0')
      from = `${y}-${mm}-01`
      to   = new Date(+y, +m, 0).toISOString().slice(0, 10)
    } else if (mode === 'range') {
      from = url.searchParams.get('from') ?? ''
      to   = url.searchParams.get('to')   ?? ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
        return new Response('bad range', { status: 400 })
    } else {
      return new Response('bad mode', { status: 400 })
    }

    const rows = await sbAll('observations',
      `obs_date=gte.${from}&obs_date=lte.${to}&select=obs_date,temp_high,temp_low,temp_avg,humidity,precip,wind_high&order=obs_date`)

    const daySpan  = (new Date(to) - new Date(from)) / 86400000
    const monthly  = mode === 'year' || daySpan > 90
    const outRows  = monthly ? toMonthly(rows) : rows

    return new Response(JSON.stringify({ mode, hourly: false, monthly, rows: outRows, rawCount: rows.length }), { headers: cors })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: cors })
  }
}
