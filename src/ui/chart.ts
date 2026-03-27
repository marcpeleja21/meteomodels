/**
 * chart.ts — Professional weather chart inspired by Meteomatics design:
 * smooth Catmull-Rom curves, filled dots, inline value labels,
 * day-column backgrounds, gradient fills, ensemble band, floating tooltip.
 */

import { state } from '../state'
import { MODELS } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import type { LangData } from '../types'

// ── SVG canvas constants ───────────────────────────────────────────────────────
const W   = 900
const H   = 320
const PAD = { top: 44, right: 20, bottom: 44, left: 48 }
const CHART_W = W - PAD.left - PAD.right
const CHART_H = H - PAD.top  - PAD.bottom

// Show 5 days × 24 h = 120 hourly points; subsample every 3rd for performance
const HOURS = 5 * 24          // 120
const STEP  = 3               // render every 3rd → 40 points
const N_PTS = HOURS / STEP    // 40

type MetricKey = 'temp' | 'precip' | 'rain' | 'wind' | 'hum' | 'pres'

interface MetricDef {
  unit:  string
  label: string
  color: string
  isBar?: boolean   // use bar chart style (precipitation)
  /** Returns the raw hourly value for model `k` at raw hourly index `i` */
  src:   (k: string, i: number) => number | null
  /** Smart Y-axis tick rounding step */
  tick:  number
}

// ── Catmull-Rom → cubic Bézier smooth path ────────────────────────────────────
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

// ── Smart Y-axis tick computation ─────────────────────────────────────────────
function smartTicks(lo: number, hi: number, step: number, count = 6): number[] {
  const niceMin = Math.floor(lo / step) * step
  const niceMax = Math.ceil(hi  / step) * step
  const range   = niceMax - niceMin || step
  const rawStep = range / (count - 1)
  const niceSt  = Math.max(step, Math.ceil(rawStep / step) * step)
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + 1e-9; v += niceSt) {
    ticks.push(Math.round(v / step) * step)
  }
  return ticks
}

// ── Build metric definitions ───────────────────────────────────────────────────
function buildMetrics(t: LangData): Record<MetricKey, MetricDef> {
  return {
    temp:   {
      unit: '°C',   label: t.mTemp,     color: '#ff7043', tick: 5,
      src: (k, i) => state.wxData[k]?.hourly.temperature_2m[i]            ?? null,
    },
    precip: {
      unit: 'mm',   label: t.statPrecip, color: '#29b6f6', tick: 1, isBar: true,
      src: (k, i) => state.wxData[k]?.hourly.precipitation[i]             ?? null,
    },
    rain:   {
      unit: '%',    label: t.mRain,      color: '#4dd0e1', tick: 10,
      src: (k, i) => state.wxData[k]?.hourly.precipitation_probability[i] ?? null,
    },
    wind:   {
      unit: 'km/h', label: t.mWind,      color: '#aed581', tick: 5,
      src: (k, i) => state.wxData[k]?.hourly.windspeed_10m[i]             ?? null,
    },
    hum:    {
      unit: '%',    label: t.mHum,       color: '#90caf9', tick: 10,
      src: (k, i) => state.wxData[k]?.hourly.relative_humidity_2m[i]     ?? null,
    },
    pres:   {
      unit: 'hPa',  label: t.mPres,      color: '#ce93d8', tick: 10,
      src: (k, i) => state.wxData[k]?.hourly.pressure_msl[i]             ?? null,
    },
  }
}

