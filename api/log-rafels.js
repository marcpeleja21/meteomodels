// Vercel Edge Function — daily IRFALE2 summary logger
// Runs daily at 2am UTC via Vercel cron. Env: SUPABASE_URL, SUPABASE_KEY, WU_KEY
// Self-heals: after each WU write it checks Supabase for gaps and fills them from
// Open-Meteo ERA5 archive — so a failed run or a WU outage never creates a permanent hole.
export const config = { runtime: 'edge' }

const WU_KEY   = process.env.WU_KEY  ?? '3b28991981854cdba8991981851cdbb8'
const STATION  = 'IRFALE2'
const BASE     = 'https://api.weather.com'
const LAT      = 40.84
const LON      = 0.02
// PWS rain_gain=1.5 is applied locally on the console display but not transmitted to WU.
// Correct all WU-sourced precipitation here. ERA5 gap-fill is unaffected.
const RAIN_GAIN = 1.55

const avg  = arr => arr.length ? arr.reduce((a, c) => a + c, 0) / arr.length : null
const rnd1 = v   => v != null ? +v.toFixed(1) : null

// Returns UTC date string N days before today
function daysAgo(n) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// All calendar dates in [from, to] inclusive
function dateRange(from, to) {
  const dates = []
  const d = new Date(from + 'T12:00:00Z')
  const end = new Date(to + 'T12:00:00Z')
  while (d <= end) { dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return dates
}

export default async function handler(req) {
  const url   = new URL(req.url)
  const debug = url.searchParams.has('debug')
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_KEY
  if (!supabaseUrl || !supabaseKey) return new Response('missing env', { status: 503 })

  const sbW = {  // write headers
    'Content-Type': 'application/json',
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Prefer: 'resolution=merge-duplicates',
  }
  const sbR = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }  // read headers

  // Kick off both WU fetches in parallel
  const [summaryRes, histRes] = await Promise.allSettled([
    fetch(`${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`),
    fetch(`${BASE}/v2/pws/observations/all/1day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`),
  ])

  // Debug: dump raw WU daily summary so you can inspect the field names
  if (debug) {
    const body = summaryRes.status === 'fulfilled'
      ? await summaryRes.value.json().catch(e => ({ parseError: e.message, httpStatus: summaryRes.value.status }))
      : { fetchError: String(summaryRes.reason) }
    return new Response(JSON.stringify(body, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const log = { daily: {}, hourly: {} }

  // ── 1. Daily observations ─────────────────────────────────────────────────

  // 1a. Write WU dailysummary/7day (station-accurate; covers last 7 days)
  if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
    const json = await summaryRes.value.json()
    const rows = (json?.summaries ?? json?.observations ?? [])
      .map(s => ({
        obs_date:  (s.obsTimeLocal ?? '').slice(0, 10),
        temp_high: rnd1(s.metric?.tempHigh),
        temp_low:  rnd1(s.metric?.tempLow),
        temp_avg:  rnd1(s.metric?.tempAvg),
        humidity:  s.humidityAvg != null ? Math.round(s.humidityAvg) : s.humidity != null ? Math.round(s.humidity) : null,
        precip:    rnd1(s.metric?.precipTotal != null ? s.metric.precipTotal * RAIN_GAIN : null),
        wind_high: rnd1(s.metric?.windspeedHigh ?? s.metric?.windSpeedHigh ?? s.metric?.windGustHigh
                        ?? s.windspeedHigh ?? s.windGustHigh),
      }))
      .filter(r => r.obs_date)

    if (rows.length) {
      const r = await fetch(`${supabaseUrl}/rest/v1/observations?on_conflict=obs_date`, {
        method: 'POST', headers: sbW, body: JSON.stringify(rows),
      })
      log.daily.wuStatus = r.status
      log.daily.wuRows   = r.ok ? rows.length : 0
      if (!r.ok) log.daily.wuError = await r.text().catch(() => null)
    } else {
      log.daily.wuRows = 0
      log.daily.wuNote = 'WU returned 0 rows'
    }
  } else {
    log.daily.wuNote = summaryRes.status === 'rejected'
      ? `WU fetch error: ${summaryRes.reason}`
      : `WU HTTP ${summaryRes.value?.status}`
  }

  // 1b. Gap-fill: find any missing dates in the last 14 days and write OM archive data.
  //     Uses merge-duplicates so WU data already written above is not overwritten.
  try {
    const yesterday = daysAgo(1)
    const lookFrom  = daysAgo(14)
    const haveRes   = await fetch(
      `${supabaseUrl}/rest/v1/observations?select=obs_date&obs_date=gte.${lookFrom}&obs_date=lte.${yesterday}&order=obs_date`,
      { headers: sbR }
    )
    if (haveRes.ok) {
      const haveDates = new Set((await haveRes.json()).map(r => r.obs_date))
      const missing   = dateRange(lookFrom, yesterday).filter(d => !haveDates.has(d))
      log.daily.missing = missing

      if (missing.length) {
        const omRes = await fetch(
          `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}` +
          `&start_date=${missing[0]}&end_date=${missing[missing.length - 1]}` +
          `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,wind_speed_10m_max` +
          `&timezone=Europe%2FMadrid`
        )
        if (omRes.ok) {
          const { daily } = await omRes.json()
          const missingSet = new Set(missing)
          const omRows = daily.time
            .map((d, i) => missingSet.has(d) ? {
              obs_date:  d,
              temp_high: rnd1(daily.temperature_2m_max[i]),
              temp_low:  rnd1(daily.temperature_2m_min[i]),
              temp_avg:  rnd1(daily.temperature_2m_mean[i]),
              humidity:  null,
              precip:    rnd1(daily.precipitation_sum[i]),
              wind_high: rnd1(daily.wind_speed_10m_max[i]),
            } : null)
            .filter(Boolean)

          if (omRows.length) {
            const r = await fetch(`${supabaseUrl}/rest/v1/observations?on_conflict=obs_date`, {
              method: 'POST', headers: sbW, body: JSON.stringify(omRows),
            })
            log.daily.omStatus = r.status
            log.daily.omRows   = r.ok ? omRows.length : 0
          }
        } else {
          log.daily.omNote = `OM HTTP ${omRes.status}`
        }
      }
    }
  } catch (e) {
    log.daily.gapError = e.message
  }

  // ── 2. Hourly observations (from 5-min readings) ──────────────────────────

  // 2a. Write yesterday's WU 5-min data bucketed into hours
  let prevDate = daysAgo(1)  // fallback
  if (histRes.status === 'fulfilled' && histRes.value.ok) {
    const json   = await histRes.value.json()
    const allObs = json?.observations ?? []

    // At 2am UTC Ràfels is 3-4am local — yesterday is fully captured.
    const mostRecent = (allObs[allObs.length - 1]?.obsTimeLocal ?? '').slice(0, 10)
    if (mostRecent) {
      const d = new Date(mostRecent + 'T12:00:00Z')
      d.setUTCDate(d.getUTCDate() - 1)
      prevDate = d.toISOString().slice(0, 10)
    }

    const dayObs = allObs.filter(o => (o.obsTimeLocal ?? '').slice(0, 10) === prevDate)

    if (dayObs.length) {
      const sorted = [...dayObs].sort((a, b) =>
        (a.obsTimeLocal ?? '').localeCompare(b.obsTimeLocal ?? ''))
      sorted.forEach((o, i) => {
        const prev = i > 0 ? (sorted[i - 1].metric?.precipTotal ?? 0) : 0
        o._rainDelta = Math.max(0, (o.metric?.precipTotal ?? prev) - prev)
      })

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
        precip:    rnd1(b.rainDeltas.reduce((a, c) => a + c, 0) * RAIN_GAIN),
        wind_avg:  rnd1(avg(b.windAvgs)),
        wind_high: rnd1(b.windHighs.length ? Math.max(...b.windHighs) : null),
      }))

      if (hourlyRows.length) {
        const r = await fetch(`${supabaseUrl}/rest/v1/observations_hourly?on_conflict=obs_date,obs_hour`, {
          method: 'POST', headers: sbW, body: JSON.stringify(hourlyRows),
        })
        log.hourly.wuStatus = r.status
        log.hourly.wuRows   = r.ok ? hourlyRows.length : 0
        log.hourly.wuDate   = prevDate
      }
    } else {
      log.hourly.wuNote = `No WU 5-min readings for ${prevDate}`
    }
  } else {
    log.hourly.wuNote = histRes.status === 'rejected'
      ? `WU fetch error: ${histRes.reason}`
      : `WU HTTP ${histRes.value?.status}`
  }

  // 2b. Gap-fill: find dates missing from observations_hourly in the last 7 days
  //     and fill from OM archive hourly (approximate but prevents permanent holes).
  try {
    const yesterday    = daysAgo(1)
    const hourlyFrom   = daysAgo(7)
    const haveHRes     = await fetch(
      `${supabaseUrl}/rest/v1/observations_hourly?select=obs_date&obs_date=gte.${hourlyFrom}&obs_date=lte.${yesterday}&order=obs_date`,
      { headers: sbR }
    )
    if (haveHRes.ok) {
      const haveHDates  = new Set((await haveHRes.json()).map(r => r.obs_date))
      const missingH    = dateRange(hourlyFrom, yesterday).filter(d => !haveHDates.has(d))
      log.hourly.missing = missingH

      if (missingH.length) {
        const omHRes = await fetch(
          `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}` +
          `&start_date=${missingH[0]}&end_date=${missingH[missingH.length - 1]}` +
          `&hourly=temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m` +
          `&timezone=Europe%2FMadrid`
        )
        if (omHRes.ok) {
          const { hourly } = await omHRes.json()
          const missingHSet = new Set(missingH)
          const omHRows = []
          for (let i = 0; i < hourly.time.length; i++) {
            const date = hourly.time[i].slice(0, 10)
            if (!missingHSet.has(date)) continue
            const t = hourly.temperature_2m[i]
            omHRows.push({
              obs_date:  date,
              obs_hour:  parseInt(hourly.time[i].slice(11, 13), 10),
              temp_avg:  rnd1(t),
              temp_high: rnd1(t),
              temp_low:  rnd1(t),
              humidity:  hourly.relative_humidity_2m[i] != null
                           ? Math.round(hourly.relative_humidity_2m[i]) : null,
              precip:    rnd1(hourly.precipitation[i]),
              wind_avg:  rnd1(hourly.wind_speed_10m[i]),
              wind_high: rnd1(hourly.wind_speed_10m[i]),
            })
          }
          if (omHRows.length) {
            const r = await fetch(`${supabaseUrl}/rest/v1/observations_hourly?on_conflict=obs_date,obs_hour`, {
              method: 'POST', headers: sbW, body: JSON.stringify(omHRows),
            })
            log.hourly.omStatus = r.status
            log.hourly.omRows   = r.ok ? omHRows.length : 0
          }
        } else {
          log.hourly.omNote = `OM HTTP ${omHRes.status}`
        }
      }
    }
  } catch (e) {
    log.hourly.gapError = e.message
  }

  return new Response(JSON.stringify(log), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
