import L from 'leaflet'
import { state } from '../state'
import { LANG_DATA } from '../config/i18n'
import type { SkiResortResult, OpenMeteoResponse, AvalancheRisk } from '../types'

// ─── Algorithms ────────────────────────────────────────────────────────────

export type SnowQuality =
  | 'powder'
  | 'freshPowder'
  | 'packedPowder'
  | 'packed'
  | 'wetSlush'

export function calcSnowQuality(freshSnow24h: number | null, tempC: number | null): SnowQuality {
  const f = freshSnow24h ?? 0
  const t = tempC ?? 0
  if (t < -5 && f > 15)  return 'powder'
  if (t < 0  && f > 5)   return 'freshPowder'
  if (t <= 0 && f <= 5)  return 'packedPowder'
  if (t > 0 && t <= 3)   return 'packed'
  return 'wetSlush'
}

/**
 * Estimate temperature at a target altitude via lapse rate.
 * T(alt) = T(base) − 6.5 × (alt − base) / 1000
 */
export function lapseRateTemp(
  tempBase: number,
  baseAlt: number,
  targetAlt: number,
): number {
  return tempBase - 6.5 * (targetAlt - baseAlt) / 1000
}

/** Status derived from snowpack */
export function calcSkiStatus(
  snowDepth: number | null,
  tempC: number | null,
  rainProbPct: number | null,
): 'open' | 'partial' | 'closed' {
  const depth = snowDepth ?? 0
  const rain  = rainProbPct ?? 0
  const temp  = tempC ?? 0

  if (depth < 20) return 'closed'
  if (depth >= 60 && temp <= 2 && rain < 50) return 'open'
  return 'partial'
}