// ── Main export ────────────────────────────────────────────────────────────────
export function renderChart(onMetricChange?: (key: string) => void) {
  const t       = LANG_DATA[state.lang]
  const metrics = buildMetrics(t)
  const el      = document.getElementById('chartCard')!

  if (!(state.activeMetric in metrics)) state.activeMetric = 'temp'

  const loaded = MODELS.filter(m => state.wxData[m.key] != null)
  if (!loaded.length) { el.innerHTML = ''; return }

  const metricKey = state.activeMetric as MetricKey
  const metric    = metrics[metricKey]
  const isTemp    = metricKey === 'temp'
  const isBar     = !!metric.isBar

  // ── Reference time axis ────────────────────────────────────────────────────
  const refHourly = state.wxData[loaded[0].key]!.hourly.time
  const timePts: string[] = []
  for (let s = 0; s < N_PTS; s++) {
    timePts.push(refHourly[s * STEP] ?? '')
  }

  // ── Collect all values for Y scale ────────────────────────────────────────
  const allVals: number[] = []
  for (const m of loaded) {
    for (let s = 0; s < N_PTS; s++) {
      const v = metric.src(m.key, s * STEP)
      if (v !== null) allVals.push(v)
    }
  }
  if (!allVals.length) { el.innerHTML = ''; return }

  const rawMin = Math.min(...allVals)
  const rawMax = Math.max(...allVals)
  const pad    = (rawMax - rawMin) * 0.12 || 2
  const domMin = isBar ? 0 : rawMin - pad
  const domMax = rawMax + pad

  // ── Scale helpers ──────────────────────────────────────────────────────────
  function scaleX(s: number): number {
    return PAD.left + (s / (N_PTS - 1)) * CHART_W
  }
  function scaleY(v: number): number {
    return PAD.top + CHART_H - ((v - domMin) / (domMax - domMin)) * CHART_H
  }
  const baseline = PAD.top + CHART_H  // y coordinate of bottom axis

  // ── Points per model ──────────────────────────────────────────────────────
  const modelPts: Map<string, [number, number][]> = new Map()
  for (const m of loaded) {
    const pts: [number, number][] = []
    for (let s = 0; s < N_PTS; s++) {
      const v = metric.src(m.key, s * STEP)
      if (v !== null) pts.push([scaleX(s), scaleY(v)])
    }
    modelPts.set(m.key, pts)
  }

  // ── Day background bands (alternating subtle shading) ─────────────────────
  // Identify day boundaries: positions where hour === 0
  const dayBounds: number[] = [PAD.left]   // x positions of day starts
  for (let s = 0; s < N_PTS; s++) {
    const ts = timePts[s]
    if (!ts) continue
    const hour = parseInt(ts.slice(11, 13), 10)
    if (hour === 0 && s > 0) dayBounds.push(scaleX(s))
  }
  dayBounds.push(PAD.left + CHART_W)  // end

  let dayBands = ''
  for (let i = 0; i < dayBounds.length - 1; i++) {
    const x = dayBounds[i]
    const w = dayBounds[i + 1] - x
    // Alternate between two very subtle shades
    const fill = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.0)'
    dayBands += `<rect x="${x.toFixed(1)}" y="${PAD.top}" width="${w.toFixed(1)}" height="${CHART_H}"
      fill="${fill}"/>`
  }

  // ── Day separators + headers ───────────────────────────────────────────────
  let daySeparators = ''
  let dayLabels     = ''
  for (let s = 0; s < N_PTS; s++) {
    const ts = timePts[s]
    if (!ts) continue
    const hour = parseInt(ts.slice(11, 13), 10)
    if (hour === 0 && s > 0) {
      const x = scaleX(s)
      daySeparators += `<line x1="${x.toFixed(1)}" y1="${PAD.top - 12}" x2="${x.toFixed(1)}" y2="${PAD.top + CHART_H}"
        stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`
      const dateStr = ts.slice(0, 10)
      const d       = new Date(dateStr + 'T12:00:00')
      const dayName = t.days[d.getDay()]
      const dayNum  = d.getDate()
      // Day header pill above the chart area
      dayLabels += `<text x="${x.toFixed(1)}" y="${PAD.top - 16}"
        fill="rgba(160,195,225,0.8)" font-size="10" font-weight="600" text-anchor="middle">${dayName} ${dayNum}</text>`
    }
  }

  // Add "Today" label at the start
  if (timePts[0]) {
    const midX = (PAD.left + (dayBounds[1] ?? PAD.left + CHART_W)) / 2
    dayLabels = `<text x="${midX.toFixed(1)}" y="${PAD.top - 16}"
      fill="rgba(0,210,230,0.9)" font-size="10" font-weight="700" text-anchor="middle">${t.today ?? 'Today'}</text>` + dayLabels
  }

  // ── Current-hour indicator ─────────────────────────────────────────────────
  let nowLine = ''
  {
    const now = new Date()
    let bestS = -1, bestDiff = Infinity
    for (let s = 0; s < N_PTS; s++) {
      const ts = timePts[s]
      if (!ts) continue
      const diff = Math.abs(new Date(ts).getTime() - now.getTime())
      if (diff < bestDiff) { bestDiff = diff; bestS = s }
    }
    if (bestS >= 0 && bestDiff < 2 * 3600 * 1000) {
      const x = scaleX(bestS)
      nowLine = `
        <line x1="${x.toFixed(1)}" y1="${PAD.top - 12}" x2="${x.toFixed(1)}" y2="${PAD.top + CHART_H}"
          stroke="#00e5ff" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.75"/>
        <text x="${x.toFixed(1)}" y="${PAD.top - 18}"
          fill="#00e5ff" font-size="9" font-weight="700" text-anchor="middle" opacity="0.95">${t.now ?? 'Now'}</text>`
    }
  }

  // ── Temperature ensemble band ──────────────────────────────────────────────
  let bandPath = ''
  let meanPath = ''
  let gradFillPath = ''
  const meanPtsForLabels: Array<{ x: number; y: number; v: number; s: number }> = []

  if (isTemp) {
    const bandMaxPts: [number, number][] = []
    const bandMinPts: [number, number][] = []
    const meanPts:    [number, number][] = []

    for (let s = 0; s < N_PTS; s++) {
      const vals = loaded.map(m => metric.src(m.key, s * STEP)).filter(v => v !== null) as number[]
      if (!vals.length) continue
      const bMax = Math.max(...vals)
      const bMin = Math.min(...vals)
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      const x    = scaleX(s)
      bandMaxPts.push([x, scaleY(bMax)])
      bandMinPts.push([x, scaleY(bMin)])
      meanPts.push([x, scaleY(mean)])
      meanPtsForLabels.push({ x, y: scaleY(mean), v: mean, s })
    }

    if (bandMaxPts.length > 1) {
      const fwd    = smoothPath(bandMaxPts)
      const revMin = [...bandMinPts].reverse()
      const revPts = revMin.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')
      bandPath = `<path d="${fwd} L ${revPts} Z" fill="rgba(255,150,50,0.07)" stroke="none"/>`
    }

    if (meanPts.length > 1) {
      const md = smoothPath(meanPts)
      meanPath = `<path d="${md}" fill="none" stroke="rgba(255,120,60,0.5)"
        stroke-width="1.5" stroke-dasharray="6,3" stroke-linecap="round"/>`

      const lastX  = meanPts[meanPts.length - 1][0].toFixed(1)
      const firstX = meanPts[0][0].toFixed(1)
      gradFillPath = `<path d="${md} L ${lastX},${baseline} L ${firstX},${baseline} Z"
        fill="url(#tempGrad)" stroke="none"/>`
    }
  }

  // ── Bar chart (precipitation) ──────────────────────────────────────────────
  let barSvg = ''
  if (isBar) {
    const barSlotW = CHART_W / N_PTS
    const nModels  = loaded.length
    const barW     = Math.max(2, Math.min(8, barSlotW / (nModels + 0.5)))
    const groupW   = barW * nModels + (nModels - 1) * 1

    for (let s = 0; s < N_PTS; s++) {
      const x = scaleX(s)
      loaded.forEach((m, mi) => {
        const v = metric.src(m.key, s * STEP)
        if (!v || v <= 0) return
        const y    = scaleY(v)
        const barH = baseline - y
        if (barH <= 0) return
        const bx = x - groupW / 2 + mi * (barW + 1)
        barSvg += `<rect x="${bx.toFixed(1)}" y="${y.toFixed(1)}"
          width="${barW.toFixed(1)}" height="${barH.toFixed(1)}"
          fill="${m.color}" opacity="0.75" rx="1"/>`
      })
    }
  }

  // ── Model lines + dots ─────────────────────────────────────────────────────
  let modelLines = ''
  let modelDots  = ''

  if (!isBar) {
    modelLines = loaded.map(m => {
      const pts = modelPts.get(m.key) ?? []
      if (pts.length < 2) return ''
      const d = smoothPath(pts)
      return `<path d="${d}" fill="none" stroke="${m.color}"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`
    }).join('\n')

    // Dots: only draw when ≤3 models or when zoomed (keep chart readable)
    const showDots = loaded.length <= 4
    if (showDots) {
      modelDots = loaded.map(m => {
        const pts = modelPts.get(m.key) ?? []
        // Show dot every 2nd point to avoid crowding (every 6h since STEP=3, 2pts=6h)
        return pts.map(([x, y], idx) => {
          if (idx % 2 !== 0) return ''  // every 6h
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5"
            fill="${m.color}" opacity="0.9" stroke="rgba(11,18,32,0.6)" stroke-width="1"/>`
        }).join('')
      }).join('\n')
    }
  }

  // ── Inline value labels (Meteomatics-style) ────────────────────────────────
  // Show values directly on the chart at 6h intervals for top model or ensemble mean
  let inlineLabels = ''
  {
    const refModel = loaded[0]  // first loaded model as reference
    const decimals = (metricKey === 'pres') ? 0 : (metricKey === 'temp' ? 0 : 1)

    for (let s = 0; s < N_PTS; s++) {
      const ts = timePts[s]
      if (!ts) continue
      const hour = parseInt(ts.slice(11, 13), 10)
      // Only at 0h, 6h, 12h, 18h
      if (hour % 6 !== 0) continue

      let v: number | null = null
      let labelColor = refModel.color

      if (isTemp && meanPtsForLabels.length > 0) {
        // For temp, label the ensemble mean
        const pt = meanPtsForLabels.find(p => p.s === s)
        if (pt) { v = pt.v; labelColor = 'rgba(255,150,80,0.9)' }
      } else if (!isBar) {
        v = metric.src(refModel.key, s * STEP)
      }

      if (v === null) continue
      const x = scaleX(s)
      const y = isTemp
        ? (meanPtsForLabels.find(p => p.s === s)?.y ?? scaleY(v))
        : scaleY(v)

      const lbl = `${v.toFixed(decimals)}${metric.unit === '°C' ? '°' : ''}`
      inlineLabels += `<text x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}"
        fill="${labelColor}" font-size="9" font-weight="700" text-anchor="middle"
        opacity="0.9" style="text-shadow:0 1px 3px rgba(0,0,0,0.8)">${lbl}</text>`
    }
  }

  // ── Y axis smart ticks ─────────────────────────────────────────────────────
  const ticks     = smartTicks(rawMin, rawMax, metric.tick)
  const gridLines = ticks.map(v => {
    const y = scaleY(v)
    if (y < PAD.top || y > PAD.top + CHART_H) return ''
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${PAD.left + CHART_W}" y2="${y.toFixed(1)}"
      stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`
  }).join('\n')

  const yLabels = ticks.map(v => {
    const y = scaleY(v)
    if (y < PAD.top || y > PAD.top + CHART_H) return ''
    return `<text x="${PAD.left - 6}" y="${(y + 4).toFixed(1)}"
      fill="rgba(180,200,220,0.55)" font-size="10" text-anchor="end">${v.toFixed(0)}</text>`
  }).join('\n')

  // ── X axis hour labels (every 6 hours) ────────────────────────────────────
  let xLabels = ''
  for (let s = 0; s < N_PTS; s++) {
    const ts   = timePts[s]
    if (!ts) continue
    const hour = parseInt(ts.slice(11, 13), 10)
    if (hour % 6 !== 0) continue
    const x = scaleX(s)
    xLabels += `<text x="${x.toFixed(1)}" y="${H - 6}"
      fill="rgba(150,175,200,0.5)" font-size="9" text-anchor="middle">${String(hour).padStart(2,'0')}h</text>`
  }

  // ── Metric tabs HTML ───────────────────────────────────────────────────────
  const tabsHtml = (Object.keys(metrics) as MetricKey[]).map(k => {
    const active = state.activeMetric === k ? ' active' : ''
    return `<button class="mtric${active}" data-metric="${k}">${metrics[k].label}</button>`
  }).join('')

  // ── Legend HTML ────────────────────────────────────────────────────────────
  const legendHtml = loaded.map(m =>
    `<span class="leg-item"><span class="leg-dot" style="background:${m.color}"></span>${m.flag} ${m.name}</span>`
  ).join('')

  // ── SVG gradient definitions ───────────────────────────────────────────────
  const svgDefs = `
    <defs>
      <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="rgba(255,120,60,0.30)"/>
        <stop offset="55%"  stop-color="rgba(0,210,230,0.10)"/>
        <stop offset="100%" stop-color="rgba(0,210,230,0)"/>
      </linearGradient>
    </defs>`

  // ── Chart axes frame ───────────────────────────────────────────────────────
  const axisFrame = `
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + CHART_H}"
      stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    <line x1="${PAD.left}" y1="${PAD.top + CHART_H}" x2="${PAD.left + CHART_W}" y2="${PAD.top + CHART_H}"
      stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`

  // ── Assemble SVG ───────────────────────────────────────────────────────────
  const svgContent = `
    ${svgDefs}
    ${dayBands}
    ${axisFrame}
    ${gridLines}
    ${daySeparators}
    ${nowLine}
    ${isTemp ? gradFillPath : ''}
    ${isTemp ? bandPath     : ''}
    ${isBar  ? barSvg       : modelLines}
    ${isTemp ? meanPath     : ''}
    ${modelDots}
    ${inlineLabels}
    ${xLabels}
    ${yLabels}
    ${dayLabels}`

  // ── Full card HTML ─────────────────────────────────────────────────────────
  el.innerHTML = `
    <div class="chart-header">
      <div class="section-title">${t.chartTitle}</div>
      <div class="metric-tabs">${tabsHtml}</div>
    </div>
    <div class="chart-scroll" style="position:relative">
      <svg class="chart-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
           style="display:block;overflow:visible">
        ${svgContent}
      </svg>
      <div class="chart-tooltip" style="
        position:absolute;top:0;left:0;
        pointer-events:none;
        display:none;
        background:rgba(8,18,38,0.97);
        border:1px solid rgba(255,255,255,0.13);
        border-radius:8px;
        padding:8px 12px;
        font-size:12px;
        line-height:1.6;
        color:#e4f0fb;
        white-space:nowrap;
        z-index:20;
        box-shadow:0 4px 20px rgba(0,0,0,0.5);
        min-width:160px;
      "></div>
    </div>
    <div class="chart-legend">${legendHtml}</div>`

  // ── Interactive: floating HTML tooltip on mousemove ────────────────────────
  const svgEl     = el.querySelector<SVGSVGElement>('.chart-svg')!
  const scrollDiv = el.querySelector<HTMLDivElement>('.chart-scroll')!
  const tipEl     = el.querySelector<HTMLDivElement>('.chart-tooltip')!

  // Vertical hover line
  const hlLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  hlLine.setAttribute('y1', String(PAD.top))
  hlLine.setAttribute('y2', String(PAD.top + CHART_H))
  hlLine.setAttribute('stroke', 'rgba(255,255,255,0.25)')
  hlLine.setAttribute('stroke-width', '1')
  hlLine.setAttribute('stroke-dasharray', '4,3')
  hlLine.style.display = 'none'
  hlLine.style.pointerEvents = 'none'
  svgEl.appendChild(hlLine)

  function getNearestIndex(clientX: number): number {
    const rect   = svgEl.getBoundingClientRect()
    const svgX   = (clientX - rect.left) * (W / rect.width)
    const chartX = svgX - PAD.left
    const s      = Math.round((chartX / CHART_W) * (N_PTS - 1))
    return Math.max(0, Math.min(N_PTS - 1, s))
  }

  svgEl.addEventListener('mousemove', (e: MouseEvent) => {
    const s  = getNearestIndex(e.clientX)
    const x  = scaleX(s)
    const ts = timePts[s]

    hlLine.setAttribute('x1', x.toFixed(1))
    hlLine.setAttribute('x2', x.toFixed(1))
    hlLine.style.display = ''

    const rawIdx   = s * STEP
    const dateStr  = ts ? ts.slice(0, 10)  : ''
    const hourStr  = ts ? ts.slice(11, 13) : ''
    const d        = dateStr ? new Date(dateStr + 'T12:00:00') : null
    const dayLabel = d
      ? `${t.days[d.getDay()]} ${d.getDate()} — ${hourStr}:00`
      : `${hourStr}:00`

    const rows: { name: string; color: string; val: number; valStr: string }[] = []
    for (const m of loaded) {
      const v = metric.src(m.key, rawIdx)
      if (v === null) continue
      const decimals = metric.unit === 'hPa' ? 0 : 1
      rows.push({
        name:   `${m.flag} ${m.name}`,
        color:  m.color,
        val:    v,
        valStr: `${v.toFixed(decimals)} ${metric.unit}`,
      })
    }
    rows.sort((a, b) => b.val - a.val)

    let html = `<div style="font-weight:700;font-size:11px;color:#a0c0e0;margin-bottom:4px">${dayLabel}</div>`
    for (const row of rows) {
      html += `<div style="display:flex;align-items:center;gap:6px;padding:1px 0">
        <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${row.color};flex-shrink:0"></span>
        <span style="color:#6e8caa;flex:1">${row.name}</span>
        <span style="color:${row.color};font-weight:700;margin-left:8px">${row.valStr}</span>
      </div>`
    }
    tipEl.innerHTML = html

    const svgRect    = svgEl.getBoundingClientRect()
    const scrollRect = scrollDiv.getBoundingClientRect()
    const tipW       = tipEl.offsetWidth  || 180
    const scale      = svgRect.width / W
    const svgPixX    = x * scale + (svgRect.left - scrollRect.left)
    let   tipLeft    = svgPixX + 14
    if (tipLeft + tipW > scrollRect.width - 4) tipLeft = svgPixX - tipW - 14
    const tipTop     = Math.max(4, (PAD.top * scale) - 4)

    tipEl.style.left    = `${tipLeft}px`
    tipEl.style.top     = `${tipTop}px`
    tipEl.style.display = 'block'
  })

  svgEl.addEventListener('mouseleave', () => {
    tipEl.style.display  = 'none'
    hlLine.style.display = 'none'
  })

  // ── Metric tab clicks ──────────────────────────────────────────────────────
  el.querySelectorAll<HTMLButtonElement>('.mtric').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeMetric = btn.dataset.metric!
      renderChart(onMetricChange)
      onMetricChange?.(state.activeMetric)
    })
  })
}
