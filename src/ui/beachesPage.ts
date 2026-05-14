import { state } from '../state'
import { LANG_DATA } from '../config/i18n'
import type { BeachResult, MarineData, OpenMeteoResponse } from '../types'

// ─── Algorithms ────────────────────────────────────────────────────────────

export function calcBeachFlag(
  waveH: number | null,
  windKmh: number | null,
): 'green' | 'yellow' | 'red' {
  const w = waveH ?? 0
  const v = windKmh ?? 0
  if (w >= 2.0 || v >= 60) return 'red'
  if (w >= 0.8 || v >= 30) return 'yellow'
  return 'green'
}

export function calcJellyfishRisk(
  waterTempC: number | null,
  month: number,     // 0-indexed (0 = January)
  lat: number,
  lon: number,
): 'low' | 'medium' | 'high' | null {
  // Only shown in Mediterranean (lat 30-47, lon -5 to 37) during Jun-Oct
  if (lat < 30 || lat > 47 || lon < -5 || lon > 37) return null
  if (month < 5 || month > 9) return null   // 5=Jun … 9=Oct
  if (waterTempC === null) return null

  if (waterTempC >= 24) return 'high'
  if (waterTempC >= 20) return 'medium'
  return 'low'
}

export function calcBeachQuality(
  waveH: number | null,
  windKmh: number | null,
  uvIndex: number | null,
  rainPct: number | null,
  waterTempC: number | null,
): 'excellent' | 'good' | 'poor' {
  let score = 100
  const w = waveH ?? 0
  const v = windKmh ?? 0
  const uv = uvIndex ?? 0
  const r = rainPct ?? 0
  const wt = waterTempC ?? 20

  if (w > 1.5) score -= 30
  else if (w > 0.7) score -= 15
  if (v > 40) score -= 25
  else if (v > 25) score -= 10
  if (uv > 9) score -= 10
  if (r > 50) score -= 30
  else if (r > 25) score -= 15
  if (wt < 16) score -= 15

  if (score >= 75) return 'excellent'
  if (score >= 50) return 'good'
  return 'poor'
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Find the hourly index closest to "now" in a time array */
function nowHourlyIndex(times: string[]): number {
  const now = Date.now()
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - now)
    if (diff < bestDiff) { bestDiff = diff; best = i }
  }
  return best
}

function fmt1(v: number | null, unit: string): string {
  if (v === null || isNaN(v)) return '—'
  return `${v.toFixed(1)} ${unit}`
}

function fmtInt(v: number | null, unit: string): string {
  if (v === null || isNaN(v)) return '—'
  return `${Math.round(v)} ${unit}`
}

/** Cardinal direction from degrees */
function cardDir(deg: number | null): string {
  if (deg === null) return ''
  const dirs = ['N','NE','E','SE','S','SW','W','NW']
  return dirs[Math.round(deg / 45) % 8]
}

// ─── Main renderer ───────────────────────────────────────────────────────────

