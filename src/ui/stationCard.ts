import { state } from '../state'
import { LANG_DATA } from '../config/i18n'
import type { CurrentObs } from '../api/station'
import { fmt } from '../utils/weather'

export function renderStationCard(obs: CurrentObs | null) {
  const el = document.getElementById('stationCard')
  if (!el) return
  const t = LANG_DATA[state.lang]

  if (!obs) { el.innerHTML = ''; return }

  // Format update time (HH:MM)
  let timeLabel = ''
  if (obs.time) {
    const d = new Date(obs.time)
    timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const windDirs = ['↑','↗','→','↘','↓','↙','←','↖']
  const arrow = obs.windDir !== null ? windDirs[Math.round(obs.windDir / 45) % 8] : ''

  el.innerHTML = `
    <div class="station-card">
      <div class="station-header">
        <span class="station-label">📡 ${t.now}</span>
        ${timeLabel ? `<span class="station-time">${timeLabel}</span>` : ''}
      </div>
      <div class="station-vals">
        <div class="sv"><span class="sv-icon">🌡️</span><span class="sv-val">${fmt(obs.temp, 1)}°C</span></div>
        <div class="sv"><span class="sv-icon">🤔</span><span class="sv-val">${fmt(obs.feelsLike, 1)}°C</span></div>
        <div class="sv sv-sep"></div>
        <div class="sv"><span class="sv-icon">💧</span><span class="sv-val">${fmt(obs.humidity, 0)}%</span></div>
        <div class="sv"><span class="sv-icon">💨</span><span class="sv-val">${arrow} ${fmt(obs.windspeed, 0)} km/h</span></div>
        <div class="sv"><span class="sv-icon">💦</span><span class="sv-val">${fmt(obs.precip, 1)} mm</span></div>
      </div>
    </div>
  `
}
