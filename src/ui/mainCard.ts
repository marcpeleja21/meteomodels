import type { LangData, OpenMeteoResponse } from '../types'
import { state } from '../state'
import { MODELS, modelValidForDay } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getCurrentWeather, getEnsembleCurrent, getCurrentAqi, getEnsembleForecast } from '../utils/data'
import { wxFromCode, aqiInfo, fmt, avg } from '../utils/weather'

export function renderMainCard() {
  const t  = LANG_DATA[state.lang]
  const el = document.getElementById('mainCardTop')!

  if (state.selectedDay > 0) {
    renderDayView(el, t, state.selectedDay)
    return
  }

  if (state.activeModel === 'ensemble') {
    renderEnsemble(el, t)
  } else {
    renderSingleModel(el, t)
  }
}

// ── Current (ensemble) ─────────────────────────────────────────────────────────
function renderEnsemble(el: HTMLElement, t: LangData) {
  const { data: cur, n } = getEnsembleCurrent(state.wxData)
  const wx    = wxFromCode(cur.code, t.wx)
  const aqi   = getCurrentAqi(state.aqiData)
  const aqiI  = aqiInfo(aqi, t.aqi)
  const aqiBadge = aqiI
    ? `<span class="aqi-badge ${aqiI.cls}" style="background:rgba(0,0,0,0.3)">${aqiI.lbl}${aqi !== null ? ` (${Math.round(aqi)})` : ''}</span>`
    : ''

  // Avg precipitation today
  const models = Object.values(state.wxData).filter((d): d is OpenMeteoResponse => d !== null)
  const precipVals = models.map(m => (m.daily as any).precipitation_sum?.[0] ?? null).filter((v): v is number => v !== null)
  const avgPrecip = precipVals.length ? avg(precipVals) : null

  el.innerHTML = `
    <div class="mc-left">
      <div class="mc-big-icon">${wx.icon}</div>
      <div class="mc-temp-block">
        <div class="mc-label">${t.ensLabel(n)}</div>
        <div class="mc-temp">${cur.temp !== null ? Math.round(cur.temp) : '—'}<span class="mc-unit">°C</span></div>
        <div class="mc-condition">${wx.lbl}</div>
        <div class="mc-feels">${t.statFeels}: ${cur.feels !== null ? Math.round(cur.feels) + '°C' : '—'}</div>
      </div>
    </div>
    <div class="mc-right">
      <div class="stat"><span class="stat-icon">💦</span><span class="stat-lbl">${t.statRain}</span><span class="stat-val">${fmt(cur.rain, 0)}%</span></div>
      ${avgPrecip !== null ? `<div class="stat"><span class="stat-icon">🌧️</span><span class="stat-lbl">${t.statPrecip}</span><span class="stat-val">${fmt(avgPrecip, 1)} mm</span></div>` : ''}
      <div class="stat"><span class="stat-icon">💨</span><span class="stat-lbl">${t.statWind}</span><span class="stat-val">${fmt(cur.wind, 0)} km/h</span></div>
      <div class="stat"><span class="stat-icon">💧</span><span class="stat-lbl">${t.statHum}</span><span class="stat-val">${fmt(cur.hum, 0)}%</span></div>
      <div class="stat"><span class="stat-icon">🔵</span><span class="stat-lbl">${t.statPres}</span><span class="stat-val">${fmt(cur.pres, 0)} hPa</span></div>
      ${aqiI ? `<div class="stat"><span class="stat-icon">🍃</span><span class="stat-lbl">${t.statAqi}</span><span class="stat-val ${aqiI.cls}">${aqiI.lbl}${aqiBadge}</span></div>` : ''}
      <div class="stat"><span class="stat-icon">📡</span><span class="stat-lbl">${t.statModels}</span><span class="stat-val">${t.nModels(n)}</span></div>
    </div>
  `
}

