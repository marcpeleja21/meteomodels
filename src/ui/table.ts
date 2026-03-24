import { state } from '../state'
import { MODELS } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getEnsembleForecast7 } from '../utils/data'
import { wxFromCode, fmt } from '../utils/weather'

export function renderTable() {
  const t       = LANG_DATA[state.lang]
  const el      = document.getElementById('tableCard')!
  const loaded  = MODELS.filter(m => state.wxData[m.key] != null)

  if (!loaded.length) { el.innerHTML = ''; return }

  const ensDays = getEnsembleForecast7(state.wxData, t.wx)
  const today   = new Date().toISOString().slice(0, 10)

  // Build header columns (days)
  const dayHeaders = ensDays.map(d => {
    const date   = new Date(d.date + 'T12:00:00')
    const isToday = d.date === today
    const name   = isToday ? t.today : t.days[date.getDay()]
    const num    = `${date.getDate()} ${t.months[date.getMonth()]}`
    return `<th><div class="day-hdr"><span class="day-n">${name}</span><span class="day-d">${num}</span></div></th>`
  }).join('')

  // Ensemble row
  const ensRow = ensDays.map(d => {
    const rain = d.rain !== null ? `<div class="fc-rain">💦 ${Math.round(d.rain)}%</div>` : ''
    return `<td><div class="fc-cell"><div class="fc-icon">${d.cond.icon}</div><div class="fc-temp">${fmt(d.maxT, 0)}° / ${fmt(d.minT, 0)}°</div>${rain}</div></td>`
  }).join('')

  // Individual model rows
  const modelRows = loaded.map(m => {
    const data = state.wxData[m.key]!
    const cells = ensDays.map((_, i) => {
      const maxT = data.daily.temperature_2m_max[i] ?? null
      const minT = data.daily.temperature_2m_min[i] ?? null
      const code = data.daily.weathercode[i] ?? null
      const rain = data.daily.precipitation_probability_max[i] ?? null
      const wx   = wxFromCode(code, t.wx)
      const rainStr = rain !== null ? `<div class="fc-rain">💦 ${Math.round(rain)}%</div>` : ''
      return `<td><div class="fc-cell"><div class="fc-icon">${wx.icon}</div><div class="fc-temp">${fmt(maxT, 0)}° / ${fmt(minT, 0)}°</div>${rainStr}</div></td>`
    }).join('')

    return `
      <tr>
        <td><span class="model-dot" style="background:${m.color}"></span>${m.flag} ${m.name}</td>
        ${cells}
      </tr>
    `
  }).join('')

  el.innerHTML = `
    <div class="table-head-pad">
      <div class="section-title" style="margin-bottom:14px">${t.forecastTitle}</div>
    </div>
    <div class="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th style="text-align:left">${t.modelCol}</th>
            ${dayHeaders}
          </tr>
        </thead>
        <tbody>
          <tr class="ens-row">
            <td><strong>⚖ ${t.ensemble}</strong></td>
            ${ensRow}
          </tr>
          <tr class="sep-row"><td colspan="${ensDays.length + 1}"></td></tr>
          ${modelRows}
        </tbody>
      </table>
    </div>
  `
}
