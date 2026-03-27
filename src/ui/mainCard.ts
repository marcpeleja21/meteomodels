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

// ── Helpers ──────────────────────────────────────────────────────────────────
function windArrowFromDeg(deg: number | null): string {
  if (deg === null) return ''
  return ['↑','↗','→','↘','↓','↙','←','↖'][Math.round(deg / 45) % 8]
}

/** Coloured delta badge + bar. delta = forecast - real */
function deltaHtml(delta: number | null, t: LangData): string {
  if (delta === null) return ''
  const abs = Math.abs(delta)
  const sign = delta >= 0 ? '+' : ''
  const cls = abs <= 1 ? 'delta-ok' : abs <= 3 ? 'delta-warn' : 'delta-bad'
  const pct = Math.min(abs / 10, 1) * 100
  return `
    <div class="now-delta">
      <span class="now-delta-val ${cls}">${sign}${delta.toFixed(1)}°C ${t.vsActual}</span>
      <div class="now-delta-bar-bg">
        <div class="now-delta-bar-fill ${cls}" style="width:${pct.toFixed(1)}%"></div>
      </div>
    </div>
  `
}

/** ARA (real-time) mini-panel */
function nowPanelHtml(t: LangData): string {
  const obs = state.currentObs
  if (!obs) return ''
  const wx     = wxFromCode(obs.code, t.wx)
  const arrow  = windArrowFromDeg(obs.windDir)
  const timeLabel = ''   // wttr.in doesn't expose ISO time
  const locLine = obs.stationName
    ? `<div class="now-src">📍 ${obs.stationName}${obs.stationDist ? ` · ${obs.stationDist} km` : ''} · wttr.in</div>`
    : `<div class="now-src">📡 Observació · Open-Meteo</div>`

  return `
    <div class="cmp-panel now-panel">
      <div class="cmp-label live">📡 ${t.now}${timeLabel}</div>
      <div class="cmp-icon">${wx.icon}</div>
      <div class="cmp-temp">${obs.temp !== null ? obs.temp.toFixed(1) : '—'}<span class="cmp-unit">°C</span></div>
      <div class="cmp-cond">${wx.lbl}</div>
      <div class="cmp-feels">${t.statFeels}: ${obs.feelsLike !== null ? obs.feelsLike.toFixed(1) + '°C' : '—'}</div>
      <div class="cmp-stats">
        <span>💧 ${fmt(obs.humidity, 0)}%</span>
        <span>💨 ${arrow} ${fmt(obs.windspeed, 0)} km/h</span>
        <span>💦 ${fmt(obs.precip, 1)} mm</span>
      </div>
      ${locLine}
    </div>
  `
}

// ── Current (ensemble) ────────────────────────────────────────────────────────
function renderEnsemble(el: HTMLElement, t: LangData) {
  const { data: cur, n } = getEnsembleCurrent(state.wxData)
  const wx    = wxFromCode(cur.code, t.wx)
  const aqi   = getCurrentAqi(state.aqiData)
  const aqiI  = aqiInfo(aqi, t.aqi)

  const models = Object.values(state.wxData).filter((d): d is OpenMeteoResponse => d !== null)
  const precipVals = models.map(m => (m.daily as any).precipitation_sum?.[0] ?? null).filter((v): v is number => v !== null)
  const avgPrecip = precipVals.length ? avg(precipVals) : null

  const obsTemp = state.currentObs?.temp ?? null
  const delta   = (cur.temp !== null && obsTemp !== null) ? cur.temp - obsTemp : null

  const hasObs = state.currentObs != null

  el.innerHTML = `
    <div class="cmp-row${hasObs ? '' : ' cmp-row-single'}">
      ${hasObs ? nowPanelHtml(t) : ''}
      <div class="cmp-panel fcast-panel">
        <div class="cmp-label">${t.ensLabel(n)}</div>
        <div class="cmp-icon">${wx.icon}</div>
        <div class="cmp-temp">${cur.temp !== null ? cur.temp.toFixed(1) : '—'}<span class="cmp-unit">°C</span></div>
        <div class="cmp-cond">${wx.lbl}</div>
        <div class="cmp-feels">${t.statFeels}: ${cur.feels !== null ? cur.feels.toFixed(1) + '°C' : '—'}</div>
        ${deltaHtml(delta, t)}
        <div class="cmp-stats">
          <span>💦 ${fmt(cur.rain, 0)}%</span>
          ${avgPrecip !== null ? `<span>🌧️ ${fmt(avgPrecip, 1)} mm</span>` : ''}
          <span>💨 ${fmt(cur.wind, 0)} km/h</span>
          <span>💧 ${fmt(cur.hum, 0)}%</span>
        </div>
        ${aqiI ? `<div class="cmp-aqi aqi-${aqiI.cls}">${aqiI.lbl}${aqi !== null ? ` (${Math.round(aqi)})` : ''}</div>` : ''}
      </div>
    </div>
  `
}

