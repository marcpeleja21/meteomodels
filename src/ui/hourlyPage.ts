import { state } from '../state'
import { MODELS } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import type { OpenMeteoResponse, LangData } from '../types'
import { currentHourIdx } from '../utils/data'
import { wxFromCode, fmt, avg } from '../utils/weather'

const WIND_DIRS = ['↑','↗','→','↘','↓','↙','←','↖']
const STEP = 3   // show every 3 hours
const HOURS = 72 // 3 days

function modalCode(codes: (number | null)[]): number | null {
  const nums = codes.filter((n): n is number => n !== null)
  if (!nums.length) return null
  const cnt: Record<number, number> = {}
  nums.forEach(n => { cnt[n] = (cnt[n] ?? 0) + 1 })
  return +Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]
}

interface HourSlot {
  time: string; temp: number|null; rain: number|null
  wind: number|null; windDir: number|null; hum: number|null
  precip: number|null; code: number|null
}

function getEnsembleSlot(idx: number): HourSlot {
  const models = Object.values(state.wxData).filter((d): d is OpenMeteoResponse => d !== null)
  const h = (m: OpenMeteoResponse) => m.hourly
  return {
    time:    models[0]?.hourly.time[idx] ?? '',
    temp:    avg(models.map(m => h(m).temperature_2m[idx] ?? null)),
    rain:    avg(models.map(m => h(m).precipitation_probability[idx] ?? null)),
    wind:    avg(models.map(m => h(m).windspeed_10m[idx] ?? null)),
    windDir: avg(models.map(m => h(m).winddirection_10m[idx] ?? null)),
    hum:     avg(models.map(m => h(m).relative_humidity_2m[idx] ?? null)),
    precip:  avg(models.map(m => h(m).precipitation[idx] ?? null)),
    code:    modalCode(models.map(m => h(m).weathercode[idx] ?? null)),
  }
}

function getModelSlot(modelKey: string, idx: number): HourSlot {
  const d = state.wxData[modelKey]
  if (!d) return { time:'', temp:null, rain:null, wind:null, windDir:null, hum:null, precip:null, code:null }
  const h = d.hourly
  return {
    time:    h.time[idx] ?? '',
    temp:    h.temperature_2m[idx] ?? null,
    rain:    h.precipitation_probability[idx] ?? null,
    wind:    h.windspeed_10m[idx] ?? null,
    windDir: h.winddirection_10m[idx] ?? null,
    hum:     h.relative_humidity_2m[idx] ?? null,
    precip:  h.precipitation[idx] ?? null,
    code:    h.weathercode[idx] ?? null,
  }
}

function renderSlot(slot: HourSlot, t: LangData): string {
  if (!slot.time) return ''
  const d     = new Date(slot.time)
  const hh    = d.getHours().toString().padStart(2, '0') + ':00'
  const wx    = wxFromCode(slot.code, t.wx)
  const arrow = slot.windDir !== null ? WIND_DIRS[Math.round(slot.windDir / 45) % 8] : ''
  const rainHigh = (slot.rain ?? 0) >= 50
  const rainStyle = rainHigh ? 'color:var(--accent2);font-weight:700' : ''
  return `
    <div class="h-slot${rainHigh ? ' h-slot-rain' : ''}">
      <div class="h-time">${hh}</div>
      <div class="h-icon">${wx.icon}</div>
      <div class="h-temp">${slot.temp !== null ? Math.round(slot.temp) + '°' : '—'}</div>
      <div class="h-rain" style="${rainStyle}">💦 ${slot.rain !== null ? Math.round(slot.rain) + '%' : '—'}</div>
      ${(slot.precip ?? 0) > 0.1 ? `<div class="h-precip">🌧 ${fmt(slot.precip, 1)} mm</div>` : ''}
      <div class="h-wind">💨 ${slot.wind !== null ? Math.round(slot.wind) : '—'} ${arrow}</div>
      <div class="h-hum">💧 ${slot.hum !== null ? Math.round(slot.hum) + '%' : '—'}</div>
    </div>
  `
}

export function renderHourlyPage() {
  const el = document.getElementById('pageHourly')
  if (!el) return
  const t = LANG_DATA[state.lang]

  const loaded = MODELS.filter(m => state.wxData[m.key] != null)
  if (!loaded.length) { el.innerHTML = `<p style="padding:40px;color:var(--text-muted);text-align:center">${t.noData}</p>`; return }

  const modelKey = state.hourlyModel
  const refData  = modelKey === 'ensemble'
    ? Object.values(state.wxData).find((d): d is OpenMeteoResponse => d !== null)
    : state.wxData[modelKey]

  if (!refData) { el.innerHTML = ''; return }

  const startIdx = currentHourIdx(refData.hourly.time)

  // Build slots and group by day
  interface DayGroup { label: string; slots: string[] }
  const dayGroups: DayGroup[] = []
  let lastDay = ''

  for (let offset = 0; offset < HOURS; offset += STEP) {
    const idx = startIdx + offset
    if (idx >= refData.hourly.time.length) break

    const slot  = modelKey === 'ensemble' ? getEnsembleSlot(idx) : getModelSlot(modelKey, idx)
    const d     = new Date(slot.time)
    const dayStr= slot.time.slice(0, 10)

    if (dayStr !== lastDay) {
      lastDay = dayStr
      const isToday = dayStr === new Date().toISOString().slice(0, 10)
      const dayLabel = isToday
        ? t.today
        : `${t.days[d.getDay()]} ${d.getDate()} ${t.months[d.getMonth()]}`
      dayGroups.push({ label: dayLabel, slots: [] })
    }
    dayGroups[dayGroups.length - 1].slots.push(renderSlot(slot, t))
  }

  // Model selector tabs
  const modelTabs = [
    `<button class="ctrl-tab${modelKey === 'ensemble' ? ' active' : ''}" data-hmdl="ensemble">⚖ ${t.ensemble}</button>`,
    ...loaded.map(m =>
      `<button class="ctrl-tab${modelKey === m.key ? ' active' : ''}" data-hmdl="${m.key}">${m.flag} ${m.name}</button>`
    )
  ].join('')

  el.innerHTML = `
    <div class="hourly-page">
      <div class="hourly-controls">
        <div class="ctrl-group">
          <span class="ctrl-label">${t.navHourly}:</span>
          <div class="ctrl-tabs">${modelTabs}</div>
        </div>
      </div>
      ${dayGroups.map(g => `
        <div class="hourly-day-section">
          <div class="hourly-day-label">${g.label}</div>
          <div class="hourly-scroll">
            <div class="hourly-grid">${g.slots.join('')}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `

  el.querySelectorAll<HTMLButtonElement>('[data-hmdl]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.hourlyModel = btn.dataset.hmdl!
      renderHourlyPage()
    })
  })
}
