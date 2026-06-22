/**
 * Vercel Edge Function — Weather Underground PWS proxy for Ràfels
 * Hardcodes station IRFALE2 and returns current obs + today's hourly history.
 * API key stays server-side — never exposed to the browser.
 */
export const config = { runtime: 'edge' }

const WU_KEY  = '3b28991981854cdba8991981851cdbb8'
const STATION = 'IRFALE2'

export default async function handler() {
  // Use local date for Spain (UTC+2 summer). Add 2h buffer so we stay on the
  // right date even when called near midnight UTC.
  const localDate = new Date(Date.now() + 2 * 60 * 60 * 1000)
    .toISOString().slice(0, 10).replace(/-/g, '')

  const [currentRes, histRes] = await Promise.allSettled([
    fetch(
      `https://api.weather.com/v2/pws/observations/current` +
      `?stationId=${STATION}&format=json&units=m&apiKey=${WU_KEY}`
    ),
    fetch(
      `https://api.weather.com/v2/pws/observations/hourly` +
      `?stationId=${STATION}&format=json&units=m&date=${localDate}` +
      `&numericPrecision=decimal&apiKey=${WU_KEY}`
    ),
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
    history: (histJson?.observations ?? []).map(h => ({
      time:      h.obsTimeLocal ?? null,
      temp:      h.metric?.tempAvg    ?? null,
      humidity:  h.humidityAvg        ?? null,
      windspeed: h.metric?.windspeedAvg ?? null,
      precip:    h.metric?.precipTotal  ?? null,
    })),
  }

  return new Response(JSON.stringify(result), {
    headers: {
      'Content-Type':                'application/json',
      'Cache-Control':               'public, max-age=120, s-maxage=120',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
