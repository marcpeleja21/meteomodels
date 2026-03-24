import { state } from '../state'
import { LANG_DATA } from '../config/i18n'
import { getEnsembleForecast } from '../utils/data'
import { fmt } from '../utils/weather'

export function renderForecastStrip() {
  const t    = LANG_DATA[state.lang]
  const days = getEnsembleForecast(state.wxData, t.wx, 5)
  const el   = document.getElementById('forecastStrip')!

  const today = new Date().toISOString().slice(0, 10)

  el.innerHTML = days.map((d, i) => {
    const date     = new Date(d.date + 'T12:00:00')
    const isToday  = d.date === today
    const isSelected = state.selectedDay === i
    const dayName  = isToday ? t.today : t.days[date.getDay()]
    const dayNum   = date.getDate()
    const mon      = t.months[date.getMonth()]
    const rainPct  = d.rain !== null ? `${Math.round(d.rain)}%` : ''

    let cls = 'strip-day'
    if (isToday)    cls += ' today'
    if (isSelected) cls += ' selected'

    return `
      <div class="${cls}" data-day="${i}">
        <div class="strip-dname">${dayName}</div>
        <div style="font-size:.68rem;color:var(--text-dim)">${dayNum} ${mon}</div>
        <div class="strip-icon">${d.cond.icon}</div>
        <div class="strip-temps">${fmt(d.maxT, 0)}° <span>/ ${fmt(d.minT, 0)}°</span></div>
        ${rainPct ? `<div class="strip-rain">💧 ${rainPct}</div>` : ''}
        ${i === 0 && d.n > 1 ? `<div class="strip-models">${t.nModels(d.n)}</div>` : ''}
      </div>
    `
  }).join('')

  // Click handlers — dispatch custom event so main.ts can coordinate re-renders
  el.querySelectorAll<HTMLDivElement>('.strip-day').forEach(dayEl => {
    dayEl.addEventListener('click', () => {
      const i = parseInt(dayEl.dataset.day!)
      state.selectedDay = i
      document.dispatchEvent(new CustomEvent('mm:daySelected', { detail: i }))
    })
  })
}
