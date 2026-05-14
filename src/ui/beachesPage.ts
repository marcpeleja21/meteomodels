import L from 'leaflet'
import { state } from '../state'
import { LANG_DATA } from '../config/i18n'
import type { BeachResult, MarineData, OpenMeteoResponse } from '../types'
import { fetchNearbyWebcam } from '../api/webcam'

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

/**
 * Check if a beach has Blue Flag certification from OSM tags.
 * Handles multiple tag variants used by different contributors.
 */
function hasBlueFlag(tags: Record<string, string>): boolean {
  const norm = (v: string | undefined) => {
    if (!v) return ''
    return v.toLowerCase().replace(/[-_\s]/g, '')
  }
  // Direct blue_flag tag
  const bf = norm(tags['blue_flag'])
  if (bf === 'yes' || bf === 'blueflag') return true
  // award:blue_flag tag
  const abf = norm(tags['award:blue_flag'])
  if (abf === 'yes' || abf === 'blueflag') return true
  // award tag set to blue_flag value
  const award = norm(tags['award'])
  if (award === 'blueflag') return true
  // certification tag mentioning blue flag
  const cert = norm(tags['certification'])
  if (cert.includes('blue') && cert.includes('flag')) return true
  return false
}

// ─── Satellite fallback map (Leaflet + Esri World Imagery) ───────────────────

let _satMap: L.Map | null = null

function renderSatelliteMap(container: HTMLElement, lat: number, lon: number, label: string) {
  container.innerHTML = `
    <div class="media-card">
      <div class="media-label">🛰 ${label}</div>
      <div id="beachSatMap" style="width:100%;height:220px;border-radius:8px;overflow:hidden;"></div>
    </div>`

  // Give the DOM a tick to paint before Leaflet inits
  requestAnimationFrame(() => {
    const mapEl = document.getElementById('beachSatMap')
    if (!mapEl) return

    if (_satMap) {
      _satMap.remove()
      _satMap = null
    }

    _satMap = L.map(mapEl, { zoomControl: true, attributionControl: false }).setView([lat, lon], 14)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19 }
    ).addTo(_satMap)
    L.marker([lat, lon]).addTo(_satMap)
  })
}

// ─── Webcam / media section renderer ─────────────────────────────────────────

async function renderBeachMedia(beach: BeachResult) {
  const container = document.getElementById('beachWebcamCard')
  if (!container) return

  // Show loading state
  container.innerHTML = `
    <div class="media-card">
      <div class="media-label">📷 Loading webcam…</div>
      <div class="loading-inline"></div>
    </div>`

  const wc = await fetchNearbyWebcam(beach.lat, beach.lon, 10)

  // If there's no container anymore (user switched beach), bail out
  if (!document.getElementById('beachWebcamCard')) return

  if (wc) {
    // Prefer player embed, fall back to image
    if (wc.playerUrl) {
      container.innerHTML = `
        <div class="media-card">
          <div class="media-label">📷 ${wc.title}${wc.distKm != null ? ` · ${wc.distKm.toFixed(1)} km` : ''}</div>
          <iframe
            src="${wc.playerUrl}"
            class="webcam-iframe"
            frameborder="0"
            allowfullscreen
            loading="lazy"
          ></iframe>
          ${wc.linkUrl ? `<a class="webcam-link" href="${wc.linkUrl}" target="_blank" rel="noopener">Open webcam ↗</a>` : ''}
        </div>`
    } else if (wc.imageUrl) {
      container.innerHTML = `
        <div class="media-card">
          <div class="media-label">📷 ${wc.title}${wc.distKm != null ? ` · ${wc.distKm.toFixed(1)} km` : ''}</div>
          <img src="${wc.imageUrl}" class="webcam-img" alt="Webcam" />
          ${wc.linkUrl ? `<a class="webcam-link" href="${wc.linkUrl}" target="_blank" rel="noopener">Open webcam ↗</a>` : ''}
        </div>`
    } else {
      // Webcam found but no media → satellite fallback
      renderSatelliteMap(container, beach.lat, beach.lon, beach.name)
    }
  } else {
    // No nearby webcam → satellite imagery fallback
    renderSatelliteMap(container, beach.lat, beach.lon, beach.name)
  }
}

// ─── Windy SST map ───────────────────────────────────────────────────────────
// Note: do NOT include level=surface — that is an atmospheric parameter that
// overrides overlay=sst back to wind. SST has no pressure level.

function renderBeachMap(beach: BeachResult) {
  const container = document.getElementById('beachMapCard')
  if (!container) return

  container.innerHTML = `
    <div class="media-card">
      <div class="media-label">🌡 Sea Surface Temperature — ${beach.name}</div>
      <iframe
        src="https://embed.windy.com/embed2.html?lat=${beach.lat}&lon=${beach.lon}&zoom=6&overlay=sst&product=ecmwf&menu=&message=false&marker=true&calendar=now&type=map&location=coordinates&detail=false&metricWind=km%2Fh&metricTemp=%C2%B0C"
        class="beach-map-iframe"
        frameborder="0"
        title="Sea surface temperature"
        loading="lazy"
      ></iframe>
    </div>`
}

