/**
 * Vercel Edge Function — Weather Underground PWS proxy for Ràfels (IRFALE2)
 * ?period=day   → current obs + today's hourly history (default)
 * ?period=week  → current obs + 7-day daily summaries
 * ?period=month → current obs + 28-day daily summaries
 */
export const config = { runtime: 'edge' }

const WU_KEY  = '3b28991981854cdba8991981851cdbb8'
const STATION = 'IRFALE2'
const BASE    = 'https://api.weather.com'

export default async function handler(request) {
  const period = new URL(request.url).searchParams.get('period') ?? 'day'

  // Local date for Spain (UTC+2 summer) so hourly history lands on the right day
  const localDate = new Date(Date.now() + 2 * 60 * 60 * 1000)
    .toISOString().slice(0, 10).replace(/-/g, '')

  const histUrl = period === 'day'
    ? `${BASE}/v2/pws/observations/hourly?stationId=${STATION}&format=json&units=m&date=${localDate}&numericPrecision=decimal&apiKey=${WU_KEY}`
    : period === 'week'
    ? `${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`
    : `${BASE}/v2/pws/dailysummary/28day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`

  const [currentRes, histRes] = await Promise.allSettled([
    fetch(`${BASE}/v2/pws/observations/current?stationId=${STATION}&format=json&units=m&apiKey=${WU_KEY}`),
    fetch(histUrl),
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
    // Hourly observations — compute incremental rain from cumulative precipTotal
    const hours = (histJson?.observations ?? []).map(h => ({
      time:      h.obsTimeLocal ?? null,
      temp:      h.metric?.tempAvg      ?? null,
      humidity:  h.humidityAvg          ?? null,
      windspeed: h.metric?.windspeedAvg ?? null,
      precipCum: h.metric?.precipTotal  ?? 0,
    }))
    result.history = hours.map((h, i) => ({
      time:     h.time,
      temp:     h.temp,
      humidity: h.humidity,
      precip:   i === 0 ? h.precipCum : Math.max(0, h.precipCum - hours[i - 1].precipCum),
    }))
  } else {
    // Daily summaries (week / month) — WU returns key 'summaries'
    const rows = histJson?.summaries ?? histJson?.observations ?? []
    result.history = rows.map(s => ({
      date:       (s.obsTimeLocal ?? '').slice(0, 10),
      tempHigh:   s.metric?.tempHigh   ?? null,
      tempLow:    s.metric?.tempLow    ?? null,
      tempAvg:    s.metric?.tempAvg    ?? null,
      humidity:   s.humidityAvg        ?? null,
      precip:     s.metric?.precipTotal ?? null,
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
