import './style.css'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import { state } from './state'
import { MODELS } from './config/models'
import { LANG_DATA } from './config/i18n'

import { searchLocations } from './api/geocoding'
import { fetchAllModels } from './api/openmeteo'
import { fetchMeteoblue } from './api/meteoblue'
import { fetchAqi } from './api/aqi'
import { fetchCurrentObs } from './api/station'
import { fetchNearbyWebcam } from './api/webcam'
import { fetchAlerts } from './api/alerts'

import { renderLocBar } from './ui/locBar'
import { renderModelTabs } from './ui/modelTabs'
import { renderMainCard } from './ui/mainCard'
import { renderForecastStrip } from './ui/forecastStrip'
import { renderModelCards } from './ui/modelCards'
import { renderChart } from './ui/chart'
import { renderTable } from './ui/table'
import { renderStationCard } from './ui/stationCard'
import { renderMapCard } from './ui/mapCard'
import { renderWebcamCard } from './ui/webcamCard'
import { renderAlertsBanner } from './ui/alertsBanner'

import { startAnimation, resizeCanvas } from './utils/canvas'
import { getEnsembleCurrent } from './utils/data'
import { wxFromCode } from './utils/weather'
import type { GeocodingResult } from './types'

// ── MeteoBlue hardcoded key ────────────────────────────────────────────────────
const MB_KEY = 'eoWsSfipj9Z3D1E8'
state.meteobluKey = MB_KEY
const mbModel = MODELS.find(m => m.mb)
if (mbModel) mbModel.avail = true

// ── Language config ────────────────────────────────────────────────────────────
const SENYERA = `<svg class="flag-svg" viewBox="0 0 20 14"><rect width="20" height="14" fill="#FCDD09"/><rect y="1.56" width="20" height="1.56" fill="#C60B1E"/><rect y="4.67" width="20" height="1.56" fill="#C60B1E"/><rect y="7.78" width="20" height="1.56" fill="#C60B1E"/><rect y="10.89" width="20" height="1.56" fill="#C60B1E"/></svg>`

const LANG_OPTIONS: Record<string, { flagHtml: string; label: string }> = {
  ca: { flagHtml: SENYERA, label: 'Català'   },
  es: { flagHtml: '🇪🇸',   label: 'Español'  },
  en: { flagHtml: '🇬🇧',   label: 'English'  },
  fr: { flagHtml: '🇫🇷',   label: 'Français' },
}

// ── Elements ──────────────────────────────────────────────────────────────────
const searchInput   = document.getElementById('searchInput')   as HTMLInputElement
const searchBtn     = document.getElementById('searchBtn')     as HTMLButtonElement
const suggestionsEl = document.getElementById('suggestions')   as HTMLDivElement

const headerLoc     = document.getElementById('headerLoc')!    as HTMLDivElement
const headerLocName = document.getElementById('headerLocName')! as HTMLSpanElement
const changeLoc     = document.getElementById('changeLoc')!    as HTMLButtonElement

const langDropdown  = document.getElementById('langDropdown')  as HTMLDivElement
const langCurrent   = document.getElementById('langCurrent')   as HTMLButtonElement
const langMenu      = document.getElementById('langMenu')      as HTMLDivElement
const langCurFlag   = document.getElementById('langCurrentFlag') as HTMLSpanElement
const langCurCode   = document.getElementById('langCurrentCode') as HTMLSpanElement

const welcomeScreen = document.getElementById('welcomeScreen') as HTMLDivElement
const loadingScreen = document.getElementById('loadingScreen') as HTMLDivElement
const loadingModels = document.getElementById('loadingModels') as HTMLDivElement
const loadingText   = loadingScreen.querySelector('p')         as HTMLParagraphElement
const wxDisplay     = document.getElementById('wxDisplay')     as HTMLDivElement

// ── Helpers ───────────────────────────────────────────────────────────────────
function t() { return LANG_DATA[state.lang] }
function show(el: HTMLElement) { el.classList.remove('hidden') }
function hide(el: HTMLElement) { el.classList.add('hidden') }

function applyLang() {
  const lang = t()
  const opt  = LANG_OPTIONS[state.lang]

  searchInput.placeholder   = lang.searchPh
  searchBtn.textContent     = `🔍 ${lang.searchBtn}`

  langCurFlag.innerHTML   = opt.flagHtml
  langCurCode.textContent = state.lang.toUpperCase()

  langMenu.querySelectorAll<HTMLButtonElement>('.lang-option').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === state.lang)
  })

  const wTitle = document.getElementById('welcomeTitle')
  const wSub   = document.getElementById('welcomeSub')
  const bSub   = document.querySelector('.brand-sub') as HTMLElement | null
  if (wTitle) wTitle.textContent = lang.welcomeTitle
  if (wSub)   wSub.textContent   = lang.welcomeSub
  if (bSub)   bSub.textContent   = lang.appSub
}

function renderAll() {
  renderMainCard()
  renderForecastStrip()
  renderModelCards()
  renderChart()
  renderTable()
}

function onModelSelect(key: string) {
  state.activeModel = key
  renderModelTabs(MODELS, state.wxData, t(), onModelSelect)
  renderMainCard()
}

// ── Day selected event ─────────────────────────────────────────────────────────
document.addEventListener('mm:daySelected', () => {
  renderMainCard()
  renderForecastStrip()   // re-render to update selected highlight
})

