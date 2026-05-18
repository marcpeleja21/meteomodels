import { state } from '../state'
import { getActiveModels, modelValidForHours } from '../config/models'
import { LANG_DATA } from '../config/i18n'
import type { OpenMeteoResponse, LangData } from '../types'
import { currentHourIdx } from '../utils/data'
import { wxFromCode, inferCodeFromPrecip, fmt, avg } from '../utils/weather'
import { tempColor, rainPctColor, precipColor, windColor, humidityColor } from '../utils/colors'
import { computeModelWeights } from '../utils/modelWeights'

const WIND_DIRS = ['↑','↗','→','↘','↓','↙','←','↖']
const STEP = 2   // show every 2 hours
const HOURS = 72 // 3 days

function modalCode(codes: (number | null)[]): number | null {
  const nums = codes.filter((n): n is number => n !== null)
  if (!nums.length) return null
  const cnt: Record<number, number> = {}
  nums.forEach(n => { cnt[n] = (cnt[n] ?? 0) + 1 })
  return +Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]
}

/** Weighted average — skips null values and re-normalises weights. */
function wavg(vals: (number | null)[], weights: number[]): number | null {
  let sum = 0, wsum = 0
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] !== null) {
      sum  += vals[i]! * weights[i]
      wsum += weights[i]
    }
  }
  return wsum > 0 ? sum / wsum : null
}

interface HourSlot {
  time: string; temp: number|null; rain: number|null
  gust: number|null; windDir: number|null; hum: number|null
  precip: number|null; code: number|null
}

function getEnsembleSlot(
  idx: number,
  hoursFromNow: number,
  weights: Record<string, number>,
): HourSlot {
  // Only include models whose forecast range covers this hour.
  // Short-range LAMs (AROME HD, HARMONIE, ICON D2 …) are excluded once
  // we pass their maxDays horizon, keeping global models for hours 49–72.
  const validModels = getActiveModels()
    .filter(m => modelValidForHours(m, hoursFromNow) && state.wxData[m.key] != null)

  if (!validModels.length) {
    // Fallback: use all loaded models (should not normally happen)
    const all = Object.values(state.wxData).filter((d): d is OpenMeteoResponse => d !== null)
    if (!all.length) return { time:'', temp:null, rain:null, gust:null, windDir:null, hum:null, precip:null, code:null }
    const h = (m: OpenMeteoResponse) => m.hourly
    return {
      time:    all[0].hourly.time[idx] ?? '',
      temp:    avg(all.map(m => h(m).temperature_2m[idx] ?? null)),
      rain:    avg(all.map(m => h(m).precipitation_probability[idx] ?? null)),
      gust:    avg(all.map(m => h(m).wind_gusts_10m[idx] ?? null)),
      windDir: avg(all.map(m => h(m).wind_direction_10m[idx] ?? null)),
      hum:     avg(all.map(m => h(m).relative_humidity_2m[idx] ?? null)),
      precip:  avg(all.map(m => h(m).precipitation[idx] ?? null)),
      code:    modalCode(all.map(m => h(m).weather_code[idx] ?? inferCodeFromPrecip(h(m).precipitation[idx] ?? null))),
    }
  }

  // Use the pre-computed location-aware weights (from computeModelWeights).
  // Re-normalise over only the models that are valid at this hour so that
  // the weights still sum to 1 even when short-range models drop out.
  const wArr = validModels.map(m => weights[m.key] ?? 1 / validModels.length)
  const h = (key: string) => state.wxData[key]!.hourly

  return {
    time:    h(validModels[0].key).time[idx] ?? '',
    temp:    wavg(validModels.map(m => h(m.key).temperature_2m[idx] ?? null),          wArr),
    rain:    wavg(validModels.map(m => h(m.key).precipitation_probability[idx] ?? null), wArr),
    gust:    wavg(validModels.map(m => h(m.key).wind_gusts_10m[idx] ?? null),           wArr),
    windDir: wavg(validModels.map(m => h(m.key).wind_direction_10m[idx] ?? null),       wArr),
    hum:     wavg(validModels.map(m => h(m.key).relative_humidity_2m[idx] ?? null),     wArr),
    precip:  wavg(validModels.map(m => h(m.key).precipitation[idx] ?? null),            wArr),
    code:    modalCode(validModels.map(m => h(m.key).weather_code[idx] ?? inferCodeFromPrecip(h(m.key).precipitation[idx] ?? null))),
  }
}

