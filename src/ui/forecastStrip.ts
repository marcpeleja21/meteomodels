import { state } from '../state'
import { MODELS, modelValidForDay } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import { getEnsembleForecast } from '../utils/data'
import { fmt, avg } from '../utils/weather'
import type { OpenMeteoResponse } from '../types'
import { tempMaxColor, tempMinColor, rainPctColor, precipColor, windColor } from '../utils/colors'

/** Pre-compute per-day avg wind (km/h) and avg precipitation (mm) from valid models */
function buildDayExtras(count: number): { wind: (number|null)[]; precip: (number|null)[] } {
  const wind:   (number|null)[] = []
  const precip: (number|null)[] = []
  for (let i = 0; i < count; i++) {
    const mods = MODELS
      .filter(m => modelValidForDay(m, i) && state.wxData[m.key] != null)
      .map(m => state.wxData[m.key] as OpenMeteoResponse)
    const winds   = mods.map(m => m.daily.wind_speed_10m_max[i] ?? null).filter((v): v is number => v !== null)
    const precips = mods.map(m => m.daily.precipitation_sum?.[i] ?? null).filter((v): v is number => v !== null)
    wind.push(winds.length   ? avg(winds)   : null)
    precip.push(precips.length ? avg(precips) : null)
  }
  return { wind, precip }
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

  function renderDayCards(arr: typeof days, startI: number): string {
    return arr.map((d, offset) => {
      const i          = startI + offset
      const date       = new Date(d.date + 'T12:00:00')
      const isToday    = d.date === today
      const isSelected = state.selectedDay === i
      const dayName    = isToday ? t.today : t.days[date.getDay()]
      const dayNum     = date.getDate()
      const mon        = t.months[date.getMonth()]
      const rainPct    = d.rain !== null ? `${Math.round(d.rain)}%` : ''
      const windVal    = extras.wind[i]
      const precipVal  = extras.precip[i]

      let cls = 'strip-day'
      if (isToday)    cls += ' today'
      if (isSelected) cls += ' selected'

      return `
        <div class="${cls}" data-day="${i}">
          <div class="strip-dname">${dayName}</div>
          <div style="font-size:.68rem;color:var(--text-dim)">${dayNum} ${mon}</div>
          <div class="strip-icon">${d.cond.icon}</div>
          <div class="strip-temps">
            <span style="color:${tempMaxColor(d.maxT)}">${fmt(d.maxT, 0)}°</span>
            <span style="color:#444"> / </span>
            <span style="color:${tempMinColor(d.minT)}">${fmt(d.minT, 0)}°</span>
          </div>
          ${rainPct ? `<div class="strip-rain" style="color:${rainPctColor(d.rain)}">💦 ${rainPct}</div>` : ''}
          ${precipVal !== null && precipVal > 0 ? `<div class="strip-precip" style="color:${precipColor(precipVal)}">🌧 ${fmt(precipVal, 1)} mm</div>` : ''}
          ${windVal !== null ? `<div class="strip-wind" style="color:${windColor(windVal)}">💨 ${fmt(windVal, 0)} km/h</div>` : ''}
          ${i === 0 && d.n > 1 ? `<div class="strip-models">${t.nModels(d.n)}</div>` : ''}
        </div>
      `
    }).join('')
  }

  // Render first 4 days
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

  // Click handlers for day cards
  function attachClicks(container: HTMLElement) {
    container.querySelectorAll<HTMLDivElement>('.strip-day').forEach(dayEl => {
      dayEl.addEventListener('click', () => {
        const i = parseInt(dayEl.dataset.day!)
        state.selectedDay = i
        document.dispatchEvent(new CustomEvent('mm:daySelected', { detail: i }))
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
