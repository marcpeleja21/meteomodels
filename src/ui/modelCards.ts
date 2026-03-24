import { state } from '../state'
import { MODELS } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getCurrentWeather } from '../utils/data'
import { wxFromCode, fmt } from '../utils/weather'

export function renderModelCards() {
  const t   = LANG_DATA[state.lang]
  const el  = document.getElementById('modelGrid')!

  const loaded = MODELS.filter(m => state.wxData[m.key] != null)

  if (!loaded.length) {
    el.innerHTML = ''
    return
  }

  el.innerHTML = loaded.map(m => {
    const data = state.wxData[m.key]!
    const cur  = getCurrentWeather(data)
    const wx   = wxFromCode(cur.code, t.wx)

    // Rain bar (0–100%)
    const rainPct = cur.rain ?? 0
    const humPct  = cur.hum  ?? 0

    // Daily max/min from first day
    const maxT = data.daily.temperature_2m_max[0]
    const minT = data.daily.temperature_2m_min[0]

    return `
      <div class="mc2" style="--mc:${m.color}">
        <div class="mc2-head">
          <span class="mc2-flag">${m.flag}</span>
          <div>
            <div class="mc2-name" style="color:${m.color}">${m.name}</div>
            <div class="mc2-org">${m.org}</div>
          </div>
        </div>
        <div class="mc2-temp">${cur.temp !== null ? Math.round(cur.temp) : '—'}<span class="mc2-tunit">°C</span></div>
        <div class="mc2-range">${fmt(maxT, 0)}° / ${fmt(minT, 0)}°</div>
        <div class="mc2-cond">${wx.icon} <span>${wx.lbl}</span></div>

        <!-- Rain bar -->
        <div class="mc2-bar-wrap">
          <div class="mc2-bar-fill" style="width:${rainPct}%;background:var(--accent2)"></div>
        </div>
        <div class="mc2-bar-lbl"><span>🌧 ${fmt(rainPct, 0)}%</span><span>💧 ${fmt(humPct, 0)}%</span></div>

        ${m.coverage ? `<div class="mc2-note">⚠ ${m.coverage}</div>` : ''}
      </div>
    `
  }).join('')
}