export function renderBeachesPage(
  lat: number,
  lon: number,
  beaches: BeachResult[],
  marineData: MarineData | null,
  wxData: Record<string, OpenMeteoResponse | null>,
) {
  const el = document.getElementById('pageBeaches')
  if (!el) return

  const lang = LANG_DATA[state.lang] ?? LANG_DATA.en

  if (!beaches.length) {
    el.innerHTML = `
      <div class="section-header">
        <h2>${lang.beachesTitle}</h2>
        <span class="section-radius">${lang.beachesRadius}</span>
      </div>
      <div class="empty-state">${lang.noBeachesFound}</div>`
    return
  }

  // Get ensemble weather for the location (fallback to first available)
  const wx = wxData['ensemble'] ?? Object.values(wxData).find(v => v !== null) ?? null
  const hi = wx ? nowHourlyIndex(wx.hourly.time) : 0

  const nowWind    = wx?.hourly.wind_speed_10m[hi] ?? null
  const nowUv      = wx?.hourly.uv_index?.[hi] ?? null
  const nowRainPct = wx?.hourly.precipitation_probability[hi] ?? null
  const nowAirTemp = wx?.hourly.temperature_2m[hi] ?? null

  // Marine data at current hour
  let marineHi = 0
  if (marineData) marineHi = nowHourlyIndex(marineData.hourly.time)

  const nowWaveH = marineData?.hourly.wave_height[marineHi] ?? null
  const nowWaveDir = marineData?.hourly.wave_direction[marineHi] ?? null
  const nowSwellH = marineData?.hourly.swell_wave_height[marineHi] ?? null
  const nowSwellP = marineData?.hourly.swell_wave_period[marineHi] ?? null
  const nowWaterT = marineData?.hourly.sea_surface_temperature[marineHi] ?? null

  // Ensure selected beach is valid
  if (!state.selectedBeach || !beaches.find(b => b.id === state.selectedBeach!.id)) {
    state.selectedBeach = beaches[0]
  }
  const sel = state.selectedBeach

  const month = new Date().getMonth()   // 0-indexed

  // Calc flags / quality for selected beach
  const flag     = calcBeachFlag(nowWaveH, nowWind)
  const quality  = calcBeachQuality(nowWaveH, nowWind, nowUv, nowRainPct, nowWaterT)
  const jellyfish = calcJellyfishRisk(nowWaterT, month, sel.lat, sel.lon)

  // Flag label
  const flagLabel = flag === 'green'
    ? lang.beachFlagGreen
    : flag === 'yellow' ? lang.beachFlagYellow : lang.beachFlagRed

  const qualityLabel = quality === 'excellent'
    ? lang.beachQualityExcellent
    : quality === 'good' ? lang.beachQualityGood : lang.beachQualityPoor

  // Jellyfish row
  const jfRow = jellyfish
    ? `<div class="beach-detail-row">
         <span class="detail-label">🪼 ${lang.jellyfishRisk}</span>
         <span class="detail-value">${
           jellyfish === 'high' ? lang.jellyfishHigh
           : jellyfish === 'medium' ? lang.jellyfishMedium
           : lang.jellyfishLow}</span>
       </div>`
    : ''

  // Marine rows (only when data available)
  const marineRows = marineData ? `
    <div class="beach-detail-row">
      <span class="detail-label">🌊 ${lang.waveHeight}</span>
      <span class="detail-value">${fmt1(nowWaveH, 'm')}${nowWaveDir !== null ? ` ${cardDir(nowWaveDir)}` : ''}</span>
    </div>
    <div class="beach-detail-row">
      <span class="detail-label">🌊 ${lang.swellHeight}</span>
      <span class="detail-value">${fmt1(nowSwellH, 'm')}${nowSwellP !== null ? ` · ${fmt1(nowSwellP, 's')}` : ''}</span>
    </div>
    <div class="beach-detail-row">
      <span class="detail-label">💧 ${lang.waterTemp}</span>
      <span class="detail-value">${fmtInt(nowWaterT, '°C')}</span>
    </div>` : ''

  // Build beach list items
  const listItems = beaches.map(b => {
    const active = b.id === sel.id ? ' active' : ''
    const distStr = b.distKm < 10 ? `${b.distKm.toFixed(1)} km` : `${Math.round(b.distKm)} km`
    return `<div class="beach-list-item${active}" data-beach-id="${b.id}">
      <span class="beach-name">${b.name}</span>
      <span class="beach-dist">${distStr}</span>
    </div>`
  }).join('')

  el.innerHTML = `
    <div class="section-header">
      <h2>${lang.beachesTitle}</h2>
      <span class="section-radius">${lang.beachesRadius}</span>
    </div>
    <div class="beaches-layout">
      <div class="beach-list" id="beachList">${listItems}</div>
      <div class="beach-detail">
        <div class="beach-detail-name">${sel.name}</div>
        <div class="beach-badges">
          <span class="beach-badge flag-${flag}">${flagLabel} <small>${lang.beachFlagEstimated}</small></span>
          <span class="beach-badge quality-${quality}">${qualityLabel}</span>
        </div>
        <div class="beach-detail-grid">
          ${marineRows}
          <div class="beach-detail-row">
            <span class="detail-label">🌬 Wind</span>
            <span class="detail-value">${fmtInt(nowWind, 'km/h')}</span>
          </div>
          <div class="beach-detail-row">
            <span class="detail-label">☀️ UV</span>
            <span class="detail-value">${fmtInt(nowUv, '')}</span>
          </div>
          <div class="beach-detail-row">
            <span class="detail-label">🌧 Rain</span>
            <span class="detail-value">${fmtInt(nowRainPct, '%')}</span>
          </div>
          <div class="beach-detail-row">
            <span class="detail-label">🌡 Air</span>
            <span class="detail-value">${fmtInt(nowAirTemp, '°C')}</span>
          </div>
          ${jfRow}
        </div>
      </div>
    </div>
    <div id="beachMapCard" class="beach-map-section"></div>`

  // Click handlers for beach list
  el.querySelectorAll('.beach-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = (item as HTMLElement).dataset.beachId
      const beach = beaches.find(b => b.id === id)
      if (beach) {
        state.selectedBeach = beach
        renderBeachesPage(lat, lon, beaches, marineData, wxData)
        // Render a small map for selected beach
        renderBeachMap(beach)
      }
    })
  })

  // Render map for selected beach
  renderBeachMap(sel)
}

/** Render a small Leaflet map showing beach pins */
function renderBeachMap(selected: BeachResult) {
  const container = document.getElementById('beachMapCard')
  if (!container) return

  // Use existing mapCard-style embed via Windy for simplicity (small static map)
  container.innerHTML = `
    <div class="media-card">
      <div class="media-label">📍 ${selected.name}</div>
      <iframe
        src="https://www.openstreetmap.org/export/embed.html?bbox=${selected.lon - 0.05},${selected.lat - 0.03},${selected.lon + 0.05},${selected.lat + 0.03}&layer=mapnik&marker=${selected.lat},${selected.lon}"
        class="beach-map-iframe"
        title="Beach map"
        loading="lazy"
      ></iframe>
    </div>`
}
