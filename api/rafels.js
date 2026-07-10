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
  // month uses Open-Meteo historical archive (free, ERA5-based); no WU hist fetch needed
  const histUrl = period === 'day'
    ? `${BASE}/v2/pws/observations/all/1day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`
    : period === 'week'
    ? `${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`
    : null

  const [currentRes, histRes] = await Promise.allSettled([
    fetch(`${BASE}/v2/pws/observations/current?stationId=${STATION}&format=json&units=m&apiKey=${WU_KEY}`),
    histUrl ? fetch(histUrl) : Promise.resolve(new Response('{}', { status: 200 })),
  ])

  const currentJson = currentRes.status === 'fulfilled' && currentRes.value.ok
    ? await currentRes.value.json() : null
  const histJson = histRes.status === 'fulfilled' && histRes.value.ok
    ? await histRes.value.json() : null

  const obs = currentJson?.observations?.[0]
  if (!obs) {
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
      const hourKey = (o.obsTimeLocal ?? '').slice(0, 13) // 'YYYY-MM-DD HH'
      if (!hourKey) continue
      if (!buckets.has(hourKey)) buckets.set(hourKey, { temps: [], humids: [], precipCum: 0 })
      const b = buckets.get(hourKey)
      if (o.metric?.tempAvg != null) b.temps.push(o.metric.tempAvg)
      if (o.humidityAvg != null) b.humids.push(o.humidityAvg)
      if (o.metric?.precipTotal != null) b.precipCum = o.metric.precipTotal // last reading wins (cumulative)
    }
    const hours = [...buckets.entries()].map(([hourKey, b]) => ({
      time:      hourKey + ':00:00',
      temp:      b.temps.length  ? b.temps.reduce((a, c) => a + c, 0) / b.temps.length   : null,
      humidity:  b.humids.length ? b.humids.reduce((a, c) => a + c, 0) / b.humids.length : null,
      precipCum: b.precipCum,
    }))
    result.history = hours.map((h, i) => ({
      time:     h.time,
      temp:     h.temp,
      humidity: h.humidity,
      precip:   i === 0 ? h.precipCum : Math.max(0, h.precipCum - hours[i - 1].precipCum),
    }))
  } else if (period === 'month') {
    // 30-day history from Open-Meteo historical archive (ERA5, free, no auth)
    const lat = obs.lat ?? 38.73
    const lon = obs.lon ?? -0.63
    const endDate = new Date(); endDate.setDate(endDate.getDate() - 1)
    const startDate = new Date(endDate); startDate.setDate(startDate.getDate() - 29)
    const fmtDate = d => d.toISOString().slice(0, 10)
    try {
      const omRes = await fetch(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&start_date=${fmtDate(startDate)}&end_date=${fmtDate(endDate)}` +
        `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean` +
        `&timezone=Europe%2FMadrid`
      )
      if (omRes.ok) {
        const { daily } = await omRes.json()
        result.history = (daily?.time ?? []).map((date, i) => ({
          date,
          tempHigh: daily.temperature_2m_max?.[i]        ?? null,
          tempLow:  daily.temperature_2m_min?.[i]        ?? null,
          tempAvg:  daily.temperature_2m_mean?.[i]       ?? null,
          humidity: daily.relative_humidity_2m_mean?.[i] ?? null,
          precip:   daily.precipitation_sum?.[i]         ?? null,
        }))
      }
    } catch (_) {}
    if (!result.history) result.history = []
  } else {
    // Week: WU 7-day daily summaries
    const rows = histJson?.summaries ?? histJson?.observations ?? []
    result.history = rows.map(s => ({
      date:     (s.obsTimeLocal ?? '').slice(0, 10),
      tempHigh: s.metric?.tempHigh    ?? null,
      tempLow:  s.metric?.tempLow     ?? null,
      tempAvg:  s.metric?.tempAvg     ?? null,
      humidity: s.humidityAvg         ?? null,
      precip:   s.metric?.precipTotal ?? null,
    }))
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
