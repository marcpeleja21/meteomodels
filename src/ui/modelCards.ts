import { state } from '../state'
import { MODELS } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getCurrentWeather } from '../utils/data'
import { wxFromCode, fmt } from '../utils/weather'

export function renderModelCards() {
  const t    = LANG_DATA[state.lang]
  const el   = document.getElementById('modelGrid')!
  const dayI = state.selectedDay   // 0 = now, 1+ = day index

  const loaded = MODELS.filter(m => state.wxData[m.key] != null)
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

    if (dayI === 0) {
      const cur = getCurrentWeather(data)
      displayTemp = cur.temp
      maxT        = data.daily.temperature_2m_max[0] ?? null
      minT        = data.daily.temperature_2m_min[0] ?? null
      code        = cur.code
      rainPct     = cur.rain ?? 0
      humPct      = cur.hum  ?? 0
      precipMm    = (data.daily as any).precipitation_sum?.[0] ?? null
    } else {
      displayTemp = data.daily.temperature_2m_max[dayI] ?? null
      maxT        = data.daily.temperature_2m_max[dayI] ?? null
      minT        = data.daily.temperature_2m_min[dayI] ?? null
      code        = data.daily.weathercode[dayI] ?? null
      rainPct     = data.daily.precipitation_probability_max[dayI] ?? 0
      humPct      = 0
      precipMm    = (data.daily as any).precipitation_sum?.[dayI] ?? null
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
        <div class="mc2-temp">${displayTemp !== null ? Math.round(displayTemp) : '—'}<span class="mc2-tunit">°C</span></div>
        <div class="mc2-range">
          ↑${fmt(maxT, 0)}° / ↓${fmt(minT, 0)}°
          ${precipMm !== null ? `<span style="color:var(--accent2)"> · 💦 ${fmt(precipMm, 1)} mm</span>` : ''}
        </div>
        <div class="mc2-cond">${wx.icon} <span>${wx.lbl}</span></div>
        <div class="mc2-bar-wrap">
          <div class="mc2-bar-fill" style="width:${rainPct}%;background:var(--accent2)"></div>
        </div>
        <div class="mc2-bar-lbl">
          <span>💦 ${fmt(rainPct, 0)}%</span>
          ${humPct > 0 ? `<span>💧 ${fmt(humPct, 0)}%</span>` : ''}
        </div>
        ${m.coverage ? `<div class="mc2-note">⚠ ${m.coverage}</div>` : ''}
      </div>
    `
  }).join('')
}