export function calcSkiSummary(
  snowDepth: number | null,
  freshSnow24h: number | null,
  avalancheLevel: number | null,
  windKmh: number | null,
  tempC: number | null,
  rainProb: number | null,
  _lang: any,
): string {
  const parts: string[] = []
  const depth = snowDepth ?? 0
  const fresh = freshSnow24h ?? 0
  const wind  = windKmh ?? 0
  const rain  = rainProb ?? 0
  const temp  = tempC ?? 0

  // Snow summary
  if (depth >= 100 && fresh > 20) {
    parts.push('❄️ Excellent snowpack with recent fresh powder.')
  } else if (depth >= 60 && fresh > 10) {
    parts.push('🏔 Good snow base with recent snowfall.')
  } else if (depth >= 30) {
    parts.push('🌧 Adequate snow base, conditions may vary by piste.')
  } else {
    parts.push('⚠️ Thin snow cover — check resort status before visiting.')
  }

  // Temperature
  if (temp > 3) {
    parts.push('🌡 Warm temperatures — expect wet/slushy afternoon snow.')
  } else if (temp < -10) {
    parts.push('🥶 Very cold — dress in layers.')
  }

  // Wind
  if (wind > 60) {
    parts.push('💨 Strong winds — some lifts may be closed.')
  } else if (wind > 40) {
    parts.push('💨 Gusty winds — check lift status on arrival.')
  }

  // Avalanche
  if (avalancheLevel !== null && avalancheLevel >= 4) {
    parts.push('🔴 High avalanche danger — off-piste strongly discouraged.')
  } else if (avalancheLevel !== null && avalancheLevel === 3) {
    parts.push('🟡 Considerable avalanche risk — stay on marked pistes.')
  }

  // Rain
  if (rain > 50) {
    parts.push('🌧 Rain expected — snow line may be high.')
  }

  return parts.join(' ') || '—'
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function fmtInt(v: number | null, unit: string): string {
  if (v === null || isNaN(v)) return '—'
  return `${Math.round(v)} ${unit}`
}

function fmt1(v: number | null, unit: string): string {
  if (v === null || isNaN(v)) return '—'
  return `${v.toFixed(1)} ${unit}`
}

// ─── Leaflet map state ────────────────────────────────────────────────────────

let _skiMap: L.Map | null = null
let _skiMarkers: L.Marker[] = []

const STATUS_COLORS: Record<'open'|'partial'|'closed', string> = {
  open: '#22c55e',
  partial: '#f59e0b',
  closed: '#ef4444',
}

/** Create a coloured circle icon for a resort marker */
function skiIcon(color: string, selected: boolean): L.DivIcon {
  const size  = selected ? 18 : 13
  const border = selected ? '3px solid #fff' : '2px solid #fff'
  const shadow = selected ? '0 0 0 2px ' + color : 'none'
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:${border};
      box-shadow:${shadow};
      cursor:pointer;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// ─── Ski map renderer (Leaflet) ───────────────────────────────────────────────

function renderSkiMapLeaflet(
  resorts: SkiResortResult[],
  selected: SkiResortResult,
  wxData: Record<string, OpenMeteoResponse | null>,
  _avalancheRisk: AvalancheRisk | null,
  _lat: number,
  _lon: number,
  onSelect: (resort: SkiResortResult) => void,
) {
  const container = document.getElementById('skiMapContainer')
  if (!container) return

  // Compute status for each resort (shared wx data)
  const wx = wxData['ensemble'] ?? Object.values(wxData).find(v => v !== null) ?? null
  const hi = wx ? nowHourlyIndex(wx.hourly.time) : 0
  const sdRaw = wx?.hourly.snow_depth?.[hi]
  const sdCm = sdRaw != null ? sdRaw * 100 : null
  const tempNow = wx?.hourly.temperature_2m[hi] ?? null
  const rainNow = wx?.hourly.precipitation_probability[hi] ?? null

  function statusOf(_r: SkiResortResult): 'open' | 'partial' | 'closed' {
    return calcSkiStatus(sdCm, tempNow, rainNow)
  }

  if (!_skiMap) {
    // Initial map creation
    _skiMap = L.map(container, { zoomControl: true, attributionControl: false })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(_skiMap)

    // Fit bounds to all resorts
    if (resorts.length > 1) {
      const bounds = L.latLngBounds(resorts.map(r => [r.lat, r.lon]))
      _skiMap.fitBounds(bounds, { padding: [40, 40] })
    } else {
      _skiMap.setView([resorts[0].lat, resorts[0].lon], 10)
    }
  } else {
    // Map already exists — just clear markers
    _skiMarkers.forEach(m => m.remove())
    _skiMarkers = []
  }

  // (Re)add markers
  resorts.forEach(r => {
    const st = statusOf(r)
    const isSelected = r.id === selected.id
    const icon = skiIcon(STATUS_COLORS[st], isSelected)

    const marker = L.marker([r.lat, r.lon], { icon })
      .addTo(_skiMap!)
      .bindTooltip(r.name, { permanent: false, direction: 'top', offset: [0, -8] })

    marker.on('click', () => onSelect(r))
    _skiMarkers.push(marker)
  })
}

// ─── Detail panel renderer ────────────────────────────────────────────────────

function renderSkiDetail(
  _lat: number,
  _lon: number,
  sel: SkiResortResult,
  wxData: Record<string, OpenMeteoResponse | null>,
  avalancheRisk: AvalancheRisk | null,
  lang: any,
) {
  const container = document.getElementById('skiDetail')
  if (!container) return

  const wx = wxData['ensemble'] ?? Object.values(wxData).find(v => v !== null) ?? null
  const hi = wx ? nowHourlyIndex(wx.hourly.time) : 0

  const nowTemp      = wx?.hourly.temperature_2m[hi] ?? null
  const nowWind      = wx?.hourly.wind_speed_10m[hi] ?? null
  const nowRainPct   = wx?.hourly.precipitation_probability[hi] ?? null
  const snowDepthRaw = wx?.hourly.snow_depth?.[hi] ?? null
  const freshSnow24h = wx?.hourly.snowfall?.[hi] ?? null

  // snow_depth in Open-Meteo is in metres — convert to cm
  const snowDepthCm = snowDepthRaw !== null ? snowDepthRaw * 100 : null

  // 7-day accumulated fresh snow estimate
  let freshSnow7d: number | null = null
  if (wx?.hourly.snowfall) {
    const arr = wx.hourly.snowfall
    freshSnow7d = arr.slice(0, Math.min(168, arr.length))
      .reduce((s: number, v) => s + (v ?? 0), 0)
    freshSnow7d = Math.round(freshSnow7d)
  }

  // Elevation-based estimates
  const baseAlt   = state.currentLoc?.elevation ?? 0
  const summitAlt = sel.eleMax ?? (baseAlt + 1000)
  const summitTemp   = nowTemp !== null ? lapseRateTemp(nowTemp, baseAlt, summitAlt) : null
  const windSummit   = nowWind !== null ? nowWind * 1.3 : null

  const snowQuality = calcSnowQuality(freshSnow24h, nowTemp)
  const status      = calcSkiStatus(snowDepthCm, nowTemp, nowRainPct)
  const summary     = calcSkiSummary(
    snowDepthCm, freshSnow24h, avalancheRisk?.level ?? null,
    windSummit, summitTemp, nowRainPct, lang,
  )

  const statusLabel = status === 'open'
    ? lang.skiStatusOpen
    : status === 'partial' ? lang.skiStatusPartial : lang.skiStatusClosed

  const sqLabels: Record<SnowQuality, string> = {
    powder:      lang.snowQualityPowder,
    freshPowder: lang.snowQualityFreshPowder,
    packedPowder:lang.snowQualityPackedPowder,
    packed:      lang.snowQualityPacked,
    wetSlush:    lang.snowQualityWetSlush,
  }

  const avaLevels: Record<number, string> = {
    1: lang.avalancheLevel1, 2: lang.avalancheLevel2, 3: lang.avalancheLevel3,
    4: lang.avalancheLevel4, 5: lang.avalancheLevel5,
  }
  const avaLabel = avalancheRisk
    ? `Level ${avalancheRisk.level} — ${avaLevels[avalancheRisk.level] ?? ''}`
    : 'N/A'
  const avaColor = avalancheRisk?.color ?? '#999'

  const liveLink = sel.website
    ? `<a href="${sel.website}" target="_blank" rel="noopener" class="live-status-link">
        ${lang.checkLiveStatus}
       </a>`
    : ''

  const eleStr = (sel.eleMin && sel.eleMax)
    ? `↑ ${sel.eleMax}m ↓ ${sel.eleMin}m`
    : sel.eleMax ? `↑ ${sel.eleMax}m` : ''

  container.innerHTML = `
    <div class="ski-detail-name">${sel.name}</div>
    <div class="ski-badges">
      <span class="ski-badge status-${status}">${statusLabel}</span>
      ${eleStr ? `<span class="ski-elevation">${eleStr}</span>` : ''}
    </div>
    <div class="ski-detail-grid">
      <div class="ski-detail-row">
        <span class="detail-label">❄️ ${lang.snowDepth}</span>
        <span class="detail-value">${fmtInt(snowDepthCm, 'cm')}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">🌨 ${lang.freshSnow24h}</span>
        <span class="detail-value">${fmt1(freshSnow24h, 'cm')}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">🌨 ${lang.freshSnow7d}</span>
        <span class="detail-value">${fmtInt(freshSnow7d, 'cm')}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">🏔 ${lang.snowQuality}</span>
        <span class="detail-value">${sqLabels[snowQuality]}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">🌡 ${lang.baseTemp}</span>
        <span class="detail-value">${fmtInt(nowTemp, '°C')}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">🌡 ${lang.summitTemp}</span>
        <span class="detail-value">${fmtInt(summitTemp, '°C')} ${eleStr ? `(${summitAlt}m)` : ''}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">💨 ${lang.windSummit}</span>
        <span class="detail-value">${fmtInt(windSummit, 'km/h')}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">🌧 Rain prob.</span>
        <span class="detail-value">${fmtInt(nowRainPct, '%')}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">⚠️ ${lang.avalancheRisk}</span>
        <span class="detail-value ava-badge" style="color:${avaColor}">${avaLabel}</span>
      </div>
    </div>
    ${liveLink}
    <div class="ski-summary-card">
      <div class="ski-summary-title">${lang.skiSummaryTitle}</div>
      <div class="ski-summary-text">${summary}</div>
    </div>`
}

// ─── Main renderer ───────────────────────────────────────────────────────────

export function renderSkiPage(
  lat: number,
  lon: number,
  resorts: SkiResortResult[],
  wxData: Record<string, OpenMeteoResponse | null>,
  avalancheRisk: AvalancheRisk | null,
) {
  const el = document.getElementById('pageSki')
  if (!el) return

  const lang = LANG_DATA[state.lang] ?? LANG_DATA.en

  if (!resorts.length) {
    // Destroy map if it exists
    if (_skiMap) { _skiMap.remove(); _skiMap = null; _skiMarkers = [] }

    el.innerHTML = `
      <div class="section-header">
        <h2>${lang.skiTitle}</h2>
        <span class="section-radius">${lang.skiRadius}</span>
      </div>
      <div class="empty-state">${lang.noSkiFound}</div>`
    return
  }

  // Ensure selection is valid
  if (!state.selectedSkiResort || !resorts.find(r => r.id === state.selectedSkiResort!.id)) {
    state.selectedSkiResort = resorts[0]
  }
  const sel = state.selectedSkiResort

  // Scaffold HTML — map container + detail panel
  el.innerHTML = `
    <div class="section-header">
      <h2>${lang.skiTitle}</h2>
      <span class="section-radius">${lang.skiRadius}</span>
    </div>
    <div id="skiMapContainer" class="ski-map-container"></div>
    <p class="ski-map-hint">Click a resort on the map to see details</p>
    <div id="skiDetail" class="ski-detail-panel"></div>`

  /** Select a resort, update markers + detail panel */
  function selectResort(resort: SkiResortResult) {
    state.selectedSkiResort = resort
    renderSkiDetail(lat, lon, resort, wxData, avalancheRisk, lang)
    // Refresh markers to update selected highlight
    renderSkiMapLeaflet(resorts, resort, wxData, avalancheRisk, lat, lon, selectResort)
  }

  // Render Leaflet map with markers
  renderSkiMapLeaflet(resorts, sel, wxData, avalancheRisk, lat, lon, selectResort)

  // Render initial detail panel
  renderSkiDetail(lat, lon, sel, wxData, avalancheRisk, lang)
}

/** Call this when navigating away from the ski page to clean up the Leaflet instance */
export function destroySkiMap() {
  if (_skiMap) {
    _skiMap.remove()
    _skiMap = null
    _skiMarkers = []
  }
}
