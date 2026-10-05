import { state } from '../state'
import { getActiveModels, modelValidForDay } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getEnsembleForecast } from '../utils/data'
import { fmt, avg } from '../utils/weather'
import type { OpenMeteoResponse } from '../types'
import { tempMaxColor, tempMinColor, rainPctColor, precipColor, windColor } from '../utils/colors'

/** Pre-compute per-day avg wind, avg gusts (km/h) and avg precipitation (mm) from valid models */
function buildDayExtras(count: number): { wind: (number|null)[]; gust: (number|null)[]; precip: (number|null)[] } {
  const wind:   (number|null)[] = []
  const gust:   (number|null)[] = []
  const precip: (number|null)[] = []
  for (let i = 0; i < count; i++) {
    const mods = getActiveModels()
      .filter(m => modelValidForDay(m, i) && state.wxData[m.key] != null)
      .map(m => state.wxData[m.key] as OpenMeteoResponse)
    const winds  = mods.map(m => m.daily.wind_speed_10m_max[i]  ?? null).filter((v): v is number => v !== null)
    const gusts  = mods.map(m => m.daily.wind_gusts_10m_max?.[i] ?? null).filter((v): v is number => v !== null)
    const precips = mods.map(m => m.daily.precipitation_sum?.[i] ?? null).filter((v): v is number => v !== null)
    wind.push(winds.length   ? avg(winds)   : null)
    gust.push(gusts.length   ? avg(gusts)   : null)
    precip.push(precips.length ? avg(precips) : null)
  }
  return { wind, gust, precip }
}

export function renderForecastStrip() {
  const t    = LANG_DATA[state.lang]
  const days = getEnsembleForecast(state.wxData, t.wx, 7)
  const el         = document.getElementById('forecastStrip')!
  const expandRow  = document.getElementById('forecastExpandRow')!
  const expandBtn  = document.getElementById('forecastExpandBtn')!
  const extraEl    = document.getElementById('forecastStripExtra')!

  const today  = new Date().toISOString().slice(0, 10)
  const extras = buildDayExtras(days.length)

  // Max precip across all days — used to scale the precipitation bars
  const maxPrecip = Math.max(
    ...extras.precip.map(v => v ?? 0),
    1,  // avoid division by zero
  )

  function renderDayCards(arr: typeof days, startI: number): string {
    return arr.map((d, offset) => {
      const i           = startI + offset
      const date        = new Date(d.date + 'T12:00:00')
      const isToday     = d.date === today
      const isSelected  = state.selectedDay === i
      const dayName     = isToday ? t.today : t.days[date.getDay()]
      const dayNum      = date.getDate()
      const mon         = t.months[date.getMonth()]
      const rainPct     = d.rain !== null ? Math.round(d.rain) : null
      const gustVal     = extras.gust[i]
      const windVal     = extras.wind[i]
      const precipVal   = extras.precip[i]
      const displayWind = gustVal ?? windVal

      // Precipitation bar: width relative to the wettest day in the week
      const barPct   = precipVal != null && precipVal > 0
        ? Math.min((precipVal / maxPrecip) * 100, 100) : 0
      const barColor = precipVal != null && precipVal > 0 ? precipColor(precipVal) : 'transparent'

      let cls = 'strip-day'
      if (isToday)    cls += ' today'
      if (isSelected) cls += ' selected'

      // Compact chip row — rain%, mm, wind — shown only when meaningful
      const rainChip = rainPct !== null
        ? `<span class="strip-chip" style="color:${rainPctColor(d.rain)}" title="${t.tipRain}">${rainPct}%</span>`
        : ''
      const mmChip = precipVal !== null && precipVal > 0
        ? `<span class="strip-chip" style="color:${precipColor(precipVal)}" title="${t.tipPrecip}">${fmt(precipVal, precipVal < 10 ? 1 : 0)}mm</span>`
        : ''
      const windChip = displayWind !== null
        ? `<span class="strip-chip" style="color:${windColor(displayWind)}" title="${t.tipGusts}">↑${fmt(displayWind, 0)}</span>`
        : ''

      return `
        <div class="${cls}" data-day="${i}" role="button" tabindex="0"
             aria-label="${dayName} ${dayNum} ${mon}, ${fmt(d.maxT,0)}° / ${fmt(d.minT,0)}°${rainPct !== null ? ', ' + rainPct + '% ' + t.tipRain : ''}">
          <div class="strip-dname">${dayName}</div>
          <div class="strip-date">${dayNum} ${mon}</div>
          <div class="strip-icon">${d.cond.icon}</div>
          <div class="strip-tmax" style="color:${tempMaxColor(d.maxT)}">${fmt(d.maxT, 0)}°</div>
          <div class="strip-tmin" style="color:${tempMinColor(d.minT)}">${fmt(d.minT, 0)}°</div>
          <div class="strip-chips">${rainChip}${mmChip}${windChip}</div>
          ${i === 0 && d.n > 1 ? `<div class="strip-models">${t.nModels(d.n)}</div>` : ''}
          <div class="strip-precip-bar-wrap" title="${precipVal != null && precipVal > 0 ? fmt(precipVal,1) + ' mm' : ''}">
            <div class="strip-precip-bar" style="width:${barPct.toFixed(1)}%;background:${barColor}"></div>
          </div>
        </div>
      `
    }).join('')
  }

  // Main strip: first 4 days (today + 3 more)
  const first4 = days.slice(0, 4)
  const rest3  = days.slice(4)

  el.innerHTML = renderDayCards(first4, 0)

  // Expand row
  if (rest3.length > 0) {
    expandRow.classList.remove('hidden')
    expandBtn.textContent = state.forecastDaysExpanded
      ? t.collapseForecast + ' ▴'
      : t.expandForecast + ' ▾'
    extraEl.innerHTML = state.forecastDaysExpanded ? renderDayCards(rest3, 4) : ''
    extraEl.classList.toggle('hidden', !state.forecastDaysExpanded)
  } else {
    expandRow.classList.add('hidden')
  }

  // Click + keyboard handlers for day cards
  function attachClicks(container: HTMLElement) {
    container.querySelectorAll<HTMLDivElement>('.strip-day').forEach(dayEl => {
      const selectDay = () => {
        const i = parseInt(dayEl.dataset.day!)
        state.selectedDay = i
        document.dispatchEvent(new CustomEvent('mm:daySelected', { detail: i }))
      }
      dayEl.addEventListener('click', selectDay)
      dayEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDay() }
      })
    })
  }
  attachClicks(el)
  if (state.forecastDaysExpanded) attachClicks(extraEl)

  // Expand button handler
  expandBtn.onclick = () => {
    state.forecastDaysExpanded = !state.forecastDaysExpanded
    renderForecastStrip()
  }
}
