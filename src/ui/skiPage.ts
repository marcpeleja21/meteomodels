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

  // Get ensemble weather
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
  const baseAlt = state.currentLoc?.elevation ?? 0
  const summitAlt = sel.eleMax ?? (baseAlt + 1000)
  const summitTemp = nowTemp !== null ? lapseRateTemp(nowTemp, baseAlt, summitAlt) : null
  const windSummit = nowWind !== null ? nowWind * 1.3 : null  // rough estimate: 30% more at summit

  const snowQuality = calcSnowQuality(freshSnow24h, nowTemp)
  const status      = calcSkiStatus(snowDepthCm, nowTemp, nowRainPct)
  const summary     = calcSkiSummary(
    snowDepthCm, freshSnow24h, avalancheRisk?.level ?? null,
    windSummit, summitTemp, nowRainPct, lang,
  )

  // Status label
  const statusLabel = status === 'open'
    ? lang.skiStatusOpen
    : status === 'partial' ? lang.skiStatusPartial : lang.skiStatusClosed

  // Snow quality label
  const sqLabels: Record<SnowQuality, string> = {
    powder:      lang.snowQualityPowder,
    freshPowder: lang.snowQualityFreshPowder,
    packedPowder:lang.snowQualityPackedPowder,
    packed:      lang.snowQualityPacked,
    wetSlush:    lang.snowQualityWetSlush,
  }

  // Avalanche badge
  const avaLevels: Record<number, string> = {
    1: lang.avalancheLevel1, 2: lang.avalancheLevel2, 3: lang.avalancheLevel3,
    4: lang.avalancheLevel4, 5: lang.avalancheLevel5,
  }
  const avaLabel = avalancheRisk
    ? `Level ${avalancheRisk.level} — ${avaLevels[avalancheRisk.level] ?? ''}`
    : 'N/A'
  const avaColor = avalancheRisk?.color ?? '#999'

  // Live status link
  const liveLink = sel.website
    ? `<a href="${sel.website}" target="_blank" rel="noopener" class="live-status-link">
        ${lang.checkLiveStatus}
       </a>`
    : ''

  // Elevation display
  const eleStr = (sel.eleMin && sel.eleMax)
    ? `↑ ${sel.eleMax}m ↓ ${sel.eleMin}m`
    : sel.eleMax ? `↑ ${sel.eleMax}m` : ''

  // Resort list
  const listItems = resorts.map(r => {
    const active = r.id === sel.id ? ' active' : ''
    const distStr = r.distKm < 10 ? `${r.distKm.toFixed(1)} km` : `${Math.round(r.distKm)} km`
    // Quick status colour dot for list
    const wx2 = wxData['ensemble'] ?? Object.values(wxData).find(v => v !== null) ?? null
    const hi2 = wx2 ? nowHourlyIndex(wx2.hourly.time) : 0
    const sd2 = wx2?.hourly.snow_depth?.[hi2]
    const sdCm2 = sd2 != null ? sd2 * 100 : null
    const st2 = calcSkiStatus(sdCm2, wx2?.hourly.temperature_2m[hi2] ?? null, wx2?.hourly.precipitation_probability[hi2] ?? null)
    const dot = st2 === 'open' ? '🟢' : st2 === 'partial' ? '🟡' : '🔴'
    return `<div class="ski-list-item${active}" data-resort-id="${r.id}">
      <span class="ski-dot">${dot}</span>
      <span class="ski-name">${r.name}</span>
      <span class="ski-dist">${distStr}</span>
    </div>`
  }).join('')

  el.innerHTML = `
    <div class="section-header">
      <h2>${lang.skiTitle}</h2>
      <span class="section-radius">${lang.skiRadius}</span>
    </div>
    <div class="ski-layout">
      <div class="ski-list" id="skiList">${listItems}</div>
      <div class="ski-detail">
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
      </div>
    </div>
    <div id="skiMapCard" class="ski-map-section"></div>
    <div class="ski-summary-card">
      <div class="ski-summary-title">${lang.skiSummaryTitle}</div>
      <div class="ski-summary-text">${summary}</div>
    </div>`

  // Click handlers
  el.querySelectorAll('.ski-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = (item as HTMLElement).dataset.resortId
      const resort = resorts.find(r => r.id === id)
      if (resort) {
        state.selectedSkiResort = resort
        renderSkiPage(lat, lon, resorts, wxData, avalancheRisk)
        renderSkiMap(resort)
      }
    })
  })

  renderSkiMap(sel)
}

function renderSkiMap(sel: SkiResortResult) {
  const container = document.getElementById('skiMapCard')
  if (!container) return

  container.innerHTML = `
    <div class="media-card">
      <div class="media-label">📍 ${sel.name}</div>
      <iframe
        src="https://www.openstreetmap.org/export/embed.html?bbox=${sel.lon - 0.12},${sel.lat - 0.06},${sel.lon + 0.12},${sel.lat + 0.06}&layer=mapnik&marker=${sel.lat},${sel.lon}"
        class="ski-map-iframe"
        title="Resort map"
        loading="lazy"
      ></iframe>
    </div>`
}
