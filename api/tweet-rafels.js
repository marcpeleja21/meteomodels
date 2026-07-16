/**
 * Vercel Cron — daily 9AM tweet from @MeteoRafels
 * Posts yesterday's actuals + today's forecast in Catalan
 * Cron: 0 7 * * * (7 UTC = 9 AM CEST / 8 AM CET)
 *
 * Required env vars: TW_CONSUMER_KEY, TW_CONSUMER_SECRET,
 *                    TW_ACCESS_TOKEN, TW_ACCESS_SECRET
 */
import crypto from 'node:crypto'

const WU_KEY  = '3b28991981854cdba8991981851cdbb8'
const STATION = 'IRFALE2'
const BASE    = 'https://api.weather.com'
const LAT     = 38.73
const LON     = -0.63

const CA_DAYS   = ['dg', 'dl', 'dm', 'dc', 'dj', 'dv', 'ds']
const CA_MONTHS = ['gen', 'feb', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'des']

function pct(s) { return encodeURIComponent(String(s)) }

function oauthHeader(method, url, creds) {
  const nonce  = crypto.randomBytes(16).toString('hex')
  const ts     = Math.floor(Date.now() / 1000).toString()
  const params = {
    oauth_consumer_key:     creds.consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        ts,
    oauth_token:            creds.accessToken,
    oauth_version:          '1.0',
  }
  const sortedParams = Object.keys(params).sort()
    .map(k => `${pct(k)}=${pct(params[k])}`).join('&')
  const base = [method.toUpperCase(), pct(url), pct(sortedParams)].join('&')
  const key  = `${pct(creds.consumerSecret)}&${pct(creds.accessSecret)}`
  params.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64')
  return 'OAuth ' + Object.keys(params).sort()
    .map(k => `${pct(k)}="${pct(params[k])}"`)
    .join(', ')
}

function wmoIcon(code) {
  if (code === 0)                    return '☀️'
  if (code <= 2)                     return '⛅'
  if (code === 3)                    return '☁️'
  if (code >= 51 && code <= 67)      return '🌧️'
  if (code >= 71 && code <= 79)      return '🌨️'
  if (code >= 80 && code <= 82)      return '🌦️'
  if (code >= 95)                    return '⛈️'
  return '🌫️'
}

export default async function handler(req) {
  const creds = {
    consumerKey:    process.env.TW_CONSUMER_KEY,
    consumerSecret: process.env.TW_CONSUMER_SECRET,
    accessToken:    process.env.TW_ACCESS_TOKEN,
    accessSecret:   process.env.TW_ACCESS_SECRET,
  }
  if (!creds.consumerKey) {
    return new Response('Missing Twitter env vars', { status: 500 })
  }

  // Work in Madrid local time
  const nowLocal  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }))

  // Two cron slots cover DST (7 UTC = 9 AM CEST, 8 UTC = 9 AM CET).
  // Only the one that fires at 9 AM local should post.
  if (nowLocal.getHours() !== 9) {
    return new Response(JSON.stringify({ ok: true, skipped: true, localHour: nowLocal.getHours() }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const yesterLocal = new Date(nowLocal); yesterLocal.setDate(yesterLocal.getDate() - 1)
  const yStr = `${yesterLocal.getFullYear()}-${String(yesterLocal.getMonth()+1).padStart(2,'0')}-${String(yesterLocal.getDate()).padStart(2,'0')}`

  const [wuRes, omRes] = await Promise.allSettled([
    fetch(`${BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=Europe%2FMadrid&forecast_days=2`),
  ])

  // Yesterday's actuals from WU 7-day summary
  let yHi = null, yLo = null, yPrecip = null, yWind = null
  if (wuRes.status === 'fulfilled' && wuRes.value.ok) {
    const j    = await wuRes.value.json()
    const rows = j?.summaries ?? j?.observations ?? []
    const row  = rows.find(r => (r.obsTimeLocal ?? '').slice(0, 10) === yStr)
    if (row) {
      yHi    = Math.round(row.metric?.tempHigh ?? 0)
      yLo    = Math.round(row.metric?.tempLow  ?? 0)
      yPrecip = +(row.metric?.precipTotal ?? 0)
      yWind  = Math.round(row.metric?.windSpeedHigh ?? row.metric?.windspeedHigh ?? 0)
    }
  }

  // Today's forecast from Open-Meteo (index 0 = today)
  let tIcon = '🌤️', tHi = null, tLo = null, tPrecip = null, tRainProb = null
  if (omRes.status === 'fulfilled' && omRes.value.ok) {
    const { daily } = await omRes.value.json()
    tIcon     = wmoIcon(daily?.weather_code?.[0] ?? 0)
    tHi       = Math.round(daily?.temperature_2m_max?.[0]           ?? 0)
    tLo       = Math.round(daily?.temperature_2m_min?.[0]           ?? 0)
    tPrecip   = +(daily?.precipitation_sum?.[0]                     ?? 0)
    tRainProb = Math.round(daily?.precipitation_probability_max?.[0] ?? 0)
  }

  // Format date labels
  const yDay  = CA_DAYS[yesterLocal.getDay()]
  const yDate = `${yesterLocal.getDate()} ${CA_MONTHS[yesterLocal.getMonth()]}`
  const tDay  = CA_DAYS[nowLocal.getDay()]
  const tDate = `${nowLocal.getDate()} ${CA_MONTHS[nowLocal.getMonth()]}`

  // Build tweet
  const lines = [`🌤️ Temps a Ràfels · ${tDay} ${tDate}\n`]

  if (yHi !== null) {
    lines.push(`📅 Ahir (${yDay} ${yDate}):`)
    let l = `🌡️ Màx ${yHi}° / Mín ${yLo}°`
    if (yPrecip > 0) l += ` · 💧 ${yPrecip.toFixed(1)} mm`
    if (yWind  > 0)  l += ` · 💨 ${yWind} km/h`
    lines.push(l)
    lines.push('')
  }

  lines.push(`${tIcon} Previsió d'avui (${tDay} ${tDate}):`)
  let tl = `🌡️ Màx ${tHi}° / Mín ${tLo}°`
  if (tPrecip > 0)    tl += ` · 💧 ${tPrecip.toFixed(1)} mm`
  if (tRainProb > 10) tl += ` (${tRainProb}% pluja)`
  lines.push(tl)

  lines.push('')
  lines.push('📊 meteomodels.app/meteorafels')

  const text = lines.join('\n')

  // Post to Twitter API v2 with OAuth 1.0a
  const tweetUrl = 'https://api.twitter.com/2/tweets'
  const auth     = oauthHeader('POST', tweetUrl, creds)
  const tweetRes = await fetch(tweetUrl, {
    method:  'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text }),
  })

  if (!tweetRes.ok) {
    const err = await tweetRes.text()
    return new Response(`Twitter error ${tweetRes.status}: ${err}`, { status: 502 })
  }

  const data = await tweetRes.json()
  return new Response(JSON.stringify({ ok: true, text, id: data?.data?.id }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
