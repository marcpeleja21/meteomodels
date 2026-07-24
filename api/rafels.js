/**
 * Vercel Edge Function — Weather Underground PWS proxy for Ràfels (IRFALE2)
 * ?period=day   → current obs + today's hourly history (default)
 * ?period=week  → current obs + 7-day daily summaries
 * ?period=month → current obs + 30-day daily summaries (Open-Meteo ERA5)
 */
export const config = { runtime: 'edge' }

const WU_KEY  = '3b28991981854cdba8991981851cdbb8'
const STATION = 'IRFALE2'
const BASE    = 'https://api.weather.com'

export default async function handler(request) {
  const period = new URL(request.url).searchParams.get('period') ?? 'day'

  // Note: observations/hourly?date=... is blocked by WU's CDN (Akamai 403),
  // so 'day' uses all/1day (5-min readings, last 24h) and is bucketed by hour below.
  // week and month use Open-Meteo historical archive (free, ERA5-based); no WU hist fetch needed
  const histUrl = period === 'day'
    ? `${BASE}/v2/pws/observations/all/1day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`
    : null

  const [currentRes, histRes] = await Promise.allSettled([
    fetch(`${BASE}/v2/pws/observations/current?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`),
    histUrl ? fetch(histUrl) : Promise.resolve(new Response('{}', { status: 200 })),
  ])

  const currentJson = currentRes.status === 'fulfilled' && currentRes.value.ok
    ? await currentRes.value.json().catch(() => null) : null
  const histJson = histRes.status === 'fulfilled' && histRes.value.ok
    ? await histRes.value.json().catch(() => null) : null

  const obs = currentJson?.observations?.[0]

  // ── Supabase helpers (used for fallbacks throughout) ──────────────────────
  const sbUrl = process.env.SUPABASE_URL
  const sbKey = process.env.SUPABASE_KEY
  const sbH   = sbUrl && sbKey ? { apikey: sbKey, Authorization: `Bearer ${sbKey}` } : null
  const sbGet = async q => {
    if (!sbH) return []
    const r = await fetch(`${sbUrl}/rest/v1/${q}`, { headers: sbH }).catch(() => null)
    return r?.ok ? (await r.json().catch(() => [])) : []
  }

  // When WU current obs is unavailable try Supabase as fallback
  if (!obs) {
    if (period === 'day') {
      const today = new Date().toISOString().slice(0, 10)
      const yday  = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      let rows = await sbGet(`observations_hourly?obs_date=eq.${today}&select=obs_date,obs_hour,temp_avg,temp_high,temp_low,humidity,precip,wind_avg&order=obs_hour`)
      if (!rows.length) rows = await sbGet(`observations_hourly?obs_date=eq.${yday}&select=obs_date,obs_hour,temp_avg,temp_high,temp_low,humidity,precip,wind_avg&order=obs_hour`)
      if (rows.length) {
        const last = rows[rows.length - 1]
        const tempHighs = rows.map(h => h.temp_high).filter(v => v != null)
        const tempLows  = rows.map(h => h.temp_low).filter(v => v != null)
        return new Response(JSON.stringify({
          stationId: STATION, period,
          obsTimeUtc:     null,
          temp:           last.temp_avg    ?? null,
          feelsLike:      null,
          dewpt:          null,
          humidity:       last.humidity    ?? null,
          windspeed:      last.wind_avg    ?? null,
          windGust:       null,
          windDir:        null,
          pressure:       null,
          precipRate:     null,
          precipTotal:    null,
          uv:             null,
          solarRadiation: null,
          tempHighToday:  tempHighs.length ? Math.max(...tempHighs) : null,
          tempLowToday:   tempLows.length  ? Math.min(...tempLows)  : null,
          history: rows.map(h => ({
            time:     `${h.obs_date} ${String(h.obs_hour).padStart(2, '0')}:00:00`,
            temp:     h.temp_avg  ?? null,
            humidity: h.humidity  ?? null,
            precip:   h.precip    ?? 0,
            wind:     h.wind_avg  ?? null,
          })),
          source: 'supabase',
        }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
      }
    }
    return new Response(JSON.stringify({ error: 'No data from station ' + STATION }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const result = {
    stationId:      STATION,
    period,
    obsTimeUtc:     obs.obsTimeUtc,
    temp:           obs.metric?.temp          ?? null,
    feelsLike:      obs.metric?.heatIndex     ?? obs.metric?.windChill ?? null,
    dewpt:          obs.metric?.dewpt         ?? null,
    humidity:       obs.humidity              ?? null,
    windspeed:      obs.metric?.windSpeed     ?? null,
    windGust:       obs.metric?.windGust      ?? null,
    windDir:        obs.winddir               ?? null,
    pressure:       obs.metric?.pressure      ?? null,
    precipRate:     obs.metric?.precipRate    ?? null,
    precipTotal:    obs.metric?.precipTotal   ?? null,
    uv:             obs.uv                    ?? null,
    solarRadiation: obs.solarRadiation        ?? null,
  }

  if (period === 'day') {
    // all/1day gives 5-min readings for the last 24h — keep only today's calendar
    // date (station-local), then bucket into hourly averages
    const allObs = histJson?.observations ?? []
    const todayDate = (allObs[allObs.length - 1]?.obsTimeLocal ?? obs.obsTimeLocal ?? '').slice(0, 10)
    const todayObs = todayDate ? allObs.filter(o => (o.obsTimeLocal ?? '').slice(0, 10) === todayDate) : allObs

    const tempHighs = todayObs.map(o => o.metric?.tempHigh).filter(v => v != null)
    const tempLows  = todayObs.map(o => o.metric?.tempLow).filter(v => v != null)
    result.tempHighToday = tempHighs.length ? Math.max(...tempHighs) : null
    result.tempLowToday  = tempLows.length  ? Math.min(...tempLows)  : null

    const buckets = new Map()
    for (const o of todayObs) {
      const tStr = o.obsTimeLocal ?? ''
      if (!tStr) continue
      const min = parseInt(tStr.slice(14, 16) || '0', 10)
      const slotKey = tStr.slice(0, 13) + ':' + String(Math.floor(min / 15) * 15).padStart(2, '0') // 'YYYY-MM-DD HH:MM'
      if (!buckets.has(slotKey)) buckets.set(slotKey, { temps: [], humids: [], precipCum: 0, winds: [] })
      const b = buckets.get(slotKey)
      if (o.metric?.tempAvg != null) b.temps.push(o.metric.tempAvg)
      if (o.humidityAvg != null) b.humids.push(o.humidityAvg)
      if (o.metric?.precipTotal != null) b.precipCum = o.metric.precipTotal // last reading wins (cumulative)
      const ws = o.metric?.windSpeedAvg ?? o.metric?.windspeedAvg ?? o.metric?.windSpeed ?? o.metric?.windspeed
      if (ws != null) b.winds.push(ws)
    }
    const slots = [...buckets.entries()].map(([slotKey, b]) => ({
      time:      slotKey + ':00',
      temp:      b.temps.length  ? b.temps.reduce((a, c) => a + c, 0) / b.temps.length   : null,
      humidity:  b.humids.length ? b.humids.reduce((a, c) => a + c, 0) / b.humids.length : null,
      precipCum: b.precipCum,
      wind:      b.winds.length  ? b.winds.reduce((a, c) => a + c, 0) / b.winds.length   : null,
    }))
    result.history = slots.map((h, i) => ({
      time:     h.time,
      temp:     h.temp,
      humidity: h.humidity,
      precip:   i === 0 ? h.precipCum : Math.max(0, h.precipCum - slots[i - 1].precipCum),
      wind:     h.wind,
    }))

    // WU history was empty — fall back to Supabase hourly readings
    if (!result.history.length) {
      const sbToday = todayDate || new Date().toISOString().slice(0, 10)
      const sbYday  = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      let sbRows = await sbGet(`observations_hourly?obs_date=eq.${sbToday}&select=obs_date,obs_hour,temp_avg,temp_high,temp_low,humidity,precip,wind_avg&order=obs_hour`)
      if (!sbRows.length) sbRows = await sbGet(`observations_hourly?obs_date=eq.${sbYday}&select=obs_date,obs_hour,temp_avg,temp_high,temp_low,humidity,precip,wind_avg&order=obs_hour`)
      if (sbRows.length) {
        const sbTemps = sbRows.map(h => h.temp_high).filter(v => v != null)
        const sbLows  = sbRows.map(h => h.temp_low).filter(v => v != null)
        result.tempHighToday = sbTemps.length ? Math.max(...sbTemps) : result.tempHighToday
        result.tempLowToday  = sbLows.length  ? Math.min(...sbLows)  : result.tempLowToday
        result.history = sbRows.map(h => ({
          time:     `${h.obs_date} ${String(h.obs_hour).padStart(2, '0')}:00:00`,
          temp:     h.temp_avg  ?? null,
          humidity: h.humidity  ?? null,
          precip:   h.precip    ?? 0,
          wind:     h.wind_avg  ?? null,
        }))
        result.source = 'supabase'
      }
    }
  } else if (period === 'month') {
    // 30-day history: ERA5 baseline → Supabase station overlay → WU 7-day overlay (freshest)
    const lat = obs.lat ?? 38.73
    const lon = obs.lon ?? -0.63
    const endDate = new Date(); endDate.setDate(endDate.getDate() - 1)
    const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - 29)
    const fmtDate = d => d.toISOString().slice(0, 10)
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_KEY
    try {
      const [omRes, sbRes, wuRes] = await Promise.allSettled([
        fetch(
          `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
          `&start_date=${fmtDate(startDate)}&end_date=${fmtDate(endDate)}` +
          `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max` +
          `&timezone=Europe%2FMadrid`
        ),
        supabaseUrl && supabaseKey
          ? fetch(
              `${supabaseUrl}/rest/v1/observations?obs_date=gte.${fmtDate(startDate)}&obs_date=lte.${fmtDate(endDate)}&select=obs_date,temp_high,temp_low,temp_avg,humidity,precip,wind_high&order=obs_date.asc`,
              { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
            )
          : Promise.resolve(new Response('[]', { status: 200 })),
        fetch(`${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`),
      ])

      let history = []

      // 1. ERA5 baseline
      if (omRes.status === 'fulfilled' && omRes.value.ok) {
        const { daily } = await omRes.value.json()
        history = (daily?.time ?? []).map((date, i) => ({
          date,
          tempHigh: daily.temperature_2m_max?.[i]        ?? null,
          tempLow:  daily.temperature_2m_min?.[i]        ?? null,
          tempAvg:  daily.temperature_2m_mean?.[i]       ?? null,
          humidity: daily.relative_humidity_2m_mean?.[i] ?? null,
          precip:   daily.precipitation_sum?.[i]         ?? null,
          windHigh: daily.wind_speed_10m_max?.[i]        ?? null,
        }))
      }

      // 2. Supabase overlay — actual station readings for all stored dates
      if (sbRes.status === 'fulfilled' && sbRes.value.ok) {
        const sbRows = await sbRes.value.json()
        const sbByDate = {}
        for (const r of (Array.isArray(sbRows) ? sbRows : [])) {
          if (r.obs_date) sbByDate[r.obs_date] = {
            tempHigh: r.temp_high ?? null,
            tempLow:  r.temp_low  ?? null,
            tempAvg:  r.temp_avg  ?? null,
            humidity: r.humidity  ?? null,
            precip:   r.precip    ?? null,
            windHigh: r.wind_high ?? null,
          }
        }
        history = history.map(h => sbByDate[h.date] ? { date: h.date, ...sbByDate[h.date] } : h)
      }

      // 3. WU 7-day overlay — freshest station data takes priority
      if (wuRes.status === 'fulfilled' && wuRes.value.ok) {
        const wuJson = await wuRes.value.json()
        const rows = wuJson?.summaries ?? wuJson?.observations ?? []
        const wuByDate = {}
        for (const s of rows) {
          const date = (s.obsTimeLocal ?? '').slice(0, 10)
          if (date) wuByDate[date] = {
            tempHigh: s.metric?.tempHigh                             ?? null,
            tempLow:  s.metric?.tempLow                             ?? null,
            tempAvg:  s.metric?.tempAvg                             ?? null,
            humidity: s.humidityAvg                                 ?? null,
            precip:   s.metric?.precipTotal                         ?? null,
            windHigh: s.metric?.windSpeedHigh ?? s.metric?.windspeedHigh ?? null,
          }
        }
        history = history.map(h => wuByDate[h.date] ? { date: h.date, ...wuByDate[h.date] } : h)
      }

      result.history = history
    } catch (_) {}
    if (!result.history) result.history = []
  } else {
    // Week: PWS observations_hourly → 3h buckets; OM fills dates not yet archived
    const lat = obs.lat ?? 38.73
    const lon = obs.lon ?? -0.63
    const endDate = new Date(); endDate.setDate(endDate.getDate() - 1)
    const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - 6)
    const fmtDate = d => d.toISOString().slice(0, 10)
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_KEY
    try {
      const [omRes, sbHourlyRes, wuRes] = await Promise.allSettled([
        // OM: fallback for any date not yet in observations_hourly
        fetch(
          `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
          `&start_date=${fmtDate(startDate)}&end_date=${fmtDate(endDate)}` +
          `&hourly=temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m` +
          `&timezone=Europe%2FMadrid`
        ),
        // PWS hourly data (primary source)
        supabaseUrl && supabaseKey
          ? fetch(
              `${supabaseUrl}/rest/v1/observations_hourly?obs_date=gte.${fmtDate(startDate)}&obs_date=lte.${fmtDate(endDate)}&select=obs_date,obs_hour,temp_avg,temp_high,temp_low,humidity,precip,wind_high&order=obs_date.asc,obs_hour.asc`,
              { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
            )
          : Promise.resolve(new Response('[]', { status: 200 })),
        // WU daily summary: humidity fallback for dates where hourly humidity is null
        fetch(`${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`),
      ])

      const slots = new Map()
      const coveredDates = new Set()

      // Primary: PWS observations_hourly
      if (sbHourlyRes.status === 'fulfilled' && sbHourlyRes.value.ok) {
        const hourlyRows = await sbHourlyRes.value.json()
        for (const r of (Array.isArray(hourlyRows) ? hourlyRows : [])) {
          const date     = r.obs_date
          const slotHour = Math.floor(r.obs_hour / 3) * 3
          const key      = date + '|' + slotHour
          if (!slots.has(key)) slots.set(key, { date, slot: slotHour, tempsAvg: [], tempsHi: [], tempsLo: [], precips: [], winds: [], humids: [] })
          const b = slots.get(key)
          if (r.temp_avg  != null) b.tempsAvg.push(+r.temp_avg)
          if (r.temp_high != null) b.tempsHi.push(+r.temp_high)
          if (r.temp_low  != null) b.tempsLo.push(+r.temp_low)
          if (r.humidity  != null) b.humids.push(+r.humidity)
          if (r.precip    != null) b.precips.push(+r.precip)
          if (r.wind_high != null) b.winds.push(+r.wind_high)
          coveredDates.add(date)
        }
      }

      // Fallback: OM for dates not in observations_hourly
      if (omRes.status === 'fulfilled' && omRes.value.ok) {
        const { hourly } = await omRes.value.json()
        for (let i = 0; i < hourly.time.length; i++) {
          const dt       = hourly.time[i]
          const date     = dt.slice(0, 10)
          if (coveredDates.has(date)) continue
          const hour     = parseInt(dt.slice(11, 13), 10)
          const slotHour = Math.floor(hour / 3) * 3
          const key      = date + '|' + slotHour
          if (!slots.has(key)) slots.set(key, { date, slot: slotHour, tempsAvg: [], tempsHi: [], tempsLo: [], precips: [], winds: [], humids: [] })
          const b = slots.get(key)
          const t = hourly.temperature_2m[i];       if (t != null) { b.tempsAvg.push(t); b.tempsHi.push(t); b.tempsLo.push(t) }
          const p = hourly.precipitation[i];        if (p != null) b.precips.push(p)
          const w = hourly.wind_speed_10m[i];       if (w != null) b.winds.push(w)
          const h = hourly.relative_humidity_2m[i]; if (h != null) b.humids.push(h)
        }
      }

      // WU daily humidity: fill nulls in slots where obs_hourly humidity is missing
      const dailyHumidity = {}
      if (wuRes.status === 'fulfilled' && wuRes.value.ok) {
        const wuJson = await wuRes.value.json()
        for (const s of (wuJson?.summaries ?? wuJson?.observations ?? [])) {
          const date = (s.obsTimeLocal ?? '').slice(0, 10)
          if (date && s.humidityAvg != null) dailyHumidity[date] = s.humidityAvg
        }
      }

      result.history = [...slots.values()].map(b => {
        const avg = arr => arr.length ? arr.reduce((a, c) => a + c, 0) / arr.length : null
        return {
          date:     b.date,
          slot:     b.slot,
          tempHigh: b.tempsHi.length  ? Math.max(...b.tempsHi)  : null,
          tempLow:  b.tempsLo.length  ? Math.min(...b.tempsLo)  : null,
          tempAvg:  avg(b.tempsAvg),
          precip:   b.precips.length  ? b.precips.reduce((a, c) => a + c, 0) : null,
          windHigh: b.winds.length    ? Math.max(...b.winds)    : null,
          humidity: avg(b.humids) ?? dailyHumidity[b.date] ?? null,
        }
      })
    } catch (_) {}
    if (!result.history) result.history = []
  }

  const ttl = period === 'day' ? 120 : 3600
  return new Response(JSON.stringify(result), {
    headers: {
      'Content-Type':                'application/json',
      'Cache-Control':               `public, max-age=${ttl}, s-maxage=${ttl}`,
      'Access-Control-Allow-Origin': '*',
    },
  })
}