// ── Current (single model) ─────────────────────────────────────────────────────
function renderSingleModel(el: HTMLElement, t: LangData) {
  const key   = state.activeModel
  const data  = state.wxData[key]
  const model = MODELS.find(m => m.key === key)
  if (!data || !model) {
    el.innerHTML = `<p style="padding:20px;color:var(--text-muted)">${t.noData}</p>`
    return
  }

  const cur  = getCurrentWeather(data)
  const wx   = wxFromCode(cur.code, t.wx)
  const aqi  = getCurrentAqi(state.aqiData)
  const aqiI = aqiInfo(aqi, t.aqi)

  el.innerHTML = `
    <div class="mc-left">
      <div class="mc-big-icon">${wx.icon}</div>
      <div class="mc-temp-block">
        <div class="mc-label" style="color:${model.color}">${model.flag} ${model.fullName}</div>
        <div class="mc-temp" style="color:${model.color}">${cur.temp !== null ? Math.round(cur.temp) : '—'}<span class="mc-unit">°C</span></div>
        <div class="mc-condition">${wx.lbl}</div>
        <div class="mc-feels">${t.statFeels}: ${cur.feels !== null ? Math.round(cur.feels) + '°C' : '—'}</div>
      </div>
    </div>
    <div class="mc-right">
      <div class="stat"><span class="stat-icon">💦</span><span class="stat-lbl">${t.statRain}</span><span class="stat-val">${fmt(cur.rain, 0)}%</span></div>
      <div class="stat"><span class="stat-icon">💨</span><span class="stat-lbl">${t.statWind}</span><span class="stat-val">${fmt(cur.wind, 0)} km/h</span></div>
      <div class="stat"><span class="stat-icon">💧</span><span class="stat-lbl">${t.statHum}</span><span class="stat-val">${fmt(cur.hum, 0)}%</span></div>
      <div class="stat"><span class="stat-icon">🔵</span><span class="stat-lbl">${t.statPres}</span><span class="stat-val">${fmt(cur.pres, 0)} hPa</span></div>
      ${aqiI ? `<div class="stat"><span class="stat-icon">🍃</span><span class="stat-lbl">${t.statAqi}</span><span class="stat-val ${aqiI.cls}">${aqiI.lbl}</span></div>` : ''}
      <div class="stat"><span class="stat-icon">🏢</span><span class="stat-lbl">Org</span><span class="stat-val muted">${model.org}</span></div>
    </div>
  `
}

// ── Selected day view (forecast) ───────────────────────────────────────────────
function renderDayView(el: HTMLElement, t: LangData, dayIndex: number) {
  const forecast = getEnsembleForecast(state.wxData, t.wx, 7)
  const day = forecast[dayIndex]
  if (!day) { renderEnsemble(el, t); return }

  const wx   = wxFromCode(day.code, t.wx)
  const date = new Date(day.date + 'T12:00:00')
  const dateLabel = `${t.days[date.getDay()]} ${date.getDate()} ${t.months[date.getMonth()]}`

  // Compute avg wind from daily data across models valid for this day
  const models = MODELS
    .filter(m => modelValidForDay(m, dayIndex) && state.wxData[m.key] != null)
    .map(m => state.wxData[m.key]!)
  const winds  = models.map(m => m.daily.windspeed_10m_max[dayIndex] ?? null).filter((v): v is number => v !== null)
  const avgWind = winds.length ? avg(winds) : null

  const gusts  = models.map(m => m.daily.windgusts_10m_max?.[dayIndex] ?? null).filter((v): v is number => v !== null)
  const avgGust = gusts.length ? avg(gusts) : null

  const precipVals = models.map(m => (m.daily as any).precipitation_sum?.[dayIndex] ?? null).filter((v): v is number => v !== null)
  const avgPrecip  = precipVals.length ? avg(precipVals) : null

  el.innerHTML = `
    <div class="mc-left">
      <div class="mc-big-icon">${wx.icon}</div>
      <div class="mc-temp-block">
        <div class="mc-label">${dateLabel} · ${t.nModels(day.n)}</div>
        <div class="mc-temp">${day.maxT !== null ? Math.round(day.maxT) : '—'}<span class="mc-unit">°C</span></div>
        <div class="mc-condition">${wx.lbl}</div>
        <div class="mc-feels">↓ Mín: ${day.minT !== null ? Math.round(day.minT) + '°C' : '—'}</div>
      </div>
    </div>
    <div class="mc-right">
      <div class="stat"><span class="stat-icon">💦</span><span class="stat-lbl">${t.statRain}</span><span class="stat-val">${day.rain !== null ? Math.round(day.rain) + '%' : '—'}</span></div>
      ${avgPrecip !== null ? `<div class="stat"><span class="stat-icon">🌧️</span><span class="stat-lbl">${t.statPrecip}</span><span class="stat-val">${fmt(avgPrecip, 1)} mm</span></div>` : ''}
      <div class="stat"><span class="stat-icon">💨</span><span class="stat-lbl">${t.statWind}</span><span class="stat-val">${fmt(avgWind, 0)} km/h${avgGust !== null ? ` (↑${Math.round(avgGust)})` : ''}</span></div>
      <div class="stat"><span class="stat-icon">📅</span><span class="stat-lbl">${t.statModels}</span><span class="stat-val">${t.nModels(day.n)}</span></div>
    </div>
  `
}
