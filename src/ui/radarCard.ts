import { state } from '../state'
import { LANG_DATA } from '../config/i18n'

/**
 * Renders a real-time precipitation/radar card using Windy's free embed.
 * Only called when hasPrecipNearby() returns true (rain/snow detected or approaching).
 */
export function renderRadarCard(lat: number, lon: number) {
  const el = document.getElementById('radarCard')
  if (!el) return

  const lang = LANG_DATA[state.lang] ?? LANG_DATA.en

  // Windy embed — overlay=rain shows live precipitation composite (radar-backed)
  // marker=true pins the selected location; no menu/ads in embed mode
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
