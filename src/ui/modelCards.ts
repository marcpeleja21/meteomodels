import { state } from '../state'
import { getActiveModels, modelValidForDay } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getCurrentWeather } from '../utils/data'
import { wxFromCode, inferCodeFromPrecip, fmt } from '../utils/weather'
import { tempColor, tempMaxColor, tempMinColor, rainPctColor, precipColor, windColor, humidityColor } from '../utils/colors'

export function renderModelCards() {
  const t    = LANG_DATA[state.lang]
  const el   = document.getElementById('modelGrid')!
  const dayI = state.selectedDay   // 0 = now, 1+ = day index

  const loaded = getActiveModels().filter(m => state.wxData[m.key] != null && modelValidForDay(m, dayI))
  if (!loaded.length) { el.innerHTML = ''; return }

  el.innerHTML = loaded.map(m => {
    const data = state.wxData[m.key]!

    let displayTemp: number | null
    let maxT: number | null
    let minT: number | null
    let code: number | null
    let rainPct: number
    let humPct:  number
    let precipMm: number | null
    let windKmh:  number | null
    let gustKmh:  number | null

    if (dayI === 0) {
      const cur = getCurrentWeather(data)
      displayTemp = cur.temp
      maxT        = data.daily.temperature_2m_max[0] ?? null
      minT        = data.daily.temperature_2m_min[0] ?? null
      code        = cur.code
      rainPct     = cur.rain ?? 0
      humPct      = cur.hum  ?? 0
      precipMm    = data.daily.precipitation_sum?.[0] ?? null
      windKmh     = data.daily.wind_speed_10m_max[0] ?? null
      gustKmh     = data.daily.wind_gusts_10m_max[0] ?? null
    } else {
      displayTemp = data.daily.temperature_2m_max[dayI] ?? null
      maxT        = data.daily.temperature_2m_max[dayI] ?? null
      minT        = data.daily.temperature_2m_min[dayI] ?? null
      code        = data.daily.weather_code[dayI] ?? inferCodeFromPrecip(data.daily.precipitation_sum?.[dayI] ?? null)
      rainPct     = data.daily.precipitation_probability_max[dayI] ?? 0
      humPct      = 0
      precipMm    = data.daily.precipitation_sum?.[dayI] ?? null
      windKmh     = data.daily.wind_speed_10m_max[dayI] ?? null
      gustKmh     = data.daily.wind_gusts_10m_max[dayI] ?? null
    }

    const wx = wxFromCode(code, t.wx)

    return `
      <div class="mc2" style="--mc:${m.color}">
        <div class="mc2-head">
          <span class="mc2-flag">${m.flag}</span>
          <div>
            <div class="mc2-name" style="color:${m.color}">${m.name}</div>
            <div class="mc2-org">${m.org}</div>
          </div>
        </div>
        <div class="mc2-temp" style="color:${tempColor(displayTemp)}">${displayTemp !== null ? Math.round(displayTemp) : '—'}<span class="mc2-tunit">°C</span></div>
        <div class="mc2-range">
          <span style="color:${tempMaxColor(maxT)}">↑${fmt(maxT, 0)}°</span>
          <span style="color:#555"> / </span>
          <span style="color:${tempMinColor(minT)}">↓${fmt(minT, 0)}°</span>
          ${precipMm !== null ? `<span title="${t.tipPrecip}" style="color:${precipColor(precipMm)}"> · 💦 ${fmt(precipMm, 1)} mm</span>` : ''}
        </div>
        <div class="mc2-cond">${wx.icon} <span>${wx.lbl}</span></div>
        <div class="mc2-bar-wrap">
          <div class="mc2-bar-fill" style="width:${rainPct}%;background:${rainPctColor(rainPct)}"></div>
        </div>
        <div class="mc2-bar-lbl">
          <span title="${t.tipRain}" style="color:${rainPctColor(rainPct)}">💦 ${fmt(rainPct, 0)}%</span>
          ${humPct > 0 ? `<span title="${t.tipHum}" style="color:${humidityColor(humPct)}">💧 ${fmt(humPct, 0)}%</span>` : ''}
        </div>
        ${windKmh !== null ? `
        <div class="mc2-wind">
          <span title="${t.tipWind}" style="color:${windColor(windKmh)}">💨 ${fmt(windKmh, 0)} km/h</span>
          ${gustKmh !== null ? `<span title="${t.tipGusts}" class="mc2-gust" style="color:${windColor(gustKmh)}">↑ ${fmt(gustKmh, 0)}</span>` : ''}
        </div>` : ''}
        ${m.coverage ? `<div class="mc2-note">⚠ ${m.coverage}</div>` : ''}
      </div>
    `
  }).join('')
}
