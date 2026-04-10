import type { LangData, OpenMeteoResponse } from '../types'
import { state } from '../state'
import { getActiveModels, modelValidForDay } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getCurrentWeather, getEnsembleCurrent, getCurrentAqi, getEnsembleForecast, isLocationNight } from '../utils/data'
import { wxFromCode, aqiInfo, fmt, avg } from '../utils/weather'
import { tempColor, tempMaxColor, tempMinColor, rainPctColor, precipColor, windColor, humidityColor } from '../utils/colors'

export function renderMainCard() {
  const t  = LANG_DATA[state.lang]
  const el = document.getElementById('mainCardTop')!

  if (state.selectedDay > 0) {
    renderDayView(el, t, state.selectedDay)
  } else if (state.activeModel === 'ensemble') {
    renderEnsemble(el, t)
  } else {
    renderSingleModel(el, t)
  }

  // Wire up fixed-position tooltip for ⓘ buttons (escapes overflow:hidden parents)
  initEnsInfoTooltip(el)
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
function nowPanelHtml(t: LangData, night: boolean): string {
  const obs = state.currentObs
  if (!obs) return ''
  const wx    = wxFromCode(obs.code, t.wx, night)
  const arrow = windArrowFromDeg(obs.windDir)

  // Time label — show local HH:MM if available
  let timeLabel = ''
  if (obs.time) {
    const d = new Date(obs.time)
    if (!isNaN(d.getTime())) {
      timeLabel = ` · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    }
  }

  const locLine = obs.stationName
    ? `<div class="now-src">📍 ${obs.stationName}${obs.stationDist ? ` · ${obs.stationDist} km` : ''} · Weather Underground</div>`
    : `<div class="now-src">📡 Observació en temps real</div>`

  const gustStr  = obs.windGust  !== null ? ` ↑${Math.round(obs.windGust)}` : ''
  const presStr  = obs.pressure  !== null ? `<span title="${t.tipPres}">🔵 ${obs.pressure.toFixed(0)} hPa</span>` : ''
  const uvStr    = obs.uv        !== null ? `<span title="${t.tipUv}">☀️ UV ${obs.uv.toFixed(0)}</span>` : ''

  return `
    <div class="cmp-panel now-panel">
      <div class="cmp-label live">📡 ${t.now}${timeLabel}</div>
      <div class="cmp-icon">${wx.icon}</div>
      <div class="cmp-temp" style="color:${tempColor(obs.temp)}">${obs.temp !== null ? obs.temp.toFixed(1) : '—'}<span class="cmp-unit">°C</span></div>
      <div class="cmp-cond">${wx.lbl}</div>
      <div class="cmp-feels">${t.statFeels}: <span style="color:${tempColor(obs.feelsLike)}">${obs.feelsLike !== null ? obs.feelsLike.toFixed(1) + '°C' : '—'}</span></div>
      <div class="cmp-stats">
        <span title="${t.tipHum}" style="color:${humidityColor(obs.humidity)}">💧 ${fmt(obs.humidity, 0)}%</span>
        <span title="${t.tipWind}" style="color:${windColor(obs.windspeed)}">💨 ${arrow} ${fmt(obs.windspeed, 0)}${gustStr} km/h</span>
        <span title="${t.tipPrecip}" style="color:${precipColor(obs.precip)}">🌧️ ${fmt(obs.precip, 1)} mm</span>
        ${presStr}
        ${uvStr}
      </div>
      ${locLine}
    </div>
  `
}

// ── Current (ensemble) ────────────────────────────────────────────────────────
function renderEnsemble(el: HTMLElement, t: LangData) {
  const night = isLocationNight(state.wxData)
  const { data: cur, n } = getEnsembleCurrent(state.wxData)
  const wx    = wxFromCode(cur.code, t.wx, night)
  const aqi   = getCurrentAqi(state.aqiData)
  const aqiI  = aqiInfo(aqi, t.aqi)

  const models = Object.values(state.wxData).filter((d): d is OpenMeteoResponse => d !== null)
  const precipVals = models.map(m => m.daily.precipitation_sum?.[0] ?? null).filter((v): v is number => v !== null)
  const avgPrecip = precipVals.length ? avg(precipVals) : null

  const obsTemp = state.currentObs?.temp ?? null
  const delta   = (cur.temp !== null && obsTemp !== null) ? cur.temp - obsTemp : null

  const hasObs = state.currentObs != null

  el.innerHTML = `
    <div class="cmp-row${hasObs ? '' : ' cmp-row-single'}">
      ${hasObs ? nowPanelHtml(t, night) : ''}
      <div class="cmp-panel fcast-panel">
        <div class="cmp-label">
          ${t.ensLabel(n)}
          <span class="ens-info-btn" tabindex="0" aria-label="Model weights info" data-ens-tip="${t.ensInfoTip.replace(/"/g, '&quot;')}">ⓘ</span>
        </div>
        <div class="cmp-icon">${wx.icon}</div>
        <div class="cmp-temp" style="color:${tempColor(cur.temp)}">${cur.temp !== null ? cur.temp.toFixed(1) : '—'}<span class="cmp-unit">°C</span></div>
        <div class="cmp-cond">${wx.lbl}</div>
        <div class="cmp-feels">${t.statFeels}: <span style="color:${tempColor(cur.feels)}">${cur.feels !== null ? cur.feels.toFixed(1) + '°C' : '—'}</span></div>
        ${deltaHtml(delta, t)}
        <div class="cmp-stats">
          <span title="${t.tipRain}" style="color:${rainPctColor(cur.rain)}">💦 ${fmt(cur.rain, 0)}%</span>
          ${avgPrecip !== null ? `<span title="${t.tipPrecip}" style="color:${precipColor(avgPrecip)}">🌧️ ${fmt(avgPrecip, 1)} mm</span>` : ''}
          <span title="${t.tipWind}" style="color:${windColor(cur.wind)}">💨 ${fmt(cur.wind, 0)} km/h</span>
          <span title="${t.tipHum}" style="color:${humidityColor(cur.hum)}">💧 ${fmt(cur.hum, 0)}%</span>
        </div>
        ${aqiI ? `<div class="cmp-aqi aqi-${aqiI.cls}">${aqiI.lbl}${aqi !== null ? ` (${Math.round(aqi)})` : ''}</div>` : ''}
      </div>
    </div>
  `
}

// ── Current (single model) ────────────────────────────────────────────────────
function renderSingleModel(el: HTMLElement, t: LangData) {
  const night = isLocationNight(state.wxData)
  const key   = state.activeModel
  const data  = state.wxData[key]
  const model = getActiveModels().find(m => m.key === key)
  if (!data || !model) {
    el.innerHTML = `<p style="padding:20px;color:var(--text-muted)">${t.noData}</p>`
    return
  }
  const cur  = getCurrentWeather(data)
  const wx   = wxFromCode(cur.code, t.wx, night)
  const aqi  = getCurrentAqi(state.aqiData)
  const aqiI = aqiInfo(aqi, t.aqi)

  const obsTemp   = state.currentObs?.temp ?? null
  const delta     = (cur.temp !== null && obsTemp !== null) ? cur.temp - obsTemp : null
  const hasObs    = state.currentObs != null

  el.innerHTML = `
    <div class="cmp-row${hasObs ? '' : ' cmp-row-single'}">
      ${hasObs ? nowPanelHtml(t, night) : ''}
      <div class="cmp-panel fcast-panel">
        <div class="cmp-label" style="color:${model.color}">${model.flag} ${model.fullName}</div>
        <div class="cmp-icon">${wx.icon}</div>
        <div class="cmp-temp" style="color:${tempColor(cur.temp)}">${cur.temp !== null ? cur.temp.toFixed(1) : '—'}<span class="cmp-unit">°C</span></div>
        <div class="cmp-cond">${wx.lbl}</div>
        <div class="cmp-feels">${t.statFeels}: <span style="color:${tempColor(cur.feels)}">${cur.feels !== null ? cur.feels.toFixed(1) + '°C' : '—'}</span></div>
        ${deltaHtml(delta, t)}
        <div class="cmp-stats">
          <span title="${t.tipRain}" style="color:${rainPctColor(cur.rain)}">💦 ${fmt(cur.rain, 0)}%</span>
          <span title="${t.tipWind}" style="color:${windColor(cur.wind)}">💨 ${fmt(cur.wind, 0)} km/h</span>
          <span title="${t.tipHum}" style="color:${humidityColor(cur.hum)}">💧 ${fmt(cur.hum, 0)}%</span>
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

  const models     = getActiveModels().filter(m => modelValidForDay(m, dayIndex) && state.wxData[m.key] != null).map(m => state.wxData[m.key]!)
  const winds      = models.map(m => m.daily.wind_speed_10m_max[dayIndex] ?? null).filter((v): v is number => v !== null)
  const gusts      = models.map(m => m.daily.wind_gusts_10m_max?.[dayIndex] ?? null).filter((v): v is number => v !== null)
  const precipVals = models.map(m => m.daily.precipitation_sum?.[dayIndex] ?? null).filter((v): v is number => v !== null)
  const avgWind    = winds.length ? avg(winds) : null
  const avgGust    = gusts.length ? avg(gusts) : null
  const avgPrecip  = precipVals.length ? avg(precipVals) : null

  el.innerHTML = `
    <div class="cmp-row cmp-row-single">
      <div class="cmp-panel fcast-panel">
        <div class="cmp-label">
          ${dateLabel} · ${t.nModels(day.n)}
          <span class="ens-info-btn" tabindex="0" aria-label="Model weights info" data-ens-tip="${t.ensInfoTip.replace(/"/g, '&quot;')}">ⓘ</span>
        </div>
        <div class="cmp-icon">${wx.icon}</div>
        <div class="cmp-temp" style="color:${tempMaxColor(day.maxT)}">${day.maxT !== null ? Math.round(day.maxT) : '—'}<span class="cmp-unit">°C</span></div>
        <div class="cmp-cond">${wx.lbl}</div>
        <div class="cmp-feels">↓ Mín: <span style="color:${tempMinColor(day.minT)}">${day.minT !== null ? Math.round(day.minT) + '°C' : '—'}</span></div>
        <div class="cmp-stats">
          <span title="${t.tipRain}" style="color:${rainPctColor(day.rain)}">💦 ${day.rain !== null ? Math.round(day.rain) + '%' : '—'}</span>
          ${avgPrecip !== null ? `<span title="${t.tipPrecip}" style="color:${precipColor(avgPrecip)}">🌧️ ${fmt(avgPrecip, 1)} mm</span>` : ''}
          <span title="${t.tipGusts}" style="color:${windColor(avgGust ?? avgWind)}">💨 ↑${fmt(avgGust ?? avgWind, 0)} km/h</span>
        </div>
      </div>
    </div>
  `
}

// ── Fixed-position tooltip (escapes overflow:hidden) ─────────────────────────
let _tipEl: HTMLElement | null = null

function getOrCreateTip(): HTMLElement {
  if (!_tipEl) {
    _tipEl = document.createElement('div')
    _tipEl.className = 'ens-info-floating-tip'
    _tipEl.setAttribute('aria-hidden', 'true')
    document.body.appendChild(_tipEl)
  }
  return _tipEl
}

function initEnsInfoTooltip(container: HTMLElement) {
  const buttons = container.querySelectorAll<HTMLElement>('.ens-info-btn')
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const tip   = getOrCreateTip()
      const text  = btn.dataset.ensTip ?? ''
      tip.textContent = text          // plain text — newlines rendered via white-space:pre-line
      tip.style.visibility = 'hidden'
      tip.style.display    = 'block'

      const r   = btn.getBoundingClientRect()
      const tw  = tip.offsetWidth
      const th  = tip.offsetHeight
      const vw  = window.innerWidth
      const vh  = window.innerHeight
      const GAP = 8

      // Prefer below; flip above if not enough room
      let top = r.bottom + GAP
      if (top + th > vh - 8) top = r.top - th - GAP

      // Centre on button, clamp to viewport
      let left = r.left + r.width / 2 - tw / 2
      left = Math.max(8, Math.min(left, vw - tw - 8))

      tip.style.top        = top  + 'px'
      tip.style.left       = left + 'px'
      tip.style.visibility = 'visible'
      tip.style.opacity    = '1'
    })

    btn.addEventListener('mouseleave', () => {
      const tip = getOrCreateTip()
      tip.style.opacity = '0'
      tip.style.display = 'none'
    })

    // Keyboard support
    btn.addEventListener('focus', () => btn.dispatchEvent(new MouseEvent('mouseenter')))
    btn.addEventListener('blur',  () => btn.dispatchEvent(new MouseEvent('mouseleave')))
  })
}
