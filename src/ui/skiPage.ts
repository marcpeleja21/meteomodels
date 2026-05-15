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

  if (depth >= 100 && fresh > 20) {
    parts.push('❄️ Excellent snowpack with recent fresh powder.')
  } else if (depth >= 60 && fresh > 10) {
    parts.push('🏔 Good snow base with recent snowfall.')
  } else if (depth >= 30) {
    parts.push('🌧 Adequate snow base, conditions may vary by piste.')
  } else {
    parts.push('⚠️ Thin snow cover — check resort status before visiting.')
  }

  if (temp > 3) {
    parts.push('🌡 Warm temperatures — expect wet/slushy afternoon snow.')
  } else if (temp < -10) {
    parts.push('🥶 Very cold — dress in layers.')
  }

  if (wind > 60) {
    parts.push('💨 Strong winds — some lifts may be closed.')
  } else if (wind > 40) {
    parts.push('💨 Gusty winds — check lift status on arrival.')
  }

  if (avalancheLevel !== null && avalancheLevel >= 4) {
    parts.push('🔴 High avalanche danger — off-piste strongly discouraged.')
  } else if (avalancheLevel !== null && avalancheLevel === 3) {
    parts.push('🟡 Considerable avalanche risk — stay on marked pistes.')
  }

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
let _skiMarkers: L.CircleMarker[] = []
let _renderer: L.Canvas | null = null

// ─── Marker renderer ─────────────────────────────────────────────────────────

function renderSkiWorldMarkers(
  resorts: SkiResortResult[],
  top3Ids: Set<string>,
  selectedId: string | null,
  onSelect: (resort: SkiResortResult) => void,
) {
  if (!_skiMap || !_renderer) return

  // Remove existing resort markers
  _skiMarkers.forEach(m => m.remove())
  _skiMarkers = []

  resorts.forEach(r => {
    const isSelected = r.id === selectedId
    const isTop3     = top3Ids.has(r.id)

    let fillColor: string
    let radius: number
    let weight: number

    if (isSelected) {
      fillColor = '#f59e0b'  // amber
      radius    = 8
      weight    = 2
    } else if (isTop3) {
      fillColor = '#3b82f6'  // blue
      radius    = 5
      weight    = 1
    } else {
      fillColor = '#6b7280'  // gray
      radius    = 3
      weight    = 1
    }

    const marker = L.circleMarker([r.lat, r.lon], {
      renderer:    _renderer!,
      radius,
      color:       '#fff',
      weight,
      fillColor,
      fillOpacity: isSelected ? 0.95 : isTop3 ? 0.85 : 0.65,
    })
      .addTo(_skiMap!)
      .bindTooltip(r.name, { permanent: false, direction: 'top', offset: [0, -4] })

    marker.on('click', () => onSelect(r))
    _skiMarkers.push(marker)
  })
}

// ─── Detail panel renderer ────────────────────────────────────────────────────

