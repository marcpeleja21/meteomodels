import { state } from '../state'
import { MODELS } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import type { MetricConfig, LangData } from '../types'

const W = 900, H = 280, PAD = { top: 24, right: 20, bottom: 40, left: 44 }
const CHART_W = W - PAD.left - PAD.right
const CHART_H = H - PAD.top  - PAD.bottom
const DAYS = 7

type MetricKey = 'tmax' | 'tmin' | 'rain' | 'wind' | 'hum' | 'pres'

function buildMetrics(_t: LangData): Record<MetricKey, MetricConfig> {
  return {
    tmax: { key: 'tmax', unit: '°C',  color: '#ff7043', src: (k, i) => state.wxData[k]?.daily.temperature_2m_max[i] ?? null },
    tmin: { key: 'tmin', unit: '°C',  color: '#4fc3f7', src: (k, i) => state.wxData[k]?.daily.temperature_2m_min[i] ?? null },
    rain: { key: 'rain', unit: '%',   color: '#4dd0e1', src: (k, i) => state.wxData[k]?.daily.precipitation_probability_max[i] ?? null },
    wind: { key: 'wind', unit: 'km/h',color: '#aed581', src: (k, i) => state.wxData[k]?.daily.windspeed_10m_max[i] ?? null },
    hum:  { key: 'hum',  unit: '%',   color: '#90caf9', src: (k, i) => state.wxData[k]?.daily.precipitation_probability_max[i] ?? null },
    pres: { key: 'pres', unit: 'hPa', color: '#ce93d8', src: (k, i) => {
      const d = state.wxData[k]
      if (!d) return null
      return d.hourly.pressure_msl[i * 24 + 12] ?? null
    }},
  }
}

