// One-shot endpoint to retroactively apply the PWS rain_gain to existing Supabase rows.
// The station's rain_gain=1.5 is only applied to the local display, not transmitted to WU,
// so all historical precip values stored before this fix are 1/1.5× too low.
//
// Dry run (no writes): GET /api/apply-rain-gain?dry=1
// Apply:              GET /api/apply-rain-gain
// Custom range/gain:  GET /api/apply-rain-gain?from=2026-08-01&gain=1.5
export const config = { runtime: 'edge' }

const DEFAULT_FROM = '2026-08-01'
const DEFAULT_GAIN = 1.5

export default async function handler(req) {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY
  if (!supabaseUrl || !supabaseKey) return new Response('missing env', { status: 503 })

  const url  = new URL(req.url)
  const dry  = url.searchParams.has('dry')
  const gain = parseFloat(url.searchParams.get('gain') ?? DEFAULT_GAIN)
  const from = url.searchParams.get('from') ?? DEFAULT_FROM
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  const sbR  = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  const sbW  = { ...sbR, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }

  const log = [`${dry ? 'DRY RUN — ' : ''}gain=${gain}, from=${from}`]
  const result = {}

  // ── daily observations ────────────────────────────────────────────────────
  {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/observations?obs_date=gte.${from}` +
      `&select=obs_date,temp_high,temp_low,temp_avg,humidity,precip,wind_high&order=obs_date`,
      { headers: sbR }
    )
    const rows = r.ok ? await r.json() : []
    const updated = rows
      .filter(row => row.precip != null)
      .map(row => ({ ...row, precip: +(row.precip * gain).toFixed(1) }))

    log.push(`observations: ${rows.length} rows fetched, ${updated.length} with precip to update`)
    result.daily = { fetched: rows.length, toUpdate: updated.length }

    if (!dry && updated.length) {
      const wr = await fetch(`${supabaseUrl}/rest/v1/observations?on_conflict=obs_date`, {
        method: 'POST', headers: sbW, body: JSON.stringify(updated),
      })
      log.push(`observations write: HTTP ${wr.status}`)
      result.daily.writeStatus = wr.status
    }
  }

  // ── hourly observations ───────────────────────────────────────────────────
  {
    const PAGE = 1000
    let all = [], offset = 0
    while (true) {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/observations_hourly?obs_date=gte.${from}` +
        `&select=obs_date,obs_hour,temp_avg,temp_high,temp_low,humidity,precip,wind_avg,wind_high` +
        `&order=obs_date.asc,obs_hour.asc&limit=${PAGE}&offset=${offset}`,
        { headers: sbR }
      )
      if (!r.ok) break
      const batch = await r.json()
      all = all.concat(batch)
      if (batch.length < PAGE) break
      offset += PAGE
    }

    const updated = all
      .filter(row => row.precip != null)
      .map(row => ({ ...row, precip: +(row.precip * gain).toFixed(1) }))

    log.push(`observations_hourly: ${all.length} rows fetched, ${updated.length} with precip to update`)
    result.hourly = { fetched: all.length, toUpdate: updated.length }

    if (!dry && updated.length) {
      const CHUNK = 500
      let written = 0, errors = 0
      for (let i = 0; i < updated.length; i += CHUNK) {
        const chunk = updated.slice(i, i + CHUNK)
        const wr = await fetch(`${supabaseUrl}/rest/v1/observations_hourly?on_conflict=obs_date,obs_hour`, {
          method: 'POST', headers: sbW, body: JSON.stringify(chunk),
        })
        log.push(`observations_hourly chunk ${i}–${i + chunk.length}: HTTP ${wr.status}`)
        if (wr.ok) written += chunk.length; else errors += chunk.length
      }
      result.hourly.written = written
      result.hourly.errors  = errors
    }
  }

  return new Response(JSON.stringify({ dry, gain, from, log, result }, null, 2), { headers: cors })
}