function renderSkiDetail(
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
  const baseAlt    = state.currentLoc?.elevation ?? 0
  const summitAlt  = sel.eleMax ?? (baseAlt + 1000)
  const summitTemp = nowTemp !== null ? lapseRateTemp(nowTemp, baseAlt, summitAlt) : null
  const windSummit = nowWind !== null ? nowWind * 1.3 : null

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
    powder:       lang.snowQualityPowder,
    freshPowder:  lang.snowQualityFreshPowder,
    packedPowder: lang.snowQualityPackedPowder,
    packed:       lang.snowQualityPacked,
    wetSlush:     lang.snowQualityWetSlush,
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

/**
 * Render the Ski page.
 *
 * Shows a world map with ALL ski resort markers.
 * If a user location is supplied, the top-3 closest resorts are highlighted
 * in blue and listed as quick-access cards below the map.
 * Clicking any marker (or a top-3 card) opens the detail panel.
 *
 * @param resorts     All ski resorts (sorted by distance when location known)
 * @param wxData      Weather data keyed by model name
 * @param avalancheRisk EAWS avalanche risk (may be null)
 * @param currentLat  Optional user latitude (used to centre map + sort top-3)
 * @param currentLon  Optional user longitude
 */
export function renderSkiPage(
  resorts: SkiResortResult[],
  wxData: Record<string, OpenMeteoResponse | null>,
  avalancheRisk: AvalancheRisk | null,
  currentLat?: number,
  currentLon?: number,
) {
  const elRaw = document.getElementById('pageSki')
  if (!elRaw) return
  const el = elRaw

  // Always destroy any existing Leaflet instance before replacing DOM
  if (_skiMap) { _skiMap.remove(); _skiMap = null; _skiMarkers = []; _renderer = null }

  const lang   = LANG_DATA[state.lang] ?? LANG_DATA.en
  const hasLoc = currentLat != null && currentLon != null

  // Top-3 resorts (resorts already sorted by distance from fetchAllSkiResorts when refLat/refLon given)
  const top3    = hasLoc ? resorts.slice(0, 3) : []
  const top3Ids = new Set(top3.map(r => r.id))

  const top3Html = top3.length > 0 ? `
    <div class="ski-top3-section">
      <h3 class="ski-top3-title">📍 ${lang.skiTop3Title}</h3>
      <div class="ski-top3-grid">
        ${top3.map(r => `
          <button class="ski-top3-card" data-id="${r.id}">
            <span class="ski-top3-name">${r.name}</span>
            <span class="ski-top3-dist">${r.distKm.toFixed(0)} km</span>
            ${r.eleMax ? `<span class="ski-top3-ele">↑ ${r.eleMax}m</span>` : ''}
          </button>`).join('')}
      </div>
    </div>` : ''

  el.innerHTML = `
    <div class="section-header">
      <h2>${lang.skiTitle}</h2>
      <span class="section-radius">${lang.skiRadius}</span>
    </div>
    <p class="ski-map-hint">🗺 ${lang.skiWorldMapHint}</p>
    <div id="skiMapContainer" class="ski-map-container"></div>
    ${top3Html}
    <div id="skiDetail" class="ski-detail-panel"></div>`

  // ── Leaflet world map ──────────────────────────────────────────────────────
  const mapContainer = document.getElementById('skiMapContainer')!
  const initLat  = currentLat ?? 46.5
  const initLon  = currentLon ?? 8.5
  const initZoom = hasLoc ? 6 : 4

  _skiMap    = L.map(mapContainer, { zoomControl: true, attributionControl: false })
    .setView([initLat, initLon], initZoom)
  _renderer  = L.canvas({ padding: 0.5 })

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 })
    .addTo(_skiMap)

  // Blue dot for user location
  if (hasLoc) {
    L.circleMarker([currentLat!, currentLon!], {
      radius: 9, color: '#fff', weight: 2,
      fillColor: '#3b82f6', fillOpacity: 0.85,
    }).addTo(_skiMap)
      .bindTooltip('📍 Your location', { permanent: false, direction: 'top' })
  }

  // ── Resort selection logic ─────────────────────────────────────────────────
  if (!state.selectedSkiResort && top3.length > 0) {
    state.selectedSkiResort = top3[0]
  }

  function selectResort(resort: SkiResortResult) {
    state.selectedSkiResort = resort
    renderSkiDetail(resort, wxData, avalancheRisk, lang)
    renderSkiWorldMarkers(resorts, top3Ids, resort.id, selectResort)
    // Update active state on top-3 cards
    el.querySelectorAll<HTMLButtonElement>('.ski-top3-card').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.id === resort.id)
    })
  }

  // Wire top-3 card clicks
  el.querySelectorAll<HTMLButtonElement>('.ski-top3-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = resorts.find(x => x.id === btn.dataset.id)
      if (r) selectResort(r)
    })
  })

  // Render all markers on the world map
  if (resorts.length > 0) {
    renderSkiWorldMarkers(
      resorts,
      top3Ids,
      state.selectedSkiResort?.id ?? null,
      selectResort,
    )
  }

  // Render initial detail panel + highlight initial top-3 card
  if (state.selectedSkiResort && resorts.length > 0) {
    renderSkiDetail(state.selectedSkiResort, wxData, avalancheRisk, lang)
    el.querySelectorAll<HTMLButtonElement>('.ski-top3-card').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.id === state.selectedSkiResort?.id)
    })
  }
}

/** Call this when navigating away from the ski page to clean up the Leaflet instance */
export function destroySkiMap() {
  if (_skiMap) {
    _skiMap.remove()
    _skiMap = null
    _skiMarkers = []
    _renderer   = null
  }
}
