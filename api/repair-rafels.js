// One-shot backfill/repair endpoint for the observations table.
// Priority: WU dailysummary/7day → WU history/daily → Open-Meteo ERA5 fallback.
// Call: GET /api/repair-rafels?from=2026-07-01&to=2026-08-24
// Dry run (no writes): add &dry=1
export const config = { runtime: 'edge' }

const WU_KEY    = process.env.WU_KEY  ?? '3b28991981854cdba8991981851cdbb8'
const STATION   = 'IRFALE2'
const BASE      = 'https://api.weather.com'
const LAT       = 40.84
const LON       = 0.02
const RAIN_GAIN = 1.55

const rnd1 = v => v != null ? +v.toFixed(1) : null

function daysAgo(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function dateRange(from, to) {
  const dates = []
  const d = new Date(from + 'T12:00:00Z')
  const end = new Date(to + 'T12:00:00Z')
  while (d <= end) { dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return dates
}

function summaryToRow(s) {
  const date = (s.obsTimeLocal ?? '').slice(0, 10)
  if (!date) return null
  return {
    obs_date:  date,
    temp_high: rnd1(s.metric?.tempHigh),
    temp_low:  rnd1(s.metric?.tempLow),
    temp_avg:  rnd1(s.metric?.tempAvg),
    humidity:  s.humidityAvg != null ? Math.round(s.humidityAvg) : null,
    precip:    rnd1(s.metric?.precipTotal != null ? s.metric.precipTotal * RAIN_GAIN : null),
    wind_high: rnd1(s.metric?.windspeedHigh ?? s.metric?.windSpeedHigh ?? s.metric?.windGustHigh),
  }
}

export default async function handler(req) {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY
  if (!supabaseUrl || !supabaseKey) return new Response('missing env', { status: 503 })

  const url  = new URL(req.url)
  const dry  = url.searchParams.has('dry')
  const sbH  = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

  const yesterday = daysAgo(1)
  let from = url.searchParams.get('from')
  let to   = url.searchParams.get('to') || yesterday

  if (!from) {
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
  const allDates    = dateRange(from, to)
  const sevenDaysAgo = daysAgo(7)
  const wuByDate    = {}

  // 1. WU dailysummary/7day for recent dates (most accurate)
  try {
    const wuRes = await fetch(
      `${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`
    )
    if (wuRes.ok) {
      const json = await wuRes.json()
      for (const s of (json?.summaries ?? json?.observations ?? [])) {
        const row = summaryToRow(s)
        if (row && row.obs_date >= from && row.obs_date <= to) wuByDate[row.obs_date] = row
      }
      log.push(`WU 7day: ${Object.keys(wuByDate).length} dates covered`)
    } else {
      log.push(`WU 7day HTTP ${wuRes.status}`)
    }
  } catch (e) {
    log.push(`WU 7day error: ${e.message}`)
  }

  // 2. WU history/daily for dates outside the 7-day window
  const olderDates = allDates.filter(d => d < sevenDaysAgo && !wuByDate[d])
  if (olderDates.length) {
    log.push(`Fetching WU history for ${olderDates.length} dates...`)
    const results = await Promise.all(
      olderDates.map(async date => {
        const dateStr = date.replace(/-/g, '')
        try {
          const r = await fetch(
            `${BASE}/v2/pws/history/daily?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&date=${dateStr}&apiKey=${WU_KEY}`
          )
          if (!r.ok) return { date, error: `HTTP ${r.status}` }
          const json = await r.json()
          const summaries = json?.summaries ?? json?.observations ?? []
          if (!summaries.length) return { date, error: 'no data' }
          const row = summaryToRow(summaries[0])
          return { date, row }
        } catch (e) {
          return { date, error: e.message }
        }
      })
    )
    let wuHistoryCount = 0
    for (const { date, row, error } of results) {
      if (row) { wuByDate[date] = row; wuHistoryCount++ }
      else log.push(`  WU history ${date}: ${error}`)
    }
    log.push(`WU history: ${wuHistoryCount}/${olderDates.length} dates covered`)
  }

  // 3. ERA5 fallback for any date with no WU data
  const omNeeded = allDates.filter(d => !wuByDate[d])
  const omByDate = {}
  if (omNeeded.length) {
    try {
      const omRes = await fetch(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}` +
        `&start_date=${omNeeded[0]}&end_date=${omNeeded[omNeeded.length - 1]}` +
        `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,wind_speed_10m_max` +
        `&timezone=Europe%2FMadrid`
      )
      if (omRes.ok) {
        const { daily } = await omRes.json()
        for (let i = 0; i < daily.time.length; i++) {
          const date = daily.time[i]
          if (!wuByDate[date] && date >= from && date <= to) {
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
        }
        log.push(`ERA5 fallback: ${Object.keys(omByDate).length} dates`)
      } else {
        log.push(`ERA5 HTTP ${omRes.status}`)
      }
    } catch (e) {
      log.push(`ERA5 error: ${e.message}`)
    }
  }

  const rows    = { ...omByDate, ...wuByDate }
  const rowList = Object.values(rows).sort((a, b) => a.obs_date < b.obs_date ? -1 : 1)
  log.push(`Total: ${rowList.length} rows (${Object.keys(wuByDate).length} WU, ${Object.keys(omByDate).length} ERA5)`)

  if (dry || !rowList.length) {
    return new Response(JSON.stringify({ ok: true, dry, log, rows: rowList }), { headers: cors })
  }

  const sbHeaders = {
    'Content-Type':  'application/json',
    apikey:          supabaseKey,
    Authorization:   `Bearer ${supabaseKey}`,
    Prefer:          'resolution=merge-duplicates',
  }
  const writeRes = await fetch(`${supabaseUrl}/rest/v1/observations?on_conflict=obs_date`, {
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