// ── Current (single model) ────────────────────────────────────────────────────
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

  const obsTemp   = state.currentObs?.temp ?? null
  const delta     = (cur.temp !== null && obsTemp !== null) ? cur.temp - obsTemp : null
  const hasObs    = state.currentObs != null

  el.innerHTML = `
    <div class="cmp-row${hasObs ? '' : ' cmp-row-single'}">
      ${hasObs ? nowPanelHtml(t) : ''}
      <div class="cmp-panel fcast-panel">
        <div class="cmp-label" style="color:${model.color}">${model.flag} ${model.fullName}</div>
        <div class="cmp-icon">${wx.icon}</div>
        <div class="cmp-temp" style="color:${model.color}">${cur.temp !== null ? cur.temp.toFixed(1) : '—'}<span class="cmp-unit">°C</span></div>
        <div class="cmp-cond">${wx.lbl}</div>
        <div class="cmp-feels">${t.statFeels}: ${cur.feels !== null ? cur.feels.toFixed(1) + '°C' : '—'}</div>
        ${deltaHtml(delta, t)}
        <div class="cmp-stats">
          <span>💦 ${fmt(cur.rain, 0)}%</span>
          <span>💨 ${fmt(cur.wind, 0)} km/h</span>
          <span>💧 ${fmt(cur.hum, 0)}%</span>
        </div>
        ${aqiI ? `<div class="cmp-aqi aqi-${aqiI.cls}">${aqiI.lbl}${aqi !== null ? ` (${Math.round(aqi)})` : ''}</div>` : ''}
      </div>
    </div>
  `
}

// ── Selected day view (forecast only, no real-time comparison) ────────────────
function renderDayView(el: HTMLElement, t: LangData, dayIndex: number) {
  const forecast = getEnsembleForecast(state.wxData, t.wx, 7)
  const day = forecast[dayIndex]
  if (!day) { renderEnsemble(el, t); return }

  const wx   = wxFromCode(day.code, t.wx)
  const date = new Date(day.date + 'T12:00:00')
  const dateLabel = `${t.days[date.getDay()]} ${date.getDate()} ${t.months[date.getMonth()]}`

  const models     = MODELS.filter(m => modelValidForDay(m, dayIndex) && state.wxData[m.key] != null).map(m => state.wxData[m.key]!)
  const winds      = models.map(m => m.daily.windspeed_10m_max[dayIndex] ?? null).filter((v): v is number => v !== null)
  const gusts      = models.map(m => m.daily.windgusts_10m_max?.[dayIndex] ?? null).filter((v): v is number => v !== null)
  const precipVals = models.map(m => (m.daily as any).precipitation_sum?.[dayIndex] ?? null).filter((v): v is number => v !== null)
  const avgWind    = winds.length ? avg(winds) : null
  const avgGust    = gusts.length ? avg(gusts) : null
  const avgPrecip  = precipVals.length ? avg(precipVals) : null

  el.innerHTML = `
    <div class="cmp-row cmp-row-single">
      <div class="cmp-panel fcast-panel">
        <div class="cmp-label">${dateLabel} · ${t.nModels(day.n)}</div>
        <div class="cmp-icon">${wx.icon}</div>
        <div class="cmp-temp">${day.maxT !== null ? Math.round(day.maxT) : '—'}<span class="cmp-unit">°C</span></div>
        <div class="cmp-cond">${wx.lbl}</div>
        <div class="cmp-feels">↓ Mín: ${day.minT !== null ? Math.round(day.minT) + '°C' : '—'}</div>
        <div class="cmp-stats">
          <span>💦 ${day.rain !== null ? Math.round(day.rain) + '%' : '—'}</span>
          ${avgPrecip !== null ? `<span>🌧️ ${fmt(avgPrecip, 1)} mm</span>` : ''}
          <span>💨 ${fmt(avgWind, 0)} km/h${avgGust !== null ? ` ↑${Math.round(avgGust)}` : ''}</span>
        </div>
      </div>
    </div>
  `
}
