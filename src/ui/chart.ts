import { state } from '../state'
import { MODELS } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import type { MetricConfig, LangData } from '../types'

const W = 900, H = 260, PAD = { top: 20, right: 20, bottom: 40, left: 44 }
const CHART_W = W - PAD.left - PAD.right
const CHART_H = H - PAD.top  - PAD.bottom
const DAYS = 7

type MetricKey = 'tmax' | 'tmin' | 'rain' | 'wind' | 'hum' | 'pres'

function buildMetrics(_t: LangData): Record<MetricKey, MetricConfig> {
  return {
    tmax: { key: 'tmax', unit: '°C', color: '#ff7043', src: (k, i) => state.wxData[k]?.daily.temperature_2m_max[i] ?? null },
    tmin: { key: 'tmin', unit: '°C', color: '#4fc3f7', src: (k, i) => state.wxData[k]?.daily.temperature_2m_min[i] ?? null },
    rain: { key: 'rain', unit: '%',  color: '#4dd0e1', src: (k, i) => state.wxData[k]?.daily.precipitation_probability_max[i] ?? null },
    wind: { key: 'wind', unit: 'km/h', color: '#aed581', src: (k, i) => state.wxData[k]?.daily.windspeed_10m_max[i] ?? null },
    hum:  { key: 'hum',  unit: '%',  color: '#90caf9', src: (k, i) => state.wxData[k]?.daily.precipitation_probability_max[i] ?? null },
    pres: { key: 'pres', unit: 'hPa', color: '#ce93d8', src: (k, i) => {
      // approximate from hourly: take the value at midday of each day
      const d = state.wxData[k]
      if (!d) return null
      const dayStart = i * 24
      const midday   = dayStart + 12
      return d.hourly.pressure_msl[midday] ?? null
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

  const minV = Math.min(...allVals)
  const maxV = Math.max(...allVals)
  const range = maxV - minV || 1

  function scaleY(v: number) {
    return PAD.top + CHART_H - ((v - minV) / range) * CHART_H
  }
  function scaleX(i: number) {
    return PAD.left + (i / (DAYS - 1)) * CHART_W
  }

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

  // Dots
  const dots = loaded.map(m => {
    return Array.from({ length: DAYS }, (_, i) => {
      const v = metric.src(m.key, i)
      if (v === null) return ''
      return `<circle cx="${scaleX(i)}" cy="${scaleY(v)}" r="3" fill="${m.color}" opacity="0.9"/>`
    }).join('')
  }).join('')

  // X axis labels (day names)
  const refModel = loaded[0]
  const refTimes = refModel ? (state.wxData[refModel.key]?.daily.time ?? []) : []
  const xLabels = Array.from({ length: DAYS }, (_, i) => {
    const dateStr = refTimes[i]
    if (!dateStr) return ''
    const d    = new Date(dateStr + 'T12:00:00')
    const name = t.days[d.getDay()]
    return `<text x="${scaleX(i)}" y="${H - 6}" fill="var(--text-muted)" font-size="11" text-anchor="middle">${name}</text>`
  }).join('')

  // Y axis labels
  const ySteps = 5
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const v = minV + (range / ySteps) * i
    const y = scaleY(v)
    return `<text x="${PAD.left - 6}" y="${y + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end">${v.toFixed(metric.unit === 'hPa' ? 0 : 0)}</text>`
  }).join('')

  // Grid lines
  const gridLines = Array.from({ length: ySteps + 1 }, (_, i) => {
    const v = minV + (range / ySteps) * i
    const y = scaleY(v)
    return `<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + CHART_W}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`
  }).join('')

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
        ${lines}
        ${dots}
        ${xLabels}
        ${yLabels}
      </svg>
    </div>
    <div class="chart-legend">${legendHtml}</div>
  `

  // Metric tabs click
  el.querySelectorAll<HTMLButtonElement>('.mtric').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeMetric = btn.dataset.metric!
      renderChart(onMetricChange)
      onMetricChange?.(state.activeMetric)
    })
  })
}
