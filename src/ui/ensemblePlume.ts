import { state } from '../state'
import { MODELS, modelValidForDay } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { avg } from '../utils/weather'

const W = 900, H = 260
const PAD = { top: 24, right: 24, bottom: 40, left: 52 }
const CW = W - PAD.left - PAD.right
const CH = H - PAD.top - PAD.bottom
const DAYS = 7

type PlumeVar = 'temp' | 'precip' | 'wind'

function getValues(modelKey: string, variable: PlumeVar): (number | null)[] {
  const d = state.wxData[modelKey]
  if (!d) return Array(DAYS).fill(null)
  return Array.from({ length: DAYS }, (_, i) => {
    if (variable === 'temp')   return d.daily.temperature_2m_max[i]   ?? null
    if (variable === 'precip') return (d.daily as any).precipitation_sum?.[i] ?? null
    if (variable === 'wind')   return d.daily.windspeed_10m_max[i]    ?? null
    return null
  })
}

export function renderEnsemblePlume(container: HTMLElement, variable: PlumeVar) {
  const t = LANG_DATA[state.lang]
  const loaded = MODELS.filter(m => state.wxData[m.key] != null)
  if (!loaded.length) { container.innerHTML = ''; return }

  const refData = Object.values(state.wxData).find(d => d != null)!
  const dayLabels = Array.from({ length: DAYS }, (_, i) => {
    const date = new Date(refData.daily.time[i] + 'T12:00:00')
    const isToday = i === 0
    return isToday ? t.today : t.days[date.getDay()]
  })

  // Per-day per-model values
  const modelSeries: { model: (typeof MODELS)[0]; vals: (number|null)[] }[] = loaded.map(m => ({
    model: m,
    vals: getValues(m.key, variable),
  }))

  // Ensemble mean per day
  const meanVals: (number|null)[] = Array.from({ length: DAYS }, (_, i) => {
    const vs = modelSeries
      .filter(s => modelValidForDay(s.model, i))
      .map(s => s.vals[i])
      .filter((v): v is number => v !== null)
    return vs.length ? avg(vs) : null
  })

  // Min/max envelope
  const minVals: (number|null)[] = Array.from({ length: DAYS }, (_, i) => {
    const vs = modelSeries.map(s => s.vals[i]).filter((v): v is number => v !== null)
    return vs.length ? Math.min(...vs) : null
  })
  const maxVals: (number|null)[] = Array.from({ length: DAYS }, (_, i) => {
    const vs = modelSeries.map(s => s.vals[i]).filter((v): v is number => v !== null)
    return vs.length ? Math.max(...vs) : null
  })

  // Scale
  const allNums = [...minVals, ...maxVals].filter((v): v is number => v !== null)
  if (!allNums.length) { container.innerHTML = ''; return }
  let yMin = Math.min(...allNums)
  let yMax = Math.max(...allNums)
  const pad = Math.max((yMax - yMin) * 0.15, variable === 'temp' ? 2 : 0.5)
  yMin -= pad; yMax += pad

  const xScale = (i: number) => PAD.left + (i / (DAYS - 1)) * CW
  const yScale = (v: number) => PAD.top + CH - ((v - yMin) / (yMax - yMin)) * CH

  const unit  = variable === 'temp' ? '°C' : variable === 'precip' ? 'mm' : 'km/h'
  const color = variable === 'temp' ? '#ff7043' : variable === 'precip' ? '#29b6f6' : '#aed581'

  function linePath(vals: (number|null)[]): string {
    let d = ''
    vals.forEach((v, i) => {
      if (v === null) return
      const x = xScale(i), y = yScale(v)
      d += d ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`
    })
    return d
  }

  function envelopePath(): string {
    const fwdPoints = maxVals.map((v, i) => v !== null ? `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}` : null).filter(Boolean)
    const bwdPoints = [...minVals].reverse().map((v, i) => {
      const ri = DAYS - 1 - i
      return v !== null ? `${xScale(ri).toFixed(1)},${yScale(v).toFixed(1)}` : null
    }).filter(Boolean)
    if (!fwdPoints.length) return ''
    return `M${fwdPoints.join(' L')} L${bwdPoints.join(' L')} Z`
  }

  const tickCount = 5
  const yTicks = Array.from({ length: tickCount }, (_, i) => {
    const v = yMin + (i / (tickCount - 1)) * (yMax - yMin)
    return { v, y: yScale(v) }
  })

  const modelLines = modelSeries.map((s, idx) => {
    const path = linePath(s.vals)
    if (!path) return ''
    return `<path class="plume-line-${idx}" d="${path}" stroke="${s.model.color}" stroke-width="1.5" fill="none" opacity="0.5"/>`
  }).join('')

  const meanPath   = linePath(meanVals)
  const envPath    = envelopePath()

  // Crosshair + interactive dots (initially hidden)
  const dotCircles = modelSeries.map((s, idx) =>
    `<circle class="pd-${idx}" cx="0" cy="0" r="4" fill="${s.model.color}" stroke="rgba(0,0,0,0.4)" stroke-width="1" opacity="0" pointer-events="none"/>`
  ).join('')

  const svg = `
    <svg class="plume-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
         style="width:100%;max-width:${W}px;display:block;overflow:visible;cursor:crosshair">
      <defs>
        <linearGradient id="envGrad-${variable}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.04"/>
        </linearGradient>
      </defs>

      <!-- Envelope fill -->
      ${envPath ? `<path d="${envPath}" fill="url(#envGrad-${variable})" stroke="none"/>` : ''}

      <!-- Grid lines + x labels -->
      ${Array.from({ length: DAYS }, (_, i) => {
        const x = xScale(i)
        return `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + CH}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                <text x="${x}" y="${PAD.top + CH + 18}" text-anchor="middle" fill="var(--text-dim, #6b7fa3)" font-size="11">${dayLabels[i]}</text>`
      }).join('')}

      <!-- Y ticks -->
      ${yTicks.map(tk => `
        <line x1="${PAD.left - 4}" y1="${tk.y}" x2="${PAD.left + CW}" y2="${tk.y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
        <text x="${PAD.left - 8}" y="${tk.y + 4}" text-anchor="end" fill="var(--text-dim, #6b7fa3)" font-size="11">${Math.round(tk.v)}</text>
      `).join('')}

      <!-- Unit label -->
      <text x="${PAD.left - 8}" y="${PAD.top - 8}" text-anchor="end" fill="${color}" font-size="11" font-weight="600">${unit}</text>

      <!-- Individual model lines -->
      ${modelLines}

      <!-- Ensemble mean -->
      ${meanPath ? `<path d="${meanPath}" stroke="${color}" stroke-width="2.5" fill="none" opacity="0.95"/>` : ''}

      <!-- Axes border -->
      <rect x="${PAD.left}" y="${PAD.top}" width="${CW}" height="${CH}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1" rx="2"/>

      <!-- Interactive: crosshair + dots (shown on hover) -->
      <line class="plume-crosshair" x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + CH}"
            stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-dasharray="4,3" opacity="0" pointer-events="none"/>
      ${dotCircles}
      <circle class="pd-mean" cx="0" cy="0" r="5.5" fill="${color}" stroke="#0b1220" stroke-width="2" opacity="0" pointer-events="none"/>

      <!-- Transparent overlay for mouse events -->
      <rect class="plume-hitbox" x="${PAD.left}" y="${PAD.top}" width="${CW}" height="${CH}" fill="transparent"/>
    </svg>
  `

  // Legend
  const legendHtml = modelSeries.map(s =>
    `<span class="plume-leg-item"><span class="plume-dot" style="background:${s.model.color}"></span>${s.model.flag} ${s.model.name}</span>`
  ).join('')

  container.innerHTML = `
    <div class="plume-wrap">
      ${svg}
      <div class="plume-legend">${legendHtml}
        <span class="plume-leg-item"><span class="plume-dot" style="background:${color};width:14px;height:3px;border-radius:2px"></span><strong>${t.ensemble}</strong></span>
      </div>
      <div class="plume-tooltip" id="plumeTooltip"></div>
    </div>
  `

  // ── Interactive hover ────────────────────────────────────────────────────────
  const svgEl      = container.querySelector('.plume-svg')    as SVGSVGElement
  const tooltip    = container.querySelector('#plumeTooltip') as HTMLElement
  const crosshair  = container.querySelector('.plume-crosshair') as SVGLineElement
  const meanDot    = container.querySelector('.pd-mean')      as SVGCircleElement

  function getNearestDay(clientX: number): number {
    const rect  = svgEl.getBoundingClientRect()
    const ratio = W / rect.width                        // viewBox → screen scale
    const svgX  = (clientX - rect.left) * ratio
    const raw   = (svgX - PAD.left) / CW * (DAYS - 1)
    return Math.max(0, Math.min(DAYS - 1, Math.round(raw)))
  }

  function showTooltip(dayIdx: number, clientX: number) {
    const x = xScale(dayIdx)

    // Crosshair
    crosshair.setAttribute('x1', x.toFixed(1))
    crosshair.setAttribute('x2', x.toFixed(1))
    crosshair.setAttribute('opacity', '1')

    // Model dots
    modelSeries.forEach((s, idx) => {
      const dot = container.querySelector(`.pd-${idx}`) as SVGCircleElement
      const val = s.vals[dayIdx]
      if (!dot) return
      if (val !== null) {
        dot.setAttribute('cx', x.toFixed(1))
        dot.setAttribute('cy', yScale(val).toFixed(1))
        dot.setAttribute('opacity', '0.9')
      } else {
        dot.setAttribute('opacity', '0')
      }
    })

    // Mean dot
    const mv = meanVals[dayIdx]
    if (mv !== null) {
      meanDot.setAttribute('cx', x.toFixed(1))
      meanDot.setAttribute('cy', yScale(mv).toFixed(1))
      meanDot.setAttribute('opacity', '1')
    } else {
      meanDot.setAttribute('opacity', '0')
    }

    // Tooltip content
    const rows = modelSeries
      .filter(s => s.vals[dayIdx] !== null)
      .sort((a, b) => (b.vals[dayIdx] ?? 0) - (a.vals[dayIdx] ?? 0))
      .map(s => `
        <div style="display:flex;align-items:center;gap:6px;padding:2px 0">
          <span style="width:8px;height:8px;border-radius:50%;background:${s.model.color};flex-shrink:0;display:inline-block"></span>
          <span style="color:rgba(180,200,220,0.7);font-size:10px;flex:1">${s.model.flag} ${s.model.name}</span>
          <span style="font-weight:700;font-size:11px;font-family:var(--font-data);color:var(--text)">${s.vals[dayIdx]!.toFixed(1)}${unit}</span>
        </div>`)

    const meanRow = mv !== null ? `
      <div style="display:flex;align-items:center;gap:6px;padding:3px 0 2px;border-top:1px solid rgba(255,255,255,0.08);margin-top:3px">
        <span style="width:12px;height:3px;border-radius:1px;background:${color};flex-shrink:0;display:inline-block"></span>
        <span style="color:${color};font-size:10px;font-weight:700;flex:1">${t.ensemble}</span>
        <span style="font-weight:800;font-size:12px;color:${color};font-family:var(--font-data)">${mv.toFixed(1)}${unit}</span>
      </div>` : ''

    tooltip.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:5px;letter-spacing:.02em">${dayLabels[dayIdx]}</div>
      ${rows.join('')}
      ${meanRow}
    `

    // Position tooltip: flip left if near right edge
    const rect    = svgEl.getBoundingClientRect()
    const xPct    = (clientX - rect.left) / rect.width
    tooltip.style.display = 'block'
    tooltip.style.top     = '0px'
    tooltip.style.left    = xPct > 0.6
      ? `${((x - 16) / W * rect.width) - 180}px`
      : `${(x + 16) / W * rect.width}px`
  }

  function hideTooltip() {
    crosshair.setAttribute('opacity', '0')
    meanDot.setAttribute('opacity', '0')
    modelSeries.forEach((_, idx) => {
      const dot = container.querySelector(`.pd-${idx}`) as SVGCircleElement
      if (dot) dot.setAttribute('opacity', '0')
    })
    tooltip.style.display = 'none'
  }

  svgEl.addEventListener('mousemove', (e: MouseEvent) => {
    showTooltip(getNearestDay(e.clientX), e.clientX)
  })
  svgEl.addEventListener('mouseleave', hideTooltip)

  // Touch support
  svgEl.addEventListener('touchmove', (e: TouchEvent) => {
    e.preventDefault()
    const touch = e.touches[0]
    showTooltip(getNearestDay(touch.clientX), touch.clientX)
  }, { passive: false })
  svgEl.addEventListener('touchend', hideTooltip)
}
