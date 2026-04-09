import { state } from '../state'
import { getActiveModels, modelValidForDay } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getEnsembleForecast7 } from '../utils/data'
import { wxFromCode, inferCodeFromPrecip, fmt } from '../utils/weather'
import { tempMaxColor, tempMinColor, rainPctColor, precipColor, windColor } from '../utils/colors'

const TABLE_COMPACT = 4
const TABLE_FULL    = 7

// ── Table renderer ────────────────────────────────────────────────────────────

export function renderTable() {
  const t       = LANG_DATA[state.lang]
  const el      = document.getElementById('tableCard')!
  const loaded  = getActiveModels().filter(m => state.wxData[m.key] != null)

  if (!loaded.length) { el.innerHTML = ''; return }

  const allDays  = getEnsembleForecast7(state.wxData, t.wx)
  const count    = state.tableDays
  const ensDays  = allDays.slice(0, count)
  const today    = new Date().toISOString().slice(0, 10)
  const canExpand = state.tableDays < TABLE_FULL
  const btnLabel  = canExpand
    ? `▸ +${TABLE_FULL - TABLE_COMPACT}d`
    : `◂ −${TABLE_FULL - TABLE_COMPACT}d`

  // ── Header ──────────────────────────────────────────────────────────────────
  const dayHeaders = ensDays.map(d => {
    const date    = new Date(d.date + 'T12:00:00')
    const isToday = d.date === today
    const name    = isToday ? t.today : t.days[date.getDay()]
    const num     = `${date.getDate()} ${t.months[date.getMonth()]}`
    return `<th><div class="day-hdr"><span class="day-n">${name}</span><span class="day-d">${num}</span></div></th>`
  }).join('')

  // ── Cell builder ────────────────────────────────────────────────────────────
  function buildCell(
    maxT: number | null,
    minT: number | null,
    code: number | null,
    rain: number | null,
    wind: number | null,
    precipMm: number | null = null,
    validModel = true,
    isEns = false,
  ): string {
    if (!validModel) return `<td><div class="fc-cell fc-na">—</div></td>`

    const wx = wxFromCode(code, t.wx)

    const maxStr  = maxT !== null
      ? `<span class="fc-tmax" style="color:${tempMaxColor(maxT)}">${fmt(maxT, 0)}°</span>`
      : '<span class="fc-tmax" style="color:#555">—</span>'
    const minStr  = minT !== null
      ? `<span class="fc-tmin" style="color:${tempMinColor(minT)}">${fmt(minT, 0)}°</span>`
      : '<span class="fc-tmin" style="color:#555">—</span>'

    const rainStr = rain !== null
      ? `<div class="fc-rain" title="${t.tipRain}" style="color:${rainPctColor(rain)}">💦 ${Math.round(rain)}%</div>`
      : ''

    const precipStr = precipMm !== null
      ? `<div class="fc-precip" title="${t.tipPrecip}" style="color:${precipColor(precipMm)}">🌧 ${fmt(precipMm, 1)} mm</div>`
      : ''

    const windStr = wind !== null
      ? `<div class="fc-wind-lbl" title="${t.tipWind}" style="color:${windColor(wind)}">💨 ${fmt(wind, 0)} km/h</div>`
      : ''

    const sizeClass = isEns ? ' fc-cell--ens' : ''

    return `<td><div class="fc-cell${sizeClass}">
      <div class="fc-icon">${wx.icon}</div>
      <div class="fc-temp">${maxStr} <span class="fc-sep">/</span> ${minStr}</div>
      ${rainStr}
      ${precipStr}
      ${windStr}
    </div></td>`
  }

  // ── Ensemble row ─────────────────────────────────────────────────────────────
  const ensRow = ensDays.map((d, i) => {
    const validModels = getActiveModels().filter(m => modelValidForDay(m, i) && state.wxData[m.key] != null)
    const winds = validModels
      .map(m => state.wxData[m.key]!.daily.wind_speed_10m_max[i] ?? null)
      .filter((v): v is number => v !== null)
    const precips = validModels
      .map(m => state.wxData[m.key]!.daily.precipitation_sum?.[i] ?? null)
      .filter((v): v is number => v !== null)
    const avgWind   = winds.length   ? winds.reduce((a, b) => a + b, 0)   / winds.length   : null
    const avgPrecip = precips.length ? precips.reduce((a, b) => a + b, 0) / precips.length : null
    return buildCell(d.maxT, d.minT, d.code, d.rain, avgWind, avgPrecip, true, true)
  }).join('')

  // ── Individual model rows ────────────────────────────────────────────────────
  const modelRows = loaded.map(m => {
    const data = state.wxData[m.key]!
    const cells = ensDays.map((_, i) => {
      const valid = modelValidForDay(m, i)
      return buildCell(
        data.daily.temperature_2m_max[i] ?? null,
        data.daily.temperature_2m_min[i] ?? null,
        data.daily.weather_code[i] ?? inferCodeFromPrecip(data.daily.precipitation_sum?.[i] ?? null),
        data.daily.precipitation_probability_max[i] ?? null,
        data.daily.wind_speed_10m_max[i] ?? null,
        data.daily.precipitation_sum?.[i] ?? null,
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
            <td class="ens-label"><strong>⚖ ${t.ensemble}</strong></td>
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
