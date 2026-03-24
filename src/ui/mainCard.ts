import type { LangData } from '../types'
import { state } from '../state'
import { MODELS } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getCurrentWeather, getEnsembleCurrent, getCurrentAqi } from '../utils/data'
import { wxFromCode, aqiInfo, fmt } from '../utils/weather'

export function renderMainCard() {
  const t = LANG_DATA[state.lang]
  const el = document.getElementById('mainCardTop')!

  if (state.activeModel === 'ensemble') {
    renderEnsemble(el, t)
  } else {
    renderSingleModel(el, t)
  }
}

function renderEnsemble(el: HTMLElement, t: LangData) {
  const { data: cur, n } = getEnsembleCurrent(state.wxData)
  const wx    = wxFromCode(cur.code, t.wx)
  const aqi   = getCurrentAqi(state.aqiData)
  const aqiI  = aqiInfo(aqi, t.aqi)
  const aqiBadge = aqiI
    ? `<span class="aqi-badge ${aqiI.cls}" style="background:rgba(0,0,0,0.3)">${aqiI.lbl}${aqi !== null ? ` (${Math.round(aqi)})` : ''}</span>`
    : ''

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
      <div class="stat"><span class="stat-icon">🌧️</span><span class="stat-lbl">${t.statRain}</span><span class="stat-val">${fmt(cur.rain, 0)}%</span></div>
      <div class="stat"><span class="stat-icon">💨</span><span class="stat-lbl">${t.statWind}</span><span class="stat-val">${fmt(cur.wind, 0)} km/h</span></div>
      <div class="stat"><span class="stat-icon">💧</span><span class="stat-lbl">${t.statHum}</span><span class="stat-val">${fmt(cur.hum, 0)}%</span></div>
      <div class="stat"><span class="stat-icon">🔵</span><span class="stat-lbl">${t.statPres}</span><span class="stat-val">${fmt(cur.pres, 0)} hPa</span></div>
      ${aqiI ? `<div class="stat"><span class="stat-icon">🍃</span><span class="stat-lbl">${t.statAqi}</span><span class="stat-val ${aqiI.cls}">${aqiI.lbl}${aqiBadge}</span></div>` : ''}
      <div class="stat"><span class="stat-icon">📡</span><span class="stat-lbl">${t.statModels}</span><span class="stat-val">${t.nModels(n)}</span></div>
    </div>
  `
}

function renderSingleModel(el: HTMLElement, t: LangData) {
  const key   = state.activeModel
  const data  = state.wxData[key]
  const model = MODELS.find(m => m.key === key)
  if (!data || !model) {
    el.innerHTML = `<p style="padding:20px;color:var(--text-muted)">${t.noData}</p>`
    return
  }

  const cur = getCurrentWeather(data)
  const wx  = wxFromCode(cur.code, t.wx)
  const aqi = getCurrentAqi(state.aqiData)
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
      <div class="stat"><span class="stat-icon">🌧️</span><span class="stat-lbl">${t.statRain}</span><span class="stat-val">${fmt(cur.rain, 0)}%</span></div>
      <div class="stat"><span class="stat-icon">💨</span><span class="stat-lbl">${t.statWind}</span><span class="stat-val">${fmt(cur.wind, 0)} km/h</span></div>
      <div class="stat"><span class="stat-icon">💧</span><span class="stat-lbl">${t.statHum}</span><span class="stat-val">${fmt(cur.hum, 0)}%</span></div>
      <div class="stat"><span class="stat-icon">🔵</span><span class="stat-lbl">${t.statPres}</span><span class="stat-val">${fmt(cur.pres, 0)} hPa</span></div>
      ${aqiI ? `<div class="stat"><span class="stat-icon">🍃</span><span class="stat-lbl">${t.statAqi}</span><span class="stat-val ${aqiI.cls}">${aqiI.lbl}</span></div>` : ''}
      <div class="stat"><span class="stat-icon">🏢</span><span class="stat-lbl">Org</span><span class="stat-val muted">${model.org}</span></div>
    </div>
  `
}