// ── Search ────────────────────────────────────────────────────────────────────
let searchTimer = 0

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = window.setTimeout(async () => {
    const results = await searchLocations(searchInput.value, state.lang)
    showSuggestions(results)
  }, 300)
})

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch() }
  if (e.key === 'Escape') hideSuggestions()
})

searchBtn.addEventListener('click', doSearch)

async function doSearch() {
  const results = await searchLocations(searchInput.value, state.lang)
  if (results.length === 1) {
    selectLocation(results[0])
  } else {
    showSuggestions(results)
  }
}

function showSuggestions(results: GeocodingResult[]) {
  if (!results.length) { hideSuggestions(); return }
  suggestionsEl.innerHTML = results.map(r => {
    const sub = [r.admin1, r.country].filter(Boolean).join(', ')
    return `<div class="sugg-item" data-id="${r.id}">
      <div>
        <div class="sugg-name">${r.name}</div>
        <div class="sugg-loc">${sub}</div>
      </div>
    </div>`
  }).join('')
  suggestionsEl.style.display = 'block'

  suggestionsEl.querySelectorAll<HTMLDivElement>('.sugg-item').forEach((item, i) => {
    item.addEventListener('click', () => { selectLocation(results[i]) })
  })
}

function hideSuggestions() {
  suggestionsEl.style.display = 'none'
  suggestionsEl.innerHTML = ''
}

document.addEventListener('click', e => {
  if (!suggestionsEl.contains(e.target as Node) && e.target !== searchInput) {
    hideSuggestions()
  }
  if (!langDropdown.contains(e.target as Node)) {
    langMenu.classList.remove('open')
  }
})

// ── Change location button ────────────────────────────────────────────────────
changeLoc.addEventListener('click', () => {
  hide(wxDisplay)
  show(welcomeScreen)
  searchInput.focus()
})

// ── Load weather ──────────────────────────────────────────────────────────────
async function selectLocation(loc: GeocodingResult) {
  state.currentLoc  = loc
  state.activeModel = 'ensemble'
  state.selectedDay = 0
  state.wxData      = {}
  state.aqiData     = null
  searchInput.value = loc.name
  hideSuggestions()

  // Show location name in header
  headerLocName.textContent = loc.name
  headerLoc.classList.remove('hidden')

  hide(welcomeScreen)
  hide(wxDisplay)
  show(loadingScreen)
  loadingText.textContent = t().loading

  const visibleModels = MODELS.filter(m => m.avail)
  loadingModels.innerHTML = visibleModels
    .map(m => `<span class="lm-tag" id="lm-${m.key}">${m.flag} ${m.name}</span>`)
    .join('')

  const onProgress = (key: string, ok: boolean) => {
    const tag = document.getElementById(`lm-${key}`)
    if (tag) tag.className = `lm-tag ${ok ? 'ok' : 'err'}`
  }

  // Fetch weather, AQI, current obs and alerts in parallel
  const [wxData, aqiData, obsData, alertsData] = await Promise.all([
    fetchAllModels(loc.latitude, loc.longitude, MODELS, onProgress),
    fetchAqi(loc.latitude, loc.longitude),
    fetchCurrentObs(loc.latitude, loc.longitude),
    fetchAlerts(loc.latitude, loc.longitude, loc.country_code),
  ])

  state.wxData  = wxData
  state.aqiData = aqiData

  // MeteoBlue
  try {
    const mbData = await fetchMeteoblue(loc.latitude, loc.longitude, MB_KEY)
    state.wxData['meteoblue'] = mbData
    onProgress('meteoblue', true)
  } catch {
    state.wxData['meteoblue'] = null
    onProgress('meteoblue', false)
  }

  hide(loadingScreen)
  show(wxDisplay)
  wxDisplay.classList.add('fade-up')

  renderAlertsBanner(alertsData)
  renderLocBar(loc, t())
  renderStationCard(obsData)
  renderModelTabs(MODELS, state.wxData, t(), onModelSelect)
  renderAll()

  // Map and webcam
  renderMapCard(loc.latitude, loc.longitude, loc.name)
  fetchNearbyWebcam(loc.latitude, loc.longitude).then(renderWebcamCard)

  const { data: ensData } = getEnsembleCurrent(state.wxData)
  const ensWx = wxFromCode(ensData.code, t().wx)
  if (ensWx.type === 'rain') startAnimation('rain')
  else if (ensWx.type === 'snow') startAnimation('snow')
  else startAnimation('none')
}

// ── Language dropdown ─────────────────────────────────────────────────────────
langCurrent.addEventListener('click', e => {
  e.stopPropagation()
  langMenu.classList.toggle('open')
})

langMenu.querySelectorAll<HTMLButtonElement>('.lang-option').forEach(btn => {
  btn.addEventListener('click', () => {
    state.lang = btn.dataset.lang!
    localStorage.setItem('mm_lang', state.lang)
    langMenu.classList.remove('open')
    applyLang()
    if (state.currentLoc) {
      renderLocBar(state.currentLoc, t())
      renderModelTabs(MODELS, state.wxData, t(), onModelSelect)
      renderAll()
    }
  })
})

// ── Canvas resize ─────────────────────────────────────────────────────────────
window.addEventListener('resize', resizeCanvas)

// ── Init ──────────────────────────────────────────────────────────────────────
inject()
injectSpeedInsights()
applyLang()
