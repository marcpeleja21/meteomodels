import { state } from '../state'
import { LANG_DATA } from '../config/i18n'
import {
  fetchEnsembleMembers,
  ENS_MODELS,
  type EnsModelKey,
  type EnsVarKey,
} from '../api/ensembleMembers'

const W = 920, H = 300
const PAD = { top: 28, right: 20, bottom: 44, left: 52 }
const CW = W - PAD.left - PAD.right
const CH = H - PAD.top  - PAD.bottom

// ── Maths helpers ─────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo  = Math.floor(idx)
  const hi  = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function smartTicks(lo: number, hi: number, n = 5): number[] {
  const range = hi - lo
  const step  = Math.pow(10, Math.floor(Math.log10(range / n)))
  const nice  = [1, 2, 2.5, 5, 10].map(f => f * step).find(s => range / s <= n + 1) ?? step
  const start = Math.ceil(lo / nice) * nice
  const ticks: number[] = []
  for (let v = start; v <= hi + nice * 0.01; v = parseFloat((v + nice).toFixed(10)))
    ticks.push(parseFloat(v.toFixed(6)))
  return ticks
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderEnsemblePlume(
  container: HTMLElement,
  variable: EnsVarKey,
  model: EnsModelKey,
) {
  const t   = LANG_DATA[state.lang]
  const loc = state.currentLoc
  if (!loc) { container.innerHTML = ''; return }

  container.innerHTML = `<div class="plume-loading">⏳ ${t.loading}</div>`

  const data = await fetchEnsembleMembers(loc.latitude, loc.longitude, model, variable)
  if (!data || !data.members.length) {
    container.innerHTML = `<div class="plume-loading" style="color:var(--text-muted)">${t.noData}</div>`
    return
  }

  // ── Sub-sample every 3 hours → ≤ 56 rendered points over 7 days ─────────────
  const STEP = 3
  const idxs = data.times.map((_, i) => i).filter(i => i % STEP === 0)
  const times   = idxs.map(i => data.times[i])
  const members = data.members.map(m => idxs.map(i => m[i]))
  const n       = times.length

  // ── Per-time statistics ───────────────────────────────────────────────────────
  const medians: number[] = [], q25: number[] = [], q75: number[] = []
  const mins:    number[] = [], maxs: number[] = []

  for (let ti = 0; ti < n; ti++) {
    const vals = members
      .map(m => m[ti])
      .filter((v): v is number => v !== null && !isNaN(v))
      .sort((a, b) => a - b)

    if (!vals.length) {
      medians.push(NaN); q25.push(NaN); q75.push(NaN)
      mins.push(NaN);    maxs.push(NaN)
      continue
    }
    medians.push(percentile(vals, 50))
    q25.push(percentile(vals, 25))
    q75.push(percentile(vals, 75))
    mins.push(vals[0])
    maxs.push(vals[vals.length - 1])
  }

  // ── Y scale (3rd–97th pct to avoid extreme outlier stretch) ──────────────────
  const allVals = members.flat().filter((v): v is number => v !== null && !isNaN(v)).sort((a,b)=>a-b)
  const rawMin  = percentile(allVals, 3)
  const rawMax  = percentile(allVals, 97)
  const rangePad = Math.max((rawMax - rawMin) * 0.12, 1)
  let yMin = rawMin - rangePad
  let yMax = rawMax + rangePad

  const ticks = smartTicks(yMin, yMax)
  if (ticks.length) {
    yMin = Math.min(yMin, ticks[0])
    yMax = Math.max(yMax, ticks[ticks.length - 1])
  }

  const xScale = (i: number) => PAD.left + (i / (n - 1)) * CW
  const yScale = (v: number) => PAD.top  + CH - ((v - yMin) / (yMax - yMin)) * CH

  // ── Path helpers ──────────────────────────────────────────────────────────────
  function pathFrom(vals: (number | null | undefined)[]): string {
    let d = ''
    vals.forEach((v, i) => {
      if (v === null || v === undefined || isNaN(v as number)) return
      const px = xScale(i).toFixed(1), py = yScale(v as number).toFixed(1)
      d += (!d || isNaN(vals[i - 1] as number) || vals[i - 1] === null)
        ? `M${px},${py}`
        : ` L${px},${py}`
    })
    return d
  }

  function envelopePath(lo: number[], hi: number[]): string {
    const fwd = hi.map((v, i) => isNaN(v) ? null : `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).filter(Boolean)
    const bwd = [...lo].reverse().map((v, i) => {
      const ri = n - 1 - i
      return isNaN(v) ? null : `${xScale(ri).toFixed(1)},${yScale(v).toFixed(1)}`
    }).filter(Boolean)
    return fwd.length ? `M${fwd.join(' L')} L${bwd.join(' L')} Z` : ''
  }

  // ── Day separators ────────────────────────────────────────────────────────────
  const now    = new Date()
  const todayKey = now.toISOString().slice(0, 10)
  const dayLines: { x: number; label: string; isFirst: boolean }[] = []
  let lastDay = ''
  times.forEach((ts, i) => {
    const dayKey = ts.slice(0, 10)
    if (dayKey !== lastDay) {
      lastDay = dayKey
      const d      = new Date(ts)
      const isFirst = dayLines.length === 0
      const label   = dayKey === todayKey
        ? t.today
        : `${t.days[d.getDay()]} ${d.getDate()}`
      dayLines.push({ x: xScale(i), label, isFirst })
    }
  })

  // Current-time indicator
  const nowTs  = now.toISOString().slice(0, 13) + ':00'
  const nowIdx = times.findIndex(ts => ts >= nowTs)
  const nowX   = nowIdx >= 0 ? xScale(nowIdx) : -1

  // ── Colours ───────────────────────────────────────────────────────────────────
  const color =
    variable === 'temp'   ? '#ff7043' :
    variable === 'precip' ? '#29b6f6' : '#aed581'

  const unit     = data.unit
  const modelMeta = ENS_MODELS.find(m => m.key === model)!
  const memberLinesSvg = members.map(m =>
    `<path d="${pathFrom(m)}" stroke="${color}" stroke-width="1" fill="none" opacity="0.18"/>`
  ).join('')

  const iqrPath    = envelopePath(q25, q75)
  const spreadPath = envelopePath(mins, maxs)
  const medPath    = pathFrom(medians)

  // ── Render ────────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="plume-wrap">
      <div class="plume-source-note">
        ${modelMeta.flag} ${modelMeta.label} · ${data.nMembers} membres · Open-Meteo
      </div>
      <svg class="plume-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
           style="width:100%;max-width:${W}px;display:block;overflow:visible;cursor:crosshair">
        <defs>
          <linearGradient id="iqrGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="${color}" stop-opacity="0.24"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0.08"/>
          </linearGradient>
          <linearGradient id="spreadGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="${color}" stop-opacity="0.07"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
          </linearGradient>
          <clipPath id="chartClip">
            <rect x="${PAD.left}" y="${PAD.top}" width="${CW}" height="${CH}"/>
          </clipPath>
        </defs>

        <!-- Y grid + labels -->
        ${ticks.map(v => `
          <line x1="${PAD.left}" y1="${yScale(v).toFixed(1)}"
                x2="${PAD.left + CW}" y2="${yScale(v).toFixed(1)}"
                stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
          <text x="${(PAD.left - 7).toFixed(1)}" y="${(yScale(v) + 4).toFixed(1)}"
                text-anchor="end" fill="var(--text-dim,#6b7fa3)" font-size="10.5">
            ${v % 1 === 0 ? v : v.toFixed(1)}
          </text>`).join('')}

        <!-- Unit -->
        <text x="${PAD.left - 7}" y="${PAD.top - 10}"
              text-anchor="end" fill="${color}" font-size="11" font-weight="600">${unit}</text>

        <!-- Day separators + labels -->
        ${dayLines.map(dl => `
          ${!dl.isFirst ? `
            <line x1="${dl.x.toFixed(1)}" y1="${PAD.top}" x2="${dl.x.toFixed(1)}" y2="${PAD.top + CH}"
                  stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="3,3"/>` : ''}
          <text x="${dl.x.toFixed(1)}" y="${(PAD.top + CH + 18).toFixed(1)}"
                text-anchor="${dl.isFirst ? 'start' : 'middle'}"
                fill="var(--text-dim,#6b7fa3)" font-size="11">${dl.label}</text>`).join('')}

        <g clip-path="url(#chartClip)">
          <!-- Spread band (min–max) -->
          ${spreadPath ? `<path d="${spreadPath}" fill="url(#spreadGrad)" stroke="none"/>` : ''}
          <!-- IQR band (25–75 pct) -->
          ${iqrPath ? `<path d="${iqrPath}" fill="url(#iqrGrad)"
                            stroke="${color}" stroke-opacity="0.2" stroke-width="0.5"/>` : ''}
          <!-- Individual member spaghetti -->
          ${memberLinesSvg}
          <!-- Median line -->
          ${medPath ? `<path d="${medPath}" stroke="${color}" stroke-width="2.5" fill="none" opacity="0.95"/>` : ''}
          <!-- Current-time indicator -->
          ${nowX > 0 ? `
            <line x1="${nowX.toFixed(1)}" y1="${PAD.top}" x2="${nowX.toFixed(1)}" y2="${PAD.top + CH}"
                  stroke="#00e5ff" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.75"/>` : ''}
        </g>

        <!-- Chart border -->
        <rect x="${PAD.left}" y="${PAD.top}" width="${CW}" height="${CH}"
              fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1" rx="2"/>

        <!-- Crosshair (hidden by default) -->
        <line class="plume-crosshair"
              x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + CH}"
              stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="4,3"
              opacity="0" pointer-events="none"/>
        <circle class="plume-med-dot" cx="0" cy="0" r="5"
                fill="${color}" stroke="#0b1220" stroke-width="2"
                opacity="0" pointer-events="none"/>

        <!-- Invisible hitbox for mouse events -->
        <rect class="plume-hitbox"
              x="${PAD.left}" y="${PAD.top}" width="${CW}" height="${CH}" fill="transparent"/>
      </svg>

      <!-- Legend -->
      <div class="plume-legend">
        <span class="plume-leg-item">
          <span style="display:inline-block;width:22px;height:2px;background:${color};opacity:0.35;border-radius:1px;vertical-align:middle"></span>
          ${data.nMembers} membres
        </span>
        <span class="plume-leg-item">
          <span style="display:inline-block;width:22px;height:8px;background:${color};opacity:0.3;border-radius:2px;vertical-align:middle"></span>
          IQR 25–75%
        </span>
        <span class="plume-leg-item">
          <span style="display:inline-block;width:22px;height:3px;background:${color};border-radius:2px;vertical-align:middle"></span>
          Mediana
        </span>
        ${nowX > 0 ? `
        <span class="plume-leg-item">
          <span style="display:inline-block;width:3px;height:14px;background:#00e5ff;border-radius:1px;vertical-align:middle"></span>
          ${t.now}
        </span>` : ''}
      </div>

      <!-- Floating tooltip -->
      <div class="plume-tooltip" id="plumeTooltip" style="display:none;position:absolute;pointer-events:none"></div>
    </div>
  `

  // ── Interactivity ─────────────────────────────────────────────────────────────
  const svgEl     = container.querySelector<SVGSVGElement>('.plume-svg')!
  const tooltip   = container.querySelector<HTMLElement>('#plumeTooltip')!
  const crosshair = container.querySelector<SVGLineElement>('.plume-crosshair')!
  const medDot    = container.querySelector<SVGCircleElement>('.plume-med-dot')!
  const hitbox    = container.querySelector<SVGRectElement>('.plume-hitbox')!

  function nearestIdx(clientX: number): number {
    const rect  = svgEl.getBoundingClientRect()
    const svgX  = (clientX - rect.left) * (W / rect.width)
    const raw   = (svgX - PAD.left) / CW * (n - 1)
    return Math.max(0, Math.min(n - 1, Math.round(raw)))
  }

  function showTip(idx: number, clientX: number) {
    const x = xScale(idx)
    crosshair.setAttribute('x1', x.toFixed(1)); crosshair.setAttribute('x2', x.toFixed(1))
    crosshair.setAttribute('opacity', '1')

    const med = medians[idx]
    if (!isNaN(med)) {
      medDot.setAttribute('cx', x.toFixed(1)); medDot.setAttribute('cy', yScale(med).toFixed(1))
      medDot.setAttribute('opacity', '1')
    }

    const d    = new Date(times[idx])
    const hh   = d.getHours().toString().padStart(2, '0')
    const lbl  = `${t.days[d.getDay()]} ${d.getDate()} ${t.months[d.getMonth()]} · ${hh}:00`

    tooltip.innerHTML = `
      <div style="font-weight:700;font-size:11px;margin-bottom:5px;color:var(--text)">${lbl}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px">
        <span style="color:rgba(180,200,220,0.65)">Mediana</span>
        <span style="font-weight:700;color:${color};font-family:var(--font-data)">${isNaN(med) ? '—' : med.toFixed(1)}${unit}</span>
        <span style="color:rgba(180,200,220,0.65)">IQR</span>
        <span style="font-family:var(--font-data);color:var(--text)">${isNaN(q25[idx]) ? '—' : q25[idx].toFixed(1)}–${isNaN(q75[idx]) ? '—' : q75[idx].toFixed(1)}${unit}</span>
        <span style="color:rgba(180,200,220,0.65)">Rang</span>
        <span style="font-family:var(--font-data);color:var(--text)">${isNaN(mins[idx]) ? '—' : mins[idx].toFixed(1)}–${isNaN(maxs[idx]) ? '—' : maxs[idx].toFixed(1)}${unit}</span>
      </div>`

    const rect = svgEl.getBoundingClientRect()
    const xPct = (clientX - rect.left) / rect.width
    tooltip.style.display = 'block'
    tooltip.style.top     = '16px'
    tooltip.style.left    = xPct > 0.6
      ? `${Math.max(0, (x / W * rect.width) - 175)}px`
      : `${(x + 18) / W * rect.width}px`
  }

  function hideTip() {
    crosshair.setAttribute('opacity', '0')
    medDot.setAttribute('opacity', '0')
    tooltip.style.display = 'none'
  }

  hitbox.addEventListener('mousemove', e => showTip(nearestIdx(e.clientX), e.clientX))
  hitbox.addEventListener('mouseleave', hideTip)
  hitbox.addEventListener('touchmove', e => {
    e.preventDefault()
    showTip(nearestIdx(e.touches[0].clientX), e.touches[0].clientX)
  }, { passive: false })
  hitbox.addEventListener('touchend', hideTip)
}
