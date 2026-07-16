/**
 * Vercel Cron — daily 9AM tweet from @MeteoRafels
 * Posts yesterday's actuals + today's blended multi-model forecast in Catalan.
 * Dual cron slots cover DST: 0 7 * * * (CEST) + 0 8 * * * (CET).
 * Handler skips if Madrid local hour ≠ 9, unless ?force=1.
 *
 * Env vars: TW_CONSUMER_KEY, TW_CONSUMER_SECRET, TW_ACCESS_TOKEN, TW_ACCESS_SECRET
 */
import crypto from 'node:crypto'

const WU_KEY  = '3b28991981854cdba8991981851cdbb8'
const STATION = 'IRFALE2'
const WU_BASE = 'https://api.weather.com'
const LAT     = '38.73'
const LON     = '-0.63'
const TZ      = 'Europe/Madrid'
const DAILY   = 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_speed_10m_max'

const MODELS = [
  { id: 'ecmwf_ifs025',               days: 7 },
  { id: 'icon_eu',                     days: 7 },
  { id: 'meteofrance_arpege_europe',   days: 7 },
  { id: 'ukmo_seamless',               days: 7 },
  { id: 'gfs_seamless',                days: 7 },
  { id: 'gem_seamless',                days: 7 },
  { id: 'meteofrance_arome_france_hd', days: 2 },
  { id: 'meteofrance_arome_france',    days: 2 },
  { id: 'knmi_harmonie_arome_europe',  days: 2 },
  { id: 'dmi_harmonie_arome_europe',   days: 2 },
]

const CA_DAYS   = ['dg', 'dl', 'dm', 'dc', 'dj', 'dv', 'ds']
const CA_MONTHS = ['gen', 'feb', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'des']

function fcAvg(vals) {
  const v = vals.filter(x => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

function fcModal(vals) {
  const v = vals.filter(x => x != null)
  if (!v.length) return null
  const f = {}
  for (const x of v) f[x] = (f[x] ?? 0) + 1
  return +Object.entries(f).sort((a, b) => b[1] - a[1])[0][0]
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

export default async function handler(req, res) {
  const creds = {
    consumerKey:    process.env.TW_CONSUMER_KEY,
    consumerSecret: process.env.TW_CONSUMER_SECRET,
    accessToken:    process.env.TW_ACCESS_TOKEN,
    accessSecret:   process.env.TW_ACCESS_SECRET,
  }
  if (!creds.consumerKey) {
    return res.status(500).json({ error: 'Missing Twitter env vars' })
  }

  const force    = (req.url ?? '').includes('force=1')
  const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))

  if (!force && nowLocal.getHours() !== 9) {
    return res.status(200).json({ ok: true, skipped: true, localHour: nowLocal.getHours() })
  }

  const yesterLocal = new Date(nowLocal)
  yesterLocal.setDate(yesterLocal.getDate() - 1)
  const yStr = `${yesterLocal.getFullYear()}-${String(yesterLocal.getMonth()+1).padStart(2,'0')}-${String(yesterLocal.getDate()).padStart(2,'0')}`

  const makeOmUrl = (id, days) => {
    const p = new URLSearchParams({ latitude: LAT, longitude: LON, daily: DAILY, models: id, forecast_days: String(days), timezone: TZ })
    return `https://api.open-meteo.com/v1/forecast?${p}`
  }

  const [wuSettled, ...omSettled] = await Promise.allSettled([
    fetch(`${WU_BASE}/v2/pws/dailysummary/7day?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&apiKey=${WU_KEY}`),
    ...MODELS.map(({ id, days }) => fetch(makeOmUrl(id, days)).then(r => r.ok ? r.json() : null).catch(() => null)),
  ])

  // Yesterday's actuals from WU station
  let yHi = null, yLo = null, yPrecip = null, yWind = null
  if (wuSettled.status === 'fulfilled' && wuSettled.value.ok) {
    const j    = await wuSettled.value.json()
    const rows = j?.summaries ?? j?.observations ?? []
    const row  = rows.find(r => (r.obsTimeLocal ?? '').slice(0, 10) === yStr)
    if (row) {
      yHi    = Math.round(row.metric?.tempHigh ?? 0)
      yLo    = Math.round(row.metric?.tempLow  ?? 0)
      yPrecip = +(row.metric?.precipTotal ?? 0)
      yWind  = Math.round(row.metric?.windSpeedHigh ?? row.metric?.windspeedHigh ?? 0)
    }
  }

  // Today's blended forecast — same 10-model average as meteorafels.html
  const valid = omSettled
    .map((r, i) => ({ maxDays: MODELS[i].days, daily: r.status === 'fulfilled' ? r.value?.daily : null }))
    .filter(x => x.daily?.time?.length)

  let tIcon = '🌤️', tHi = null, tLo = null, tPrecip = null, tRainProb = null
  if (valid.length) {
    const sources = valid.filter(x => 0 < x.maxDays).map(x => x.daily)
    const code    = fcModal(sources.map(d => d.weather_code?.[0]               ?? null))
    tIcon     = wmoIcon(code)
    tHi       = Math.round(fcAvg(sources.map(d => d.temperature_2m_max?.[0]           ?? null)) ?? 0)
    tLo       = Math.round(fcAvg(sources.map(d => d.temperature_2m_min?.[0]           ?? null)) ?? 0)
    tPrecip   = +(fcAvg(sources.map(d => d.precipitation_sum?.[0]                     ?? null)) ?? 0)
    tRainProb = Math.round(fcAvg(sources.map(d => d.precipitation_probability_max?.[0] ?? null)) ?? 0)
  }

  const yDay  = CA_DAYS[yesterLocal.getDay()]
  const yDate = `${yesterLocal.getDate()} ${CA_MONTHS[yesterLocal.getMonth()]}`
  const tDay  = CA_DAYS[nowLocal.getDay()]
  const tDate = `${nowLocal.getDate()} ${CA_MONTHS[nowLocal.getMonth()]}`

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

  const tweetUrl = 'https://api.twitter.com/2/tweets'
  const auth     = oauthHeader('POST', tweetUrl, creds)
  const tweetRes = await fetch(tweetUrl, {
    method:  'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text }),
  })

  if (!tweetRes.ok) {
    const err = await tweetRes.text()
    return res.status(502).json({ error: `Twitter ${tweetRes.status}`, detail: err })
  }

  const data = await tweetRes.json()
  return res.status(200).json({ ok: true, text, id: data?.data?.id })
}
