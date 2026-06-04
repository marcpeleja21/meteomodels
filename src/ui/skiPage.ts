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

// ─── Per-resort weather cache & fetch ────────────────────────────────────────
//
// We fetch Open-Meteo AT THE RESORT'S COORDINATES so the temperature,
// snow depth, and wind reflect actual mountain conditions rather than
// the user's searched city weather.

const _resortWxCache = new Map<string, OpenMeteoResponse>()

async function fetchResortWeather(resort: SkiResortResult): Promise<OpenMeteoResponse | null> {
  if (_resortWxCache.has(resort.id)) return _resortWxCache.get(resort.id)!

  try {
    const params = new URLSearchParams({
      latitude:      String(resort.lat),
      longitude:     String(resort.lon),
      hourly:        [
        'temperature_2m',
        'wind_speed_10m',
        'wind_gusts_10m',
        'precipitation_probability',
        'snow_depth',
        'snowfall',
        'weather_code',
      ].join(','),
      daily: [
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'precipitation_probability_max',
        'weather_code',
        'wind_speed_10m_max',
        'wind_gusts_10m_max',
      ].join(','),
      timezone:      'auto',
      forecast_days: '3',
      // No models= param → Open-Meteo default routing (best available for location).
      // Explicit models=best_match was found to return 504 on the free tier.
    })
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
    if (!res.ok) return null
    const json = await res.json()
    if (json.error) return null
    _resortWxCache.set(resort.id, json as OpenMeteoResponse)
    return json as OpenMeteoResponse
  } catch {
    return null
  }
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

  _skiMarkers.forEach(m => m.remove())
  _skiMarkers = []

  resorts.forEach(r => {
    const isSelected = r.id === selectedId
    const isTop3     = top3Ids.has(r.id)

    let fillColor: string
    let radius: number
    let weight: number

    if (isSelected) {
      fillColor = '#f59e0b'
      radius    = 8
      weight    = 2
    } else if (isTop3) {
      fillColor = '#3b82f6'
      radius    = 5
      weight    = 1
    } else {
      fillColor = '#6b7280'
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
//
// Takes weather data fetched specifically for the resort's lat/lon so that
// temperature, wind, and snow figures reflect the mountain, not the user's city.

function renderSkiDetail(
  sel: SkiResortResult,
  resortWx: OpenMeteoResponse | null,
  avalancheRisk: AvalancheRisk | null,
  lang: any,
) {
  const container = document.getElementById('skiDetail')
  if (!container) return

  const hi = resortWx ? nowHourlyIndex(resortWx.hourly.time) : 0

  const nowTemp      = resortWx?.hourly.temperature_2m[hi] ?? null
  const nowWind      = resortWx?.hourly.wind_speed_10m[hi] ?? null
  const nowRainPct   = resortWx?.hourly.precipitation_probability[hi] ?? null
  const snowDepthRaw = resortWx?.hourly.snow_depth?.[hi] ?? null
  const freshSnow24h = resortWx?.hourly.snowfall?.[hi] ?? null

  // snow_depth from Open-Meteo is in metres → cm
  const snowDepthCm = snowDepthRaw !== null ? snowDepthRaw * 100 : null

  // 3-day accumulated fresh snow
  let freshSnow3d: number | null = null
  if (resortWx?.hourly.snowfall) {
    const arr = resortWx.hourly.snowfall
    freshSnow3d = arr.slice(0, Math.min(72, arr.length))
      .reduce((s: number, v) => s + (v ?? 0), 0)
    freshSnow3d = Math.round(freshSnow3d * 10) / 10
  }

  // Summit temperature via lapse rate:
  // nowTemp is AT the resort coordinates (roughly base elevation).
  // We estimate summit by applying −6.5 °C / 1 000 m lapse rate.
  const baseAlt    = sel.eleMin ?? 1000          // resort base or reasonable default
  const summitAlt  = sel.eleMax ?? baseAlt + 800
  const summitTemp = nowTemp !== null && sel.eleMax
    ? lapseRateTemp(nowTemp, baseAlt, summitAlt)
    : null
  const windSummit = nowWind !== null ? nowWind * 1.3 : null

  const snowQuality = calcSnowQuality(freshSnow24h, nowTemp)
  const status      = calcSkiStatus(snowDepthCm, nowTemp, nowRainPct)
  const summary     = calcSkiSummary(
    snowDepthCm, freshSnow24h, avalancheRisk?.level ?? null,
    windSummit, summitTemp ?? nowTemp, nowRainPct, lang,
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
        <span class="detail-value">${freshSnow3d != null ? fmt1(freshSnow3d, 'cm') + ' (3d)' : '—'}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">🏔 ${lang.snowQuality}</span>
        <span class="detail-value">${sqLabels[snowQuality]}</span>
      </div>
      <div class="ski-detail-row">
        <span class="detail-label">🌡 ${lang.baseTemp}</span>
        <span class="detail-value">${fmtInt(nowTemp, '°C')}</span>
      </div>
      ${summitTemp !== null ? `
      <div class="ski-detail-row">
        <span class="detail-label">🌡 ${lang.summitTemp}</span>
        <span class="detail-value">${fmtInt(summitTemp, '°C')} (${summitAlt}m)</span>
      </div>` : ''}
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
  resorts: SkiResortResult[],
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

  // Top-3 closest resorts (resorts are pre-sorted by distance when refLat/refLon were given)
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

  _skiMap   = L.map(mapContainer, { zoomControl: true, attributionControl: false })
    .setView([initLat, initLon], initZoom)
  _renderer = L.canvas({ padding: 0.5 })

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 })
    .addTo(_skiMap)

  if (hasLoc) {
    L.circleMarker([currentLat!, currentLon!], {
      radius: 9, color: '#fff', weight: 2,
      fillColor: '#3b82f6', fillOpacity: 0.85,
    }).addTo(_skiMap)
      .bindTooltip('📍 Your location', { permanent: false, direction: 'top' })
  }

  // ── Resort selection ──────────────────────────────────────────────────────

  if (!state.selectedSkiResort && top3.length > 0) {
    state.selectedSkiResort = top3[0]
  }

  async function selectResort(resort: SkiResortResult) {
    state.selectedSkiResort = resort

    // Highlight marker and top-3 card immediately
    renderSkiWorldMarkers(resorts, top3Ids, resort.id, selectResort)
    el.querySelectorAll<HTMLButtonElement>('.ski-top3-card').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.id === resort.id)
    })

    // Show loading placeholder in detail panel
    const detailEl = document.getElementById('skiDetail')
    if (detailEl) {
      detailEl.innerHTML = `<div class="loading-inline ski-loading">
        ⛷️ Loading weather for <strong>${resort.name}</strong>…
      </div>`
    }

    // Fetch weather AT the resort's coordinates (accurate mountain data)
    const resortWx = await fetchResortWeather(resort)
    renderSkiDetail(resort, resortWx, avalancheRisk, lang)
  }

  // Wire top-3 card clicks
  el.querySelectorAll<HTMLButtonElement>('.ski-top3-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = resorts.find(x => x.id === btn.dataset.id)
      if (r) selectResort(r)
    })
  })

  // Render all resort markers
  if (resorts.length > 0) {
    renderSkiWorldMarkers(
      resorts,
      top3Ids,
      state.selectedSkiResort?.id ?? null,
      selectResort,
    )
  }

  // Auto-load detail for initially selected resort
  if (state.selectedSkiResort && resorts.length > 0) {
    selectResort(state.selectedSkiResort)
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