export function renderChart(onMetricChange?: (key: string) => void) {
  const t       = LANG_DATA[state.lang]
  const metrics = buildMetrics(t)
  const el      = document.getElementById('chartCard')!

  const metricLabels: Record<MetricKey, string> = {
    tmax: t.mTMax, tmin: t.mTMin, rain: t.mRain, wind: t.mWind, hum: t.mHum, pres: t.mPres,
  }

  const tabsHtml = (Object.keys(metrics) as MetricKey[]).map(k => {
    const active = state.activeMetric === k ? ' active' : ''
    return `<button class="mtric${active}" data-metric="${k}">${metricLabels[k]}</button>`
  }).join('')

  const loaded = MODELS.filter(m => state.wxData[m.key] != null)
  if (!loaded.length) { el.innerHTML = ''; return }

  const metric = metrics[state.activeMetric as MetricKey] ?? metrics.tmax

  // Collect all values for scale
  const allVals: number[] = []
  for (const m of loaded) {
    for (let i = 0; i < DAYS; i++) {
      const v = metric.src(m.key, i)
      if (v !== null) allVals.push(v)
    }
  }
  if (!allVals.length) { el.innerHTML = ''; return }

  const minV  = Math.min(...allVals)
  const maxV  = Math.max(...allVals)
  const range = maxV - minV || 1

  function scaleY(v: number) {
    return PAD.top + CHART_H - ((v - minV) / range) * CHART_H
  }
  function scaleX(i: number) {
    return PAD.left + (i / (DAYS - 1)) * CHART_W
  }

  // Reference dates
  const refModel = loaded[0]
  const refTimes = refModel ? (state.wxData[refModel.key]?.daily.time ?? []) : []

  // Build polylines per model
  const lines = loaded.map(m => {
    const pts: string[] = []
    for (let i = 0; i < DAYS; i++) {
      const v = metric.src(m.key, i)
      if (v !== null) pts.push(`${scaleX(i)},${scaleY(v)}`)
    }
    if (!pts.length) return ''
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${m.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`
  }).join('\n')

  // Dots (interactive — larger hit radius)
  const dots = loaded.map(m => {
    return Array.from({ length: DAYS }, (_, i) => {
      const v = metric.src(m.key, i)
      if (v === null) return ''
      return `<circle cx="${scaleX(i)}" cy="${scaleY(v)}" r="3.5" fill="${m.color}" opacity="0.9" class="chart-dot" data-day="${i}" data-model="${m.key}" data-val="${v.toFixed(1)}"/>`
    }).join('')
  }).join('')

  // Hit areas (wide invisible rects per column)
  const colW = CHART_W / (DAYS - 1)
  const hitAreas = Array.from({ length: DAYS }, (_, i) => {
    const cx = scaleX(i)
    return `<rect class="chart-hit" data-day="${i}" x="${cx - colW / 2}" y="${PAD.top}" width="${colW}" height="${CHART_H}" fill="transparent" style="cursor:crosshair"/>`
  }).join('')

  // X axis labels
  const xLabels = Array.from({ length: DAYS }, (_, i) => {
    const dateStr = refTimes[i]
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T12:00:00')
    return `<text x="${scaleX(i)}" y="${H - 6}" fill="var(--text-muted)" font-size="11" text-anchor="middle">${t.days[d.getDay()]} ${d.getDate()}</text>`
  }).join('')

  // Y axis labels
  const ySteps = 5
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const v = minV + (range / ySteps) * i
    const y = scaleY(v)
    return `<text x="${PAD.left - 6}" y="${y + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end">${v.toFixed(0)}</text>`
  }).join('')

  // Grid lines
  const gridLines = Array.from({ length: ySteps + 1 }, (_, i) => {
    const v = minV + (range / ySteps) * i
    const y = scaleY(v)
    return `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + CHART_W}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`
  }).join('')

  // Vertical highlight line (hidden until hover)
  const hlLine = `<line class="chart-hl" x1="0" y1="${PAD.top}" x2="0" y2="${PAD.top + CHART_H}" stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="4,3" style="display:none"/>`

  // SVG tooltip group
  const tooltipGroup = `
    <g class="chart-tip" style="display:none;pointer-events:none">
      <rect class="chart-tip-bg" rx="6" ry="6" fill="rgba(10,20,40,0.97)" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
      <g class="chart-tip-lines"></g>
    </g>
  `

  // Legend
  const legendHtml = loaded.map(m =>
    `<span class="leg-item"><span class="leg-dot" style="background:${m.color}"></span>${m.flag} ${m.name}</span>`
  ).join('')

  el.innerHTML = `
    <div class="chart-header">
      <div class="section-title">${t.chartTitle} · ${t.days7}</div>
      <div class="metric-tabs">${tabsHtml}</div>
    </div>
    <div class="chart-scroll">
      <svg class="chart-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        ${gridLines}
        ${hlLine}
        ${lines}
        ${dots}
        ${xLabels}
        ${yLabels}
        ${hitAreas}
        ${tooltipGroup}
      </svg>
    </div>
    <div class="chart-legend">${legendHtml}</div>
  `

  // ── Interactive tooltip ────────────────────────────────────────────────────
  const svgEl  = el.querySelector<SVGSVGElement>('.chart-svg')!
  const tipGrp = svgEl.querySelector<SVGGElement>('.chart-tip')!
  const tipBg  = svgEl.querySelector<SVGRectElement>('.chart-tip-bg')!
  const tipLns = svgEl.querySelector<SVGGElement>('.chart-tip-lines')!
  const hlEl   = svgEl.querySelector<SVGLineElement>('.chart-hl')!

  svgEl.querySelectorAll<SVGRectElement>('.chart-hit').forEach(rect => {
    const dayI = parseInt(rect.dataset.day!)

    rect.addEventListener('mouseenter', () => {
      const cx = scaleX(dayI)

      // Move highlight line
      hlEl.setAttribute('x1', String(cx))
      hlEl.setAttribute('x2', String(cx))
      hlEl.style.display = ''

      // Build tooltip rows
      const dateStr = refTimes[dayI]
      const d = dateStr ? new Date(dateStr + 'T12:00:00') : null
      const dayLabel = d ? `${t.days[d.getDay()]} ${d.getDate()}` : `Dia ${dayI + 1}`

      const rows: { name: string; color: string; val: string }[] = []
      for (const m of loaded) {
        const v = metric.src(m.key, dayI)
        if (v !== null) rows.push({ name: `${m.flag} ${m.name}`, color: m.color, val: `${v.toFixed(metric.unit === 'hPa' ? 0 : 1)} ${metric.unit}` })
      }

      const lh = 16
      const tipH = 22 + rows.length * lh
      const tipW = 170

      // Position: prefer right; flip left if near right edge
      let tx = cx + 14
      if (tx + tipW > W - PAD.right) tx = cx - tipW - 14

      const ty = PAD.top + 4

      // Build SVG content
      let inner = `<text x="8" y="14" fill="#e4f0fb" font-size="11" font-weight="700">${dayLabel}</text>`
      rows.forEach((row, ri) => {
        const ry = 14 + (ri + 1) * lh
        inner += `
          <rect x="8" y="${ry - 8}" width="8" height="8" rx="2" fill="${row.color}"/>
          <text x="20" y="${ry}" fill="#6e8caa" font-size="10">${row.name}</text>
          <text x="${tipW - 8}" y="${ry}" fill="${row.color}" font-size="10" text-anchor="end" font-weight="700">${row.val}</text>
        `
      })

      tipBg.setAttribute('x', String(tx))
      tipBg.setAttribute('y', String(ty))
      tipBg.setAttribute('width', String(tipW))
      tipBg.setAttribute('height', String(tipH))
      tipLns.setAttribute('transform', `translate(${tx},${ty})`)
      tipLns.innerHTML = inner
      tipGrp.style.display = ''
    })

    rect.addEventListener('mouseleave', () => {
      tipGrp.style.display = 'none'
      hlEl.style.display   = 'none'
    })
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
