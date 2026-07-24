// One-shot backfill endpoint for the observations table.
// Uses WU dailysummary/7day for recent dates, Open-Meteo ERA5 archive for older ones.
// Call: GET /api/repair-rafels?from=2026-07-14&to=2026-07-23
// Dry run (no writes): add &dry=1
export const config = { runtime: 'edge' }

const WU_KEY  = process.env.WU_KEY  ?? '3b28991981854cdba8991981851cdbb8'
const STATION = 'IRFALE2'
const BASE    = 'https://api.weather.com'
const LAT     = 38.73
const LON     = -0.63

const rnd1 = v => v != null ? +v.toFixed(1) : null

export default async function handler(req) {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY
  if (!supabaseUrl || !supabaseKey) return new Response('missing env', { status: 503 })

  const url  = new URL(req.url)
  const dry  = url.searchParams.has('dry')
  const sbH  = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

  // Determine date range to fill
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  let from = url.searchParams.get('from')
  let to   = url.searchParams.get('to') || yesterday

  if (!from) {
    // Auto-detect: find the latest date already in observations
    const r = await fetch(
      `${supabaseUrl}/rest/v1/observations?select=obs_date&order=obs_date.desc&limit=1`,
      { headers: sbH }
    )
    if (r.ok) {
      const rows = await r.json()
      if (rows.length) {
        const last = new Date(rows[0].obs_date + 'T12:00:00Z')
        last.setUTCDate(last.getUTCDate() + 1)
        from = last.toISOString().slice(0, 10)
      }
    }
    if (!from) from = yesterday
  }

  if (from > to) {
    return new Response(JSON.stringify({ ok: true, message: 'No gap to fill', latestInDb: from }), { headers: cors })
  }

  const log = [`Filling ${from} → ${to}${dry ? ' (DRY RUN)' : ''}`]

  // --- WU dailysummary/7day (station-accurate for recent 7 days) ---
  const wuByDate = {}
  try {
    const wuRes = await fetch(
      `${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`
    )
    if (wuRes.ok) {
      const json = await wuRes.json()
      for (const s of (json?.summaries ?? json?.observations ?? [])) {
        const date = (s.obsTimeLocal ?? '').slice(0, 10)
        if (date >= from && date <= to) {
          wuByDate[date] = {
            obs_date:  date,
            temp_high: rnd1(s.metric?.tempHigh),
            temp_low:  rnd1(s.metric?.tempLow),
            temp_avg:  rnd1(s.metric?.tempAvg),
            humidity:  s.humidityAvg != null ? Math.round(s.humidityAvg) : null,
            precip:    rnd1(s.metric?.precipTotal),
            wind_high: rnd1(s.metric?.windspeedHigh ?? s.metric?.windSpeedHigh ?? s.metric?.windGustHigh),
          }
        }
      }
      log.push(`WU dailysummary covered: ${Object.keys(wuByDate).sort().join(', ') || 'none'}`)
    } else {
      log.push(`WU dailysummary HTTP ${wuRes.status}`)
    }
  } catch (e) {
    log.push(`WU fetch error: ${e.message}`)
  }

  // --- Open-Meteo ERA5 archive for dates WU didn't cover ---
  const omNeeded = []
  let d = new Date(from + 'T12:00:00Z')
  const dEnd = new Date(to + 'T12:00:00Z')
  while (d <= dEnd) {
    const ds = d.toISOString().slice(0, 10)
    if (!wuByDate[ds]) omNeeded.push(ds)
    d.setUTCDate(d.getUTCDate() + 1)
  }

  const omByDate = {}
  if (omNeeded.length) {
    const omFrom = omNeeded[0]
    const omTo   = omNeeded[omNeeded.length - 1]
    try {
      const omRes = await fetch(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}` +
        `&start_date=${omFrom}&end_date=${omTo}` +
        `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,wind_speed_10m_max` +
        `&timezone=Europe%2FMadrid`
      )
      if (omRes.ok) {
        const { daily } = await omRes.json()
        for (let i = 0; i < daily.time.length; i++) {
          const date = daily.time[i]
          omByDate[date] = {
            obs_date:  date,
            temp_high: rnd1(daily.temperature_2m_max[i]),
            temp_low:  rnd1(daily.temperature_2m_min[i]),
            temp_avg:  rnd1(daily.temperature_2m_mean[i]),
            humidity:  null,
            precip:    rnd1(daily.precipitation_sum[i]),
            wind_high: rnd1(daily.wind_speed_10m_max[i]),
          }
        }
        log.push(`OM archive covered: ${Object.keys(omByDate).sort().join(', ') || 'none'}`)
      } else {
        log.push(`OM archive HTTP ${omRes.status}`)
      }
    } catch (e) {
      log.push(`OM fetch error: ${e.message}`)
    }
  }

  // Merge: WU takes priority over OM
  const rows = { ...omByDate, ...wuByDate }
  const rowList = Object.values(rows).sort((a, b) => a.obs_date < b.obs_date ? -1 : 1)

  log.push(`Total rows to write: ${rowList.length} (${rowList.filter(r => wuByDate[r.obs_date]).length} WU, ${rowList.filter(r => omByDate[r.obs_date]).length} OM)`)

  if (dry || !rowList.length) {
    return new Response(JSON.stringify({ ok: true, dry, log, rows: rowList }), { headers: cors })
  }

  // Write to Supabase
  const sbHeaders = {
    'Content-Type':  'application/json',
    'apikey':        supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Prefer':        'resolution=merge-duplicates',
  }
  const writeRes = await fetch(`${supabaseUrl}/rest/v1/observations`, {
    method: 'POST', headers: sbHeaders, body: JSON.stringify(rowList),
  })
  log.push(`Supabase write: HTTP ${writeRes.status}`)

  return new Response(JSON.stringify({
    ok:      writeRes.ok,
    written: writeRes.ok ? rowList.length : 0,
    log,
    rows:    rowList,
  }), { status: writeRes.ok ? 200 : 502, headers: cors })
}