function getModelSlot(modelKey: string, idx: number): HourSlot {
  const d = state.wxData[modelKey]
  if (!d) return { time:'', temp:null, rain:null, gust:null, windDir:null, hum:null, precip:null, code:null }
  const h = d.hourly
  return {
    time:    h.time[idx] ?? '',
    temp:    h.temperature_2m[idx] ?? null,
    rain:    h.precipitation_probability[idx] ?? null,
    gust:    h.wind_gusts_10m[idx] ?? null,
    windDir: h.wind_direction_10m[idx] ?? null,
    hum:     h.relative_humidity_2m[idx] ?? null,
    precip:  h.precipitation[idx] ?? null,
    code:    h.weather_code[idx] ?? inferCodeFromPrecip(h.precipitation[idx] ?? null),
  }
}

function renderSlot(slot: HourSlot, t: LangData): string {
  if (!slot.time) return ''
  const d     = new Date(slot.time)
  const hh    = d.getHours().toString().padStart(2, '0') + ':00'
  const wx    = wxFromCode(slot.code, t.wx)
  const arrow = slot.windDir !== null ? WIND_DIRS[Math.round(slot.windDir / 45) % 8] : ''
  const rainHigh = (slot.rain ?? 0) >= 50
  return `
    <div class="h-slot${rainHigh ? ' h-slot-rain' : ''}">
      <div class="h-time">${hh}</div>
      <div class="h-icon">${wx.icon}</div>
      <div class="h-temp" style="color:${tempColor(slot.temp)}">${slot.temp !== null ? Math.round(slot.temp) + '°' : '—'}</div>
      <div class="h-rain" title="${t.tipRain}" style="color:${rainPctColor(slot.rain)}${rainHigh ? ';font-weight:700' : ''}">💦 ${slot.rain !== null ? Math.round(slot.rain) + '%' : '—'}</div>
      <div class="h-precip" title="${t.tipPrecip}" style="color:${precipColor(slot.precip)}">🌧 ${slot.precip !== null && slot.precip > 0 ? fmt(slot.precip, 1) : '0'} mm</div>
      <div class="h-wind" title="${t.tipGusts}" style="color:${windColor(slot.gust)}">💨 ↑${slot.gust !== null ? Math.round(slot.gust) : '—'} ${arrow}</div>
      <div class="h-hum" title="${t.tipHum}" style="color:${humidityColor(slot.hum)}">💧 ${slot.hum !== null ? Math.round(slot.hum) + '%' : '—'}</div>
    </div>
  `
}

export function renderHourlyPage() {
  const el = document.getElementById('forecastHoursView')
  if (!el) return
  const t = LANG_DATA[state.lang]

  // All active models that returned data for this location
  const loaded = getActiveModels().filter(m => state.wxData[m.key] != null)
  if (!loaded.length) { el.innerHTML = `<p style="padding:40px;color:var(--text-muted);text-align:center">${t.noData}</p>`; return }

  // ── Pre-compute location-aware weights (used by the ensemble slots) ──────────
  const loc = state.currentLoc
  const weights = computeModelWeights(
    loaded.map(m => m.key),
    loc?.latitude  ?? 0,
    loc?.longitude ?? 0,
    loc?.elevation ?? 0,
    state.wxData,
    state.currentObs?.temp,
    state.currentObs?.time,
  )

  let modelKey = state.hourlyModel

  // For ensemble time-indexing prefer a full-range (non-maxDays) model so the
  // loop reaches 72 h even when short-range LAMs were loaded first.
  const refData: OpenMeteoResponse | undefined | null =
    modelKey === 'ensemble'
      ? (loaded.find(m => !m.maxDays)
          ? state.wxData[loaded.find(m => !m.maxDays)!.key]
          : Object.values(state.wxData).find((d): d is OpenMeteoResponse => d !== null))
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

    const slot  = modelKey === 'ensemble'
      ? getEnsembleSlot(idx, offset, weights)
      : getModelSlot(modelKey, idx)
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

  // ── Model selector tabs — show ALL loaded models (no 72 h filter) ────────────
  // Short-range LAMs (maxDays:2) are valuable for hours 0–48 and should always
  // appear as individual tabs.  A small "2d" badge marks their limited horizon.
  const tabModels = loaded   // all loaded models, not filtered by 72 h coverage

  // Safety: if the currently selected model is no longer loaded, reset to ensemble
  if (modelKey !== 'ensemble' && !tabModels.find(m => m.key === modelKey)) {
    state.hourlyModel = 'ensemble'
    modelKey = 'ensemble'
  }

  const modelTabs = [
    `<button class="ctrl-tab${modelKey === 'ensemble' ? ' active' : ''}" data-hmdl="ensemble">⚖ ${t.ensemble}</button>`,
    ...tabModels.map(m => {
      const rangeTag = m.maxDays
        ? ` <span class="tab-range">${m.maxDays}d</span>`
        : ''
      return `<button class="ctrl-tab${modelKey === m.key ? ' active' : ''}" data-hmdl="${m.key}">${m.flag} ${m.name}${rangeTag}</button>`
    })
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
