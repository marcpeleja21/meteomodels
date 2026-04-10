import { state } from '../state'
import { LANG_DATA } from '../config/i18n'

/**
 * Renders a real-time precipitation/radar card using Windy's free embed.
 *
 * @param lat        Location latitude
 * @param lon        Location longitude
 * @param hoursUntil null  → raining now (no forecast badge)
 *                   0     → precipitation starting now
 *                   1-6   → precipitation expected in N hours (shows badge)
 */
export function renderRadarCard(lat: number, lon: number, hoursUntil: number | null) {
  const el = document.getElementById('radarCard')
  if (!el) return

  const lang = LANG_DATA[state.lang] ?? LANG_DATA.en

  // Forecast badge: shown only when rain is approaching but not here yet
  const forecastBadge = (hoursUntil !== null && hoursUntil > 0)
    ? `<div class="radar-forecast-badge">
         ⏱ ${lang.radarForecast.replace('{n}', String(hoursUntil))}
       </div>`
    : ''

  const windyUrl =
    `https://embed.windy.com/embed2.html` +
    `?lat=${lat}&lon=${lon}` +
    `&detailLat=${lat}&detailLon=${lon}` +
    `&zoom=8&level=surface` +
    `&overlay=rain` +
    `&product=ecmwf` +
    `&menu=&message=false` +
    `&marker=true` +
    `&calendar=now` +
    `&type=map` +
    `&location=coordinates` +
    `&metricWind=default&metricTemp=default`

  el.innerHTML = `
    <div class="media-card radar-card">
      <div class="media-label">${lang.radarTitle}</div>
      ${forecastBadge}
      <iframe
        src="${windyUrl}"
        class="radar-iframe"
        title="${lang.radarTitle}"
        loading="lazy"
        allowfullscreen
      ></iframe>
      <div class="radar-attribution">
        Precipitation © <a href="https://www.windy.com" target="_blank" rel="noopener">Windy</a>
      </div>
    </div>`
}

/** Hide the radar card (call when no precipitation detected) */
export function clearRadarCard() {
  const el = document.getElementById('radarCard')
  if (el) el.innerHTML = ''
}