// ─── Tooltip texts ────────────────────────────────────────────────────────────

const FLAG_TOOLTIP =
  'Estimated beach flag based on current conditions:\n' +
  '🟢 Green — waves < 0.8 m and wind < 30 km/h: safe for swimming\n' +
  '🟡 Yellow — waves ≥ 0.8 m or wind ≥ 30 km/h: exercise caution\n' +
  '🔴 Red — waves ≥ 2.0 m or wind ≥ 60 km/h: dangerous, no swimming\n' +
  '(Estimated from model data — always follow official local flags on the beach)'

const BLUE_FLAG_TOOLTIP =
  '🔵 Blue Flag certification\n' +
  'Awarded by the Foundation for Environmental Education (FEE) to beaches meeting strict criteria:\n' +
  '• Water quality (bathing water meets EU Directive standards)\n' +
  '• Environmental management (waste, recycling, no dogs)\n' +
  '• Environmental education & information\n' +
  '• Safety & services (lifeguards, first aid, disabled access)\n' +
  'One of the world\'s most recognised eco-labels for beaches — see blueflag.global'

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

  const nowWaveH   = marineData?.hourly.wave_height[marineHi] ?? null
  const nowWaveDir = marineData?.hourly.wave_direction[marineHi] ?? null
  const nowSwellH  = marineData?.hourly.swell_wave_height[marineHi] ?? null
  const nowSwellP  = marineData?.hourly.swell_wave_period[marineHi] ?? null
  const nowWaterT  = marineData?.hourly.sea_surface_temperature[marineHi] ?? null

  // Ensure selected beach is valid
  if (!state.selectedBeach || !beaches.find(b => b.id === state.selectedBeach!.id)) {
    state.selectedBeach = beaches[0]
  }
  const sel = state.selectedBeach

  const month = new Date().getMonth()   // 0-indexed

  // Calc flags / quality for selected beach
  const flag      = calcBeachFlag(nowWaveH, nowWind)
  const quality   = calcBeachQuality(nowWaveH, nowWind, nowUv, nowRainPct, nowWaterT)
  const jellyfish = calcJellyfishRisk(nowWaterT, month, sel.lat, sel.lon)
  const blueFlag  = hasBlueFlag(sel.tags ?? {})

  // Flag label
  const flagLabel = flag === 'green'
    ? lang.beachFlagGreen
    : flag === 'yellow' ? lang.beachFlagYellow : lang.beachFlagRed

  const qualityLabel = quality === 'excellent'
    ? lang.beachQualityExcellent
    : quality === 'good' ? lang.beachQualityGood : lang.beachQualityPoor

  const flagEmoji: Record<'green'|'yellow'|'red', string> = {
    green: '🟢', yellow: '🟡', red: '🔴',
  }

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
      <span class="detail-value">${fmt1(nowWaterT, '°C')}</span>
    </div>` : ''

  // Build beach list items — include flag dot with tooltip
  const listItems = beaches.map(b => {
    const active = b.id === sel.id ? ' active' : ''
    const distStr = b.distKm < 10 ? `${b.distKm.toFixed(1)} km` : `${Math.round(b.distKm)} km`
    const bFlag = calcBeachFlag(nowWaveH, nowWind)
    const blueDot = hasBlueFlag(b.tags ?? {}) ? ' 🔵' : ''
    return `<div class="beach-list-item${active}" data-beach-id="${b.id}">
      <span class="beach-flag-dot" title="${FLAG_TOOLTIP}">${flagEmoji[bFlag]}${blueDot}</span>
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
          <span class="beach-badge flag-${flag}" title="${FLAG_TOOLTIP}">${flagEmoji[flag]} ${flagLabel} <small>${lang.beachFlagEstimated}</small></span>
          <span class="beach-badge quality-${quality}">${qualityLabel}</span>
          ${blueFlag ? `<span class="beach-badge blue-flag-badge" title="${BLUE_FLAG_TOOLTIP}">🔵 Blue Flag</span>` : ''}
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
    <div id="beachWebcamCard" class="beach-webcam-section"></div>
    <div id="beachMapCard" class="beach-map-section"></div>`

  // Click handlers for beach list
  el.querySelectorAll('.beach-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = (item as HTMLElement).dataset.beachId
      const beach = beaches.find(b => b.id === id)
      if (beach) {
        state.selectedBeach = beach
        renderBeachesPage(lat, lon, beaches, marineData, wxData)
      }
    })
  })

  // Render Windy SST map + webcam/satellite for selected beach
  renderBeachMap(sel)
  renderBeachMedia(sel)
}
