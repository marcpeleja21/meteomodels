import { state } from '../state'
import { MODELS, modelValidForDay } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getEnsembleForecast7 } from '../utils/data'
import { wxFromCode, fmt } from '../utils/weather'

const TABLE_COMPACT = 4
const TABLE_FULL    = 7

export function renderTable() {
  const t       = LANG_DATA[state.lang]
  const el      = document.getElementById('tableCard')!
  const loaded  = MODELS.filter(m => state.wxData[m.key] != null)

  if (!loaded.length) { el.innerHTML = ''; return }

  const allDays  = getEnsembleForecast7(state.wxData, t.wx)
  const count    = state.tableDays              // 4 or 7
  const ensDays  = allDays.slice(0, count)
  const today    = new Date().toISOString().slice(0, 10)
  const canExpand = state.tableDays < TABLE_FULL
  const btnLabel  = canExpand
    ? `▸ +${TABLE_FULL - TABLE_COMPACT}d`
    : `◂ −${TABLE_FULL - TABLE_COMPACT}d`

  // Build header columns
  const dayHeaders = ensDays.map(d => {
    const date    = new Date(d.date + 'T12:00:00')
    const isToday = d.date === today
    const name    = isToday ? t.today : t.days[date.getDay()]
    const num     = `${date.getDate()} ${t.months[date.getMonth()]}`
    return `<th><div class="day-hdr"><span class="day-n">${name}</span><span class="day-d">${num}</span></div></th>`
  }).join('')

  // Cell builder helper
  function buildCell(
    maxT: number | null,
    minT: number | null,
    code: number | null,
    rain: number | null,
    wind: number | null,
    precipMm: number | null = null,
    validModel = true,
  ): string {
    if (!validModel) return `<td><div class="fc-cell fc-na">—</div></td>`
    const wx        = wxFromCode(code, t.wx)
    const rainStr   = rain !== null ? `<div class="fc-rain">💦 ${Math.round(rain)}%</div>` : ''
    const precipStr = precipMm !== null ? `<div class="fc-precip">🌧 ${fmt(precipMm, 1)} mm</div>` : ''
    const windStr   = wind !== null ? `<div class="fc-wind-lbl">💨 ${fmt(wind, 0)} km/h</div>` : ''
    return `<td><div class="fc-cell">
      <div class="fc-icon">${wx.icon}</div>
      <div class="fc-temp">${fmt(maxT, 0)}° / ${fmt(minT, 0)}°</div>
      ${rainStr}
      ${precipStr}
      ${windStr}
    </div></td>`
  }

  // Ensemble row (also needs avg wind and avg precipitation)
  const ensRow = ensDays.map((d, i) => {
    const validModels = MODELS.filter(m => modelValidForDay(m, i) && state.wxData[m.key] != null)
    const winds = validModels
      .map(m => state.wxData[m.key]!.daily.windspeed_10m_max[i] ?? null)
      .filter((v): v is number => v !== null)
    const precips = validModels
      .map(m => (state.wxData[m.key]!.daily as any).precipitation_sum?.[i] ?? null)
      .filter((v): v is number => v !== null)
    const avgWind   = winds.length   ? winds.reduce((a, b) => a + b, 0)   / winds.length   : null
    const avgPrecip = precips.length ? precips.reduce((a, b) => a + b, 0) / precips.length : null
    return buildCell(d.maxT, d.minT, d.code, d.rain, avgWind, avgPrecip)
  }).join('')

  // Individual model rows
  const modelRows = loaded.map(m => {
    const data = state.wxData[m.key]!
    const cells = ensDays.map((_, i) => {
      const valid = modelValidForDay(m, i)
      return buildCell(
        data.daily.temperature_2m_max[i] ?? null,
        data.daily.temperature_2m_min[i] ?? null,
        data.daily.weathercode[i] ?? null,
        data.daily.precipitation_probability_max[i] ?? null,
        data.daily.windspeed_10m_max[i] ?? null,
        (data.daily as any).precipitation_sum?.[i] ?? null,
        valid,
      )
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
      <div class="table-title-row">
        <div class="section-title">${t.forecastTitle}</div>
        <button class="tbl-expand-btn" id="tblExpandBtn">${btnLabel}</button>
      </div>
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

  document.getElementById('tblExpandBtn')?.addEventListener('click', () => {
    state.tableDays = canExpand ? TABLE_FULL : TABLE_COMPACT
    renderTable()
  })
}
