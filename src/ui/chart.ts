import { state } from '../state'
import { getActiveModels } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { computeModelWeights } from '../utils/modelWeights'

// ── Layout constants ───────────────────────────────────────────────────────────
const W = 900, H = 348
const PL = 44, PR = 16, PT = 54, PB = 28
const CW = W - PL - PR   // 840

const TEMP_TOP   = PT            // 54
const TEMP_H     = 148
const PREC_TOP   = TEMP_TOP + TEMP_H + 10   // 212
const PREC_H     = 50
const WIND_TOP   = PREC_TOP + PREC_H + 8    // 270
const WIND_H     = 30
const XLAB_Y     = WIND_TOP + WIND_H + 14   // 314

// 3-hourly resolution for 3 days = 24 sample points
const STEP = 3, N_DAYS = 3, N_MAX = (N_DAYS * 24) / STEP   // 24

const TOP_N = 5
const PREFERRED_FAMILIES = [
  ['gfs'], ['ecmwf'], ['arome_hd', 'arome'], ['knmi_harmonie', 'dmi_harmonie'], ['icon_eu', 'icon'],
]

const ENS_T_CLR = '#c0392b'
const ENS_P_CLR = '#2563eb'

function avg(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** Catmull-Rom → SVG cubic bezier smooth curve through all points */
function smoothPath(pts: [number, number][]): string {
  if (!pts.length) return ''
  if (pts.length < 2) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

function seedTopModels(keys: string[]) {
  if (!keys.length) return
  const sel = new Set<string>()
  for (const fam of PREFERRED_FAMILIES) {
    if (sel.size >= TOP_N) break
    const match = fam.find(k => keys.includes(k))
    if (match) sel.add(match)
  }
  if (sel.size < TOP_N) {
    const loc = state.currentLoc, obs = state.currentObs
    const wts = computeModelWeights(
      keys, loc?.latitude ?? 0, loc?.longitude ?? 0, loc?.elevation ?? 0,
      state.wxData, obs?.temp, obs?.time,
    )
    const sorted = [...keys].sort((a, b) => (wts[b] ?? 0) - (wts[a] ?? 0))
    for (const k of sorted) { if (sel.size >= TOP_N) break; if (!sel.has(k)) sel.add(k) }
  }
  state.chartSelectedModels = sel
}

export function renderChart(_onMetricChange?: (key: string) => void) {
  const lang = LANG_DATA[state.lang]
  const el   = document.getElementById('chartCard')!

  const loaded = getActiveModels().filter(m => state.wxData[m.key] != null)
  if (!loaded.length) { el.innerHTML = ''; return }

  const loadedKeys = loaded.map(m => m.key)
  if (!state.chartSelectedModels || loadedKeys.every(k => !state.chartSelectedModels!.has(k)))
    seedTopModels(loadedKeys)

  const sel        = state.chartSelectedModels!
  const visible    = loaded.filter(m => sel.has(m.key))
  const renderList = visible.length ? visible : loaded.slice(0, 1)

  // Reference timestamps from first visible model
  const refKey   = (renderList[0] ?? loaded[0]).key
  const allTimes = state.wxData[refKey]?.hourly.time ?? []

  // Start from current hour rounded down to nearest STEP boundary
  const nowStr = new Date().toISOString().slice(0, 13)
  let si = allTimes.findIndex(ts => ts >= nowStr)
  if (si < 0) si = 0
  si = Math.floor(si / STEP) * STEP

  const indices = Array.from({ length: N_MAX }, (_, i) => si + i * STEP)
    .filter(idx => idx < allTimes.length)
  const nPts = indices.length
  if (nPts < 2) { el.innerHTML = ''; return }

  // ── Compute ensemble averages ──────────────────────────────────────────────
  const ensTemp   = indices.map(idx => avg(renderList.map(m => state.wxData[m.key]?.hourly.temperature_2m[idx]    ?? null)))
  const ensPrecip = indices.map(idx => avg(renderList.map(m => state.wxData[m.key]?.hourly.precipitation[idx]      ?? null)))
  const ensWind   = indices.map(idx => avg(renderList.map(m => state.wxData[m.key]?.hourly.wind_speed_10m[idx]     ?? null)))
  const ensDir    = indices.map(idx => avg(renderList.map(m => state.wxData[m.key]?.hourly.wind_direction_10m[idx] ?? null)))

  // ── Temperature scale ──────────────────────────────────────────────────────
  const tempVals: number[] = []
  for (const m of renderList)
    for (const idx of indices) {
      const v = state.wxData[m.key]?.hourly.temperature_2m[idx] ?? null
      if (v !== null) tempVals.push(v)
    }
  ensTemp.forEach(v => v !== null && tempVals.push(v))
  const tMin = Math.floor(Math.min(...tempVals)) - 1
  const tMax = Math.ceil(Math.max(...tempVals))  + 1
  const tRng = tMax - tMin || 1

  const maxPrecip = Math.max(...ensPrecip.map(v => v ?? 0), 0.5)

  // ── Coordinate helpers ──────────────────────────────────────────────────────
  const sx  = (i: number) => PL + (i / (nPts - 1)) * CW
  const syT = (v: number) => TEMP_TOP + TEMP_H - ((v - tMin) / tRng) * TEMP_H

  const barW = CW / nPts

  // ── Night shading ──────────────────────────────────────────────────────────
  let nightRects = ''
  let nStart: number | null = null
  for (let i = 0; i <= nPts; i++) {
    const ts   = allTimes[indices[i] ?? -1] ?? ''
    const hr   = ts ? parseInt(ts.slice(11, 13)) : -1
    const isNight = hr >= 21 || (hr >= 0 && hr < 6)
    if (isNight && nStart === null) {
      nStart = sx(i) - barW / 2
    } else if (!isNight && nStart !== null) {
      const w = sx(i - 1) + barW / 2 - nStart
      if (w > 0) nightRects += `<rect x="${nStart.toFixed(1)}" y="${TEMP_TOP}" width="${w.toFixed(1)}" height="${WIND_TOP + WIND_H - TEMP_TOP}" fill="rgba(0,30,80,0.04)"/>`
      nStart = null
    }
  }
  if (nStart !== null) {
    const w = sx(nPts - 1) + barW / 2 - nStart
    if (w > 0) nightRects += `<rect x="${nStart.toFixed(1)}" y="${TEMP_TOP}" width="${w.toFixed(1)}" height="${WIND_TOP + WIND_H - TEMP_TOP}" fill="rgba(0,30,80,0.04)"/>`
  }

  // ── Day separators + date headers ─────────────────────────────────────────
  let daySeps = '', dayHeaders = ''
  const today = new Date().toISOString().slice(0, 10)
  let prevDate = ''
  for (let i = 0; i < nPts; i++) {
    const ts   = allTimes[indices[i]] ?? ''
    const date = ts.slice(0, 10)
    if (date === prevDate) continue
    prevDate = date
    const x = sx(i)
    const d = new Date(ts)
    const lbl = date === today ? lang.today : `${lang.days[d.getDay()]} ${d.getDate()}`
    if (i > 0) daySeps += `<line x1="${x.toFixed(1)}" y1="${TEMP_TOP - 6}" x2="${x.toFixed(1)}" y2="${WIND_TOP + WIND_H}" stroke="rgba(0,30,80,0.15)" stroke-width="1" stroke-dasharray="3,4"/>`
    dayHeaders += `<text x="${x.toFixed(1)}" y="${TEMP_TOP - 10}" fill="var(--text)" font-size="12" font-weight="700">${lbl}</text>`
  }

  // ── Temperature grid + Y labels ────────────────────────────────────────────
  let tempGrid = ''
  const gridStep = tRng <= 8 ? 2 : tRng <= 20 ? 4 : 5
  const gridStart = Math.ceil(tMin / gridStep) * gridStep
  for (let v = gridStart; v <= tMax; v += gridStep) {
    const y = syT(v)
    tempGrid += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="rgba(0,30,80,0.06)" stroke-width="1"/>`
    tempGrid += `<text x="${(PL - 6).toFixed(1)}" y="${(y + 4).toFixed(1)}" fill="var(--text-muted)" font-size="10" text-anchor="end">${v}°</text>`
  }

  // ── Individual model lines (dimmed behind ensemble) ───────────────────────
  let modelLines = ''
  for (const m of renderList) {
    const pts: [number, number][] = []
    for (let i = 0; i < nPts; i++) {
      const v = state.wxData[m.key]?.hourly.temperature_2m[indices[i]] ?? null
      if (v !== null) pts.push([sx(i), syT(v)])
    }
    if (pts.length > 1)
      modelLines += `<path d="${smoothPath(pts)}" fill="none" stroke="${m.color}" stroke-width="1.5" stroke-linecap="round" opacity="0.22"/>`
  }

  // ── Ensemble temperature curve ─────────────────────────────────────────────
  const ensPts: [number, number][] = []
  for (let i = 0; i < nPts; i++) {
    const v = ensTemp[i]
    if (v !== null) ensPts.push([sx(i), syT(v)])
  }

  // Dots every 2nd point to avoid clutter
  const ensDots = ensPts.map((pt, i) =>
    i % 2 === 0
      ? `<circle cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="3.5" fill="${ENS_T_CLR}" stroke="#fff" stroke-width="1.5"/>`
      : ''
  ).join('')

  // ── Temperature labels at local peaks/troughs (min gap = 4 points) ─────────
  let tempLabels = ''
  let lastLblIdx = -5
  for (let i = 0; i < nPts; i++) {
    const v = ensTemp[i]
    if (v === null) continue
    const prev = i > 0 ? ensTemp[i - 1] : null
    const next = i < nPts - 1 ? ensTemp[i + 1] : null
    const isPeak   = (prev === null || v > prev) && (next === null || v >= next)
    const isTrough = (prev === null || v < prev) && (next === null || v <= next)
    if ((!isPeak && !isTrough) || i - lastLblIdx < 4) continue
    lastLblIdx = i
    const y = syT(v)
    const ly = isPeak ? y - 9 : y + 14
    const anchor = i < 2 ? 'start' : i > nPts - 3 ? 'end' : 'middle'
    tempLabels += `<text x="${sx(i).toFixed(1)}" y="${ly.toFixed(1)}" fill="${ENS_T_CLR}" font-size="11" font-weight="800" text-anchor="${anchor}">${v.toFixed(0)}°</text>`
  }

  // ── Precipitation bars ─────────────────────────────────────────────────────
  const bW = Math.max(5, barW * 0.62)
  let precipBars = ''
  precipBars += `<line x1="${PL}" y1="${(PREC_TOP + PREC_H).toFixed(1)}" x2="${(W - PR).toFixed(1)}" y2="${(PREC_TOP + PREC_H).toFixed(1)}" stroke="rgba(0,30,80,0.1)" stroke-width="1"/>`
  precipBars += `<text x="${(PL - 6).toFixed(1)}" y="${(PREC_TOP + PREC_H / 2 + 3).toFixed(1)}" fill="var(--text-muted)" font-size="9" text-anchor="end">mm</text>`
  for (let i = 0; i < nPts; i++) {
    const v = ensPrecip[i]
    if (v === null || v < 0.05) continue
    const bH = Math.max(2, (v / maxPrecip) * PREC_H)
    const bX = sx(i) - bW / 2
    const bY = PREC_TOP + PREC_H - bH
    precipBars += `<rect x="${bX.toFixed(1)}" y="${bY.toFixed(1)}" width="${bW.toFixed(1)}" height="${bH.toFixed(1)}" fill="${ENS_P_CLR}" rx="2" opacity="0.82"/>`
    if (v >= 0.2)
      precipBars += `<text x="${sx(i).toFixed(1)}" y="${(bY - 3).toFixed(1)}" fill="${ENS_P_CLR}" font-size="9" font-weight="700" text-anchor="middle">${v.toFixed(1)}</text>`
  }

  // ── Wind strip ────────────────────────────────────────────────────────────
  const windCY = WIND_TOP + 10
  const spdY   = WIND_TOP + WIND_H - 2
  let windStrip = `<text x="${(PL - 6).toFixed(1)}" y="${(windCY + 4).toFixed(1)}" fill="var(--text-muted)" font-size="9" text-anchor="end">km/h</text>`
  for (let i = 0; i < nPts; i++) {
    const spd = ensWind[i], dir = ensDir[i]
    if (spd === null) continue
    const x = sx(i)
    let clr = '#78909c'
    if (spd >= 50)      clr = '#991b1b'
    else if (spd >= 30) clr = '#b45309'
    else if (spd >= 15) clr = '#2e7d32'
    if (dir !== null) {
      // Arrow points toward where wind blows (FROM direction + 180°)
      const rot = (dir + 180) % 360
      windStrip += `<g transform="translate(${x.toFixed(1)},${windCY}) rotate(${rot})">
        <polygon points="0,-7 3.5,4 0,1.5 -3.5,4" fill="${clr}" opacity="0.85"/>
      </g>`
    }
    windStrip += `<text x="${x.toFixed(1)}" y="${spdY.toFixed(1)}" fill="var(--text-muted)" font-size="9" text-anchor="middle">${Math.round(spd)}</text>`
  }

  // ── X-axis hour labels ─────────────────────────────────────────────────────
  let xLabels = ''
  const labelEach = nPts >= 20 ? 2 : 1
  for (let i = 0; i < nPts; i += labelEach) {
    const ts = allTimes[indices[i]] ?? ''
    const hr = ts ? parseInt(ts.slice(11, 13)) : -1
    if (hr < 0) continue
    xLabels += `<text x="${sx(i).toFixed(1)}" y="${XLAB_Y}" fill="var(--text-muted)" font-size="10" text-anchor="middle">${hr.toString().padStart(2, '0')}</text>`
  }

  // ── Interactive hit areas ──────────────────────────────────────────────────
  const hitAreas = Array.from({ length: nPts }, (_, i) =>
    `<rect class="chart-hit" data-si="${i}" x="${(sx(i) - barW / 2).toFixed(1)}" y="${TEMP_TOP}" width="${barW.toFixed(1)}" height="${WIND_TOP + WIND_H - TEMP_TOP}" fill="transparent" style="cursor:crosshair"/>`
  ).join('')

  const hlLine = `<line class="chart-hl" x1="0" y1="${TEMP_TOP}" x2="0" y2="${WIND_TOP + WIND_H}" stroke="rgba(0,30,80,0.18)" stroke-width="1" stroke-dasharray="4,3" style="display:none"/>`

  const tooltipGroup = `<g class="chart-tip" style="display:none;pointer-events:none">
    <rect class="chart-tip-bg" rx="6" ry="6" fill="#ffffff" stroke="#d0dce8" stroke-width="1" filter="url(#tip-shadow)"/>
    <g class="chart-tip-lines"></g>
  </g>`

  // ── Legend ─────────────────────────────────────────────────────────────────
  const legendHtml = `<span class="leg-item leg-ens-avg">
    <svg width="22" height="6" style="flex-shrink:0;display:block"><line x1="1" y1="3" x2="21" y2="3" stroke="${ENS_T_CLR}" stroke-width="3" stroke-linecap="round"/></svg>
    ${lang.ensemble}
  </span>` + loaded.map(m => {
    const active = sel.has(m.key)
    return `<button class="leg-item leg-toggle${active ? ' leg-active' : ''}" data-model-key="${m.key}" title="${active ? 'Click to hide' : 'Click to show'}">
      <span class="leg-dot" style="background:${active ? m.color : 'transparent'};border-color:${m.color}"></span>
      ${m.flag} ${m.name}
    </button>`
  }).join('')

  el.innerHTML = `
    <div class="chart-header"><div class="section-title">${lang.chartTitle}</div></div>
    <div class="chart-scroll">
      <svg class="chart-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <defs>
          <filter id="tip-shadow" x="-10%" y="-20%" width="120%" height="150%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,30,80,0.12)"/>
          </filter>
        </defs>
        ${nightRects}
        ${tempGrid}
        ${daySeps}
        ${dayHeaders}
        ${modelLines}
        <path d="${smoothPath(ensPts)}" fill="none" stroke="${ENS_T_CLR}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        ${ensDots}
        ${tempLabels}
        ${precipBars}
        ${windStrip}
        ${xLabels}
        ${hlLine}
        ${hitAreas}
        ${tooltipGroup}
      </svg>
    </div>
    <div class="chart-legend">${legendHtml}</div>
  `

  // ── Interactivity ──────────────────────────────────────────────────────────
  const svgEl  = el.querySelector<SVGSVGElement>('.chart-svg')!
  const tipGrp = svgEl.querySelector<SVGGElement>('.chart-tip')!
  const tipBg  = svgEl.querySelector<SVGRectElement>('.chart-tip-bg')!
  const tipLns = svgEl.querySelector<SVGGElement>('.chart-tip-lines')!
  const hlEl   = svgEl.querySelector<SVGLineElement>('.chart-hl')!

  svgEl.querySelectorAll<SVGRectElement>('.chart-hit').forEach(rect => {
    const i = parseInt(rect.dataset.si!)

    rect.addEventListener('mouseenter', () => {
      const cx = sx(i)
      hlEl.setAttribute('x1', String(cx)); hlEl.setAttribute('x2', String(cx))
      hlEl.style.display = ''

      const ts = allTimes[indices[i]] ?? ''
      const d  = ts ? new Date(ts) : new Date()
      const hr = ts ? parseInt(ts.slice(11, 13)) : 0
      const dayLbl = `${lang.days[d.getDay()]} ${d.getDate()} ${hr.toString().padStart(2, '0')}:00`

      const rows: { name: string; color: string; val: string; bold?: boolean }[] = []
      const eT = ensTemp[i], eP = ensPrecip[i], eW = ensWind[i]
      rows.push({ name: `${lang.ensemble}`, color: ENS_T_CLR, bold: true, val: eT !== null ? `${eT.toFixed(1)}°C` : '—' })
      if (eP !== null && eP >= 0.05) rows.push({ name: lang.statPrecip, color: ENS_P_CLR, val: `${eP.toFixed(1)} mm` })
      if (eW !== null) rows.push({ name: lang.statWind, color: '#546e7a', val: `${Math.round(eW)} km/h` })
      for (const m of renderList) {
        const v = state.wxData[m.key]?.hourly.temperature_2m[indices[i]] ?? null
        if (v !== null) rows.push({ name: `${m.flag} ${m.name}`, color: m.color, val: `${v.toFixed(1)}°C` })
      }

      const lh = 15, tipW = 200
      const tipH = 22 + rows.length * lh
      let inner = `<text x="8" y="14" fill="#0c1a2e" font-size="11" font-weight="700">${dayLbl}</text>`
      rows.forEach((row, ri) => {
        const ry  = 14 + (ri + 1) * lh
        const fw  = row.bold ? '800' : '600'
        const clr = row.bold ? '#0c1a2e' : '#4d6888'
        inner += `<rect x="8" y="${ry - 8}" width="8" height="8" rx="2" fill="${row.color}"/>
          <text x="20" y="${ry}" fill="${clr}" font-size="10" font-weight="${fw}">${row.name}</text>
          <text x="${tipW - 8}" y="${ry}" fill="${row.color}" font-size="10" text-anchor="end" font-weight="${fw}">${row.val}</text>`
      })

      let tx = cx + 14
      if (tx + tipW > W - PR) tx = cx - tipW - 14
      tipBg.setAttribute('x', String(tx)); tipBg.setAttribute('y', String(TEMP_TOP + 4))
      tipBg.setAttribute('width', String(tipW)); tipBg.setAttribute('height', String(tipH))
      tipLns.setAttribute('transform', `translate(${tx},${TEMP_TOP + 4})`)
      tipLns.innerHTML = inner
      tipGrp.style.display = ''
    })

    rect.addEventListener('mouseleave', () => {
      tipGrp.style.display = 'none'
      hlEl.style.display   = 'none'
    })
  })

  // Model toggle clicks
  el.querySelectorAll<HTMLButtonElement>('.leg-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.modelKey!
      if (sel.has(key)) { if (sel.size <= 1) return; sel.delete(key) } else sel.add(key)
      renderChart()
    })
  })
}
