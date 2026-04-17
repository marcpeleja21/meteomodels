import './style.css'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import { state } from './state'
import { MODELS, getActiveModels } from './config/models'
import { LANG_DATA } from './config/i18n'

import { searchLocations, reverseGeocode, fetchElevation } from './api/geocoding'
import { fetchAllModels } from './api/openmeteo'
import { fetchMeteoblue } from './api/meteoblue'
import { fetchAqi } from './api/aqi'
import { fetchCurrentObs } from './api/station'
import { fetchNearbyWebcam } from './api/webcam'
import { fetchAlerts } from './api/alerts'
import { clearEnsembleCache } from './api/ensembleMembers'

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
import { renderRadarCard, clearRadarCard } from './ui/radarCard'
import { renderAlertsBanner } from './ui/alertsBanner'
import { renderPredictionCard } from './ui/predictionCard'
import { renderModelsPage } from './ui/modelsPage'
import { renderHourlyPage } from './ui/hourlyPage'

import { startAnimation, resizeCanvas } from './utils/canvas'
import { getEnsembleCurrent, hoursUntilPrecip } from './utils/data'
import { computeModelWeights } from './utils/modelWeights'
import { wxFromCode } from './utils/weather'
import type { GeocodingResult, OpenMeteoResponse, AqiResponse, CurrentObs } from './types'
import type { WeatherAlert } from './api/alerts'

// ── Location data cache ────────────────────────────────────────────────────────
// Stores the full fetch result for recently visited locations so that
// re-selecting the same location within the TTL window returns identical data.
// This prevents intermittent model fetch failures from causing different models
// to appear on different loads, and stops obs-bias weights from shifting each render.
const WX_CACHE_TTL_MS = 10 * 60 * 1000   // 10 minutes

interface WxCacheEntry {
  wxData:     Record<string, OpenMeteoResponse | null>
  aqiData:    AqiResponse | null
  obsData:    CurrentObs | null
  alertsData: WeatherAlert[]
  elevation:  number | null
  timestamp:  number
}

const wxCache = new Map<string, WxCacheEntry>()

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

function getCachedEntry(lat: number, lon: number): WxCacheEntry | null {
  const entry = wxCache.get(cacheKey(lat, lon))
  if (!entry) return null
  if (Date.now() - entry.timestamp > WX_CACHE_TTL_MS) {
    wxCache.delete(cacheKey(lat, lon))
    return null
  }
  return entry
}

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
  de: { flagHtml: '🇩🇪',   label: 'Deutsch'  },
}

// ── Elements ──────────────────────────────────────────────────────────────────
const searchInput   = document.getElementById('searchInput')   as HTMLInputElement
const searchBtn     = document.getElementById('searchBtn')     as HTMLButtonElement
const suggestionsEl = document.getElementById('suggestions')   as HTMLDivElement

const headerLoc        = document.getElementById('headerLoc')!        as HTMLDivElement
const headerLocName    = document.getElementById('headerLocName')!    as HTMLSpanElement
const changeLoc        = document.getElementById('changeLoc')!        as HTMLButtonElement
const headerSearchWrap = document.getElementById('headerSearchWrap')! as HTMLDivElement
const headerSearchInput= document.getElementById('headerSearchInput')! as HTMLInputElement
const headerSearchCancel = document.getElementById('headerSearchCancel')! as HTMLButtonElement
const headerSearchSugg = document.getElementById('headerSearchSugg')! as HTMLDivElement
const hlPin            = headerLoc.querySelector('.hloc-pin')!         as HTMLElement

const langDropdown  = document.getElementById('langDropdown')  as HTMLDivElement
const langCurrent   = document.getElementById('langCurrent')   as HTMLButtonElement
const langMenu      = document.getElementById('langMenu')      as HTMLDivElement
const langCurFlag   = document.getElementById('langCurrentFlag') as HTMLSpanElement
const langCurCode   = document.getElementById('langCurrentCode') as HTMLSpanElement

const navDropdown   = document.getElementById('navDropdown')   as HTMLDivElement
const navCurrent    = document.getElementById('navCurrent')    as HTMLButtonElement
const navMenu       = document.getElementById('navMenu')       as HTMLDivElement
const navCurrentLbl = document.getElementById('navCurrentLabel') as HTMLSpanElement
const pageForecast  = document.getElementById('pageForecast')  as HTMLDivElement
const pageModels    = document.getElementById('pageModels')    as HTMLDivElement

const welcomeScreen = document.getElementById('welcomeScreen') as HTMLDivElement
const loadingScreen = document.getElementById('loadingScreen') as HTMLDivElement
const loadingModels = document.getElementById('loadingModels') as HTMLDivElement
const loadingText   = loadingScreen.querySelector('p')         as HTMLParagraphElement
const wxDisplay     = document.getElementById('wxDisplay')     as HTMLDivElement

const favsRow    = document.getElementById('favsRow')    as HTMLDivElement
const favStarBtn = document.getElementById('favStarBtn') as HTMLButtonElement

// ── Helpers ───────────────────────────────────────────────────────────────────
function t() { return LANG_DATA[state.lang] }
function show(el: HTMLElement) { el.classList.remove('hidden') }
function hide(el: HTMLElement) { el.classList.add('hidden') }

function applyLang() {
  const lang = t()
  const opt  = LANG_OPTIONS[state.lang]

  searchInput.placeholder   = lang.searchPh
  searchBtn.innerHTML       = `🔍<span class="btn-label"> ${lang.searchBtn}</span>`

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

  // Welcome screen — feature cards (text + SVG labels)
  const setText = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val }
  setText('feat1-title', lang.feat1Title)
  setText('feat1-desc',  lang.feat1Desc)
  setText('feat2-title', lang.feat2Title)
  setText('feat2-desc',  lang.feat2Desc)
  setText('feat3-title', lang.feat3Title)
  setText('feat3-desc',  lang.feat3Desc)
  setText('svg3-today',           lang.svgToday)
  setText('svg3-tomorrow',        lang.svgTomorrow)
  setText('svg3-outfit-today',    lang.svgLightClothes)
  setText('svg3-outfit-tomorrow', lang.svgJacketUmbrella)
  // Card 1 SVG day names: Mon–Sat = days[1]–days[6]
  for (let i = 0; i < 6; i++) setText(`svg1-d${i}`, lang.days[i + 1])

  // Loading screen text
  if (loadingText) loadingText.textContent = lang.loading

  // Header inline search placeholder
  headerSearchInput.placeholder = lang.searchPh

  // Update forecast mode tab labels
  const fmodeDaysEl  = document.getElementById('fmodeDays')
  const fmodeHoursEl = document.getElementById('fmodeHours')
  if (fmodeDaysEl)  fmodeDaysEl.textContent  = `📅 ${lang.forecastByDay}`
  if (fmodeHoursEl) fmodeHoursEl.textContent = `🕐 ${lang.forecastByHour}`

  // Geolocation button label (defined later but safe to call via function ref)
  applyGeolocLang()

  // Re-render favourites row (labels change on lang switch)
  renderFavsRow()
  if (state.currentLoc) updateFavStar()
}

// ── Globe animation ───────────────────────────────────────────────────────────
const GLOBES = ['🌍', '🌎', '🌏']
let globeIdx = 0
const brandIcon = document.querySelector('.brand-icon') as HTMLElement | null
if (brandIcon) {
  setInterval(() => {
    brandIcon.style.opacity = '0'
    setTimeout(() => {
      globeIdx = (globeIdx + 1) % GLOBES.length
      brandIcon.textContent = GLOBES[globeIdx]
      brandIcon.style.opacity = '1'
    }, 200)
  }, 1400)
}

// ── Forecast mode tabs ────────────────────────────────────────────────────────
const fmodeDaysBtn   = document.getElementById('fmodeDays')
const fmodeHoursBtn  = document.getElementById('fmodeHours')
const forecastDaysView  = document.getElementById('forecastDaysView')!
const forecastHoursView = document.getElementById('forecastHoursView')!

function setForecastMode(mode: 'days' | 'hours') {
  state.forecastMode = mode
  forecastDaysView.classList.toggle('hidden', mode !== 'days')
  forecastHoursView.classList.toggle('hidden', mode !== 'hours')
  fmodeDaysBtn?.classList.toggle('active', mode === 'days')
  fmodeHoursBtn?.classList.toggle('active', mode === 'hours')
  if (mode === 'hours' && state.currentLoc) renderHourlyPage()
}
fmodeDaysBtn?.addEventListener('click', () => setForecastMode('days'))
fmodeHoursBtn?.addEventListener('click', () => setForecastMode('hours'))

// ── Page switching ────────────────────────────────────────────────────────────
function getPageLabel(page: string) {
  const lang = t()
  const map: Record<string, string> = {
    forecast: lang.navForecast,
    models:   lang.navModels,
  }
  return map[page] ?? page
}

function switchPage(page: 'forecast' | 'models') {
  state.currentPage = page
  pageForecast.classList.toggle('hidden', page !== 'forecast')
  pageModels.classList.toggle('hidden',   page !== 'models')
  navCurrentLbl.textContent = getPageLabel(page)
  navMenu.querySelectorAll<HTMLButtonElement>('.nav-option').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page)
  })
  if (page === 'models')  renderModelsPage()
}

function updateNavLabels() {
  const lang = t()
  const optForecast = document.getElementById('navOptForecast')
  const optModels   = document.getElementById('navOptModels')
  if (optForecast) optForecast.textContent = `📅 ${lang.navForecast}`
  if (optModels)   optModels.textContent   = `🗺 ${lang.navModels}`
  navCurrentLbl.textContent = getPageLabel(state.currentPage)
}

function renderAll() {
  if (state.currentPage === 'forecast') {
    renderMainCard()
    renderForecastStrip()
    renderModelCards()
    renderChart()
    renderTable()
    if (state.forecastMode === 'hours') renderHourlyPage()
  } else if (state.currentPage === 'models') {
    renderModelsPage()
  }
}

function onModelSelect(key: string) {
  state.activeModel = key
  renderModelTabs(getActiveModels(), state.wxData, t(), onModelSelect)
  renderMainCard()
}

// ── Day selected event ─────────────────────────────────────────────────────────
document.addEventListener('mm:daySelected', () => {
  renderMainCard()
  renderForecastStrip()   // re-render to update selected highlight
  renderModelCards()      // update model cards to reflect selected day
  if (state.forecastMode === 'hours') renderHourlyPage()
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

// ── Geolocation ───────────────────────────────────────────────────────────────
const geolocBtnEl = document.getElementById('geolocBtn') as HTMLButtonElement | null
const geolocMsgEl = document.getElementById('geolocMsg') as HTMLSpanElement | null

function setGeolocMsg(text: string, isError = false) {
  if (!geolocMsgEl) return
  geolocMsgEl.textContent = text
  geolocMsgEl.className   = 'geoloc-msg' + (isError ? ' err' : '')
}

geolocBtnEl?.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setGeolocMsg(t().geolocError, true)
    return
  }

  geolocBtnEl.disabled    = true
  setGeolocMsg(t().geolocLoading)

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords
      const result = await reverseGeocode(latitude, longitude, state.lang)
      geolocBtnEl.disabled = false
      if (!result) {
        setGeolocMsg(t().geolocError, true)
        return
      }
      setGeolocMsg('')
      selectLocation(result)
    },
    (err) => {
      geolocBtnEl.disabled = false
      if (err.code === err.PERMISSION_DENIED) {
        setGeolocMsg(t().geolocDenied, true)
      } else {
        setGeolocMsg(t().geolocError, true)
      }
    },
    { timeout: 10_000, maximumAge: 60_000 },
  )
})

// Update geoloc button label when language changes
function applyGeolocLang() {
  if (geolocBtnEl && !geolocBtnEl.disabled) geolocBtnEl.textContent = t().geolocBtn
}

async function doSearch() {
  const q = searchInput.value.trim()
  if (!q) return
  const results = await searchLocations(q, state.lang)
  if (!results.length) { hideSuggestions(); return }
  // Always select the best (first) match — show dropdown only when called from input event
  selectLocation(results[0])
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
  if (!navDropdown.contains(e.target as Node)) {
    navMenu.classList.remove('open')
  }
  if (!headerSearchWrap.contains(e.target as Node) && e.target !== changeLoc) {
    if (!headerSearchWrap.classList.contains('hidden')) closeHeaderSearch()
  }
})

// ── Nav dropdown ──────────────────────────────────────────────────────────────
navCurrent.addEventListener('click', e => {
  e.stopPropagation()
  navMenu.classList.toggle('open')
})

navMenu.querySelectorAll<HTMLButtonElement>('.nav-option').forEach(btn => {
  btn.addEventListener('click', () => {
    navMenu.classList.remove('open')
    switchPage(btn.dataset.page as 'forecast' | 'models')
  })
})

// ── Header inline search ─────────────────────────────────────────────────────
function openHeaderSearch() {
  hlPin.classList.add('hidden')
  headerLocName.classList.add('hidden')
  changeLoc.classList.add('hidden')
  headerSearchWrap.classList.remove('hidden')
  headerSearchInput.value = ''
  headerSearchInput.placeholder = t().searchPh
  headerSearchInput.focus()
}

function closeHeaderSearch() {
  headerSearchWrap.classList.add('hidden')
  headerSearchSugg.innerHTML = ''
  headerSearchSugg.style.display = 'none'
  hlPin.classList.remove('hidden')
  headerLocName.classList.remove('hidden')
  changeLoc.classList.remove('hidden')
}

let headerSearchTimer = 0
headerSearchInput.addEventListener('input', () => {
  clearTimeout(headerSearchTimer)
  headerSearchTimer = window.setTimeout(async () => {
    const q = headerSearchInput.value.trim()
    if (!q) { headerSearchSugg.style.display = 'none'; return }
    const results = await searchLocations(q, state.lang)
    if (!results.length) { headerSearchSugg.style.display = 'none'; return }
    headerSearchSugg.innerHTML = results.map(r => {
      const sub = [r.admin1, r.country].filter(Boolean).join(', ')
      return `<div class="sugg-item" data-id="${r.id}">
        <div class="sugg-name">${r.name}</div>
        <div class="sugg-loc">${sub}</div>
      </div>`
    }).join('')
    headerSearchSugg.style.display = 'block'
    headerSearchSugg.querySelectorAll<HTMLDivElement>('.sugg-item').forEach((item, i) => {
      item.addEventListener('click', () => {
        closeHeaderSearch()
        selectLocation(results[i])
      })
    })
  }, 300)
})

headerSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(headerSearchTimer)
    searchLocations(headerSearchInput.value.trim(), state.lang).then(results => {
      if (results.length === 1) { closeHeaderSearch(); selectLocation(results[0]) }
    })
  }
  if (e.key === 'Escape') closeHeaderSearch()
})

headerSearchCancel.addEventListener('click', closeHeaderSearch)

// ── Change location button ────────────────────────────────────────────────────
changeLoc.addEventListener('click', openHeaderSearch)

// ── Favourites ─────────────────────────────────────────────────────────────────
const MAX_FAVS = 5

function isFav(loc: GeocodingResult): boolean {
  return state.favorites.some(f => f.id === loc.id)
}

function persistFavs() {
  localStorage.setItem('mm_favorites', JSON.stringify(state.favorites))
}

function updateFavStar() {
  if (!state.currentLoc) return
  const active = isFav(state.currentLoc)
  favStarBtn.textContent = active ? '★' : '☆'
  favStarBtn.classList.toggle('active', active)
  favStarBtn.title = active ? t().favRemove : t().favAdd
  favStarBtn.setAttribute('aria-label', active ? t().favRemove : t().favAdd)
}

function renderFavsRow() {
  const favs = state.favorites
  if (!favs.length) { favsRow.innerHTML = ''; return }
  const lang = t()
  favsRow.innerHTML =
    `<span class="favs-label">${lang.favsTitle}</span>` +
    favs.map(f =>
      `<button class="fav-pill" data-id="${f.id}" title="${f.country}">` +
      `<span class="fav-pill-name">${f.name}</span>` +
      `<span class="fav-pill-country">${f.country_code}</span>` +
      `<span class="fav-pill-remove" data-id="${f.id}" title="${lang.favRemove}" aria-label="${lang.favRemove}">×</span>` +
      `</button>`
    ).join('')

  favsRow.querySelectorAll<HTMLButtonElement>('.fav-pill').forEach(pill => {
    pill.addEventListener('click', e => {
      if ((e.target as HTMLElement).classList.contains('fav-pill-remove')) return
      const fav = state.favorites.find(f => f.id === Number(pill.dataset.id))
      if (fav) selectLocation(fav)
    })
  })
  favsRow.querySelectorAll<HTMLSpanElement>('.fav-pill-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      state.favorites = state.favorites.filter(f => f.id !== Number(btn.dataset.id))
      persistFavs()
      renderFavsRow()
      updateFavStar()
    })
  })
}

function toggleFav() {
  if (!state.currentLoc) return
  if (isFav(state.currentLoc)) {
    state.favorites = state.favorites.filter(f => f.id !== state.currentLoc!.id)
  } else {
    if (state.favorites.length >= MAX_FAVS) state.favorites.shift()   // drop oldest
    state.favorites = [...state.favorites, state.currentLoc]
  }
  persistFavs()
  updateFavStar()
  renderFavsRow()
}

favStarBtn.addEventListener('click', toggleFav)

// ── Load weather ──────────────────────────────────────────────────────────────
async function selectLocation(loc: GeocodingResult) {
  state.currentLoc           = loc
  state.activeModel          = 'ensemble'
  state.selectedDay          = 0
  state.currentPage          = 'forecast'
  state.wxData               = {}
  state.aqiData              = null
  state.chartSelectedModels  = null   // re-seed top-5 for the new location
  clearEnsembleCache()
  state.forecastMode         = 'days'
  state.forecastDaysExpanded = false
  searchInput.value = loc.name
  hideSuggestions()
  // Persist so shortcuts (?page=hourly / ?page=models) can reload the last city
  localStorage.setItem('mm_last_loc', JSON.stringify(loc))

  // Show nav dropdown, reset to forecast
  navDropdown.classList.remove('hidden')
  switchPage('forecast')
  setForecastMode('days')

  // Show location name in header + update star
  headerLocName.textContent = loc.name
  headerLoc.classList.remove('hidden')
  updateFavStar()

  hide(welcomeScreen)
  hide(wxDisplay)

  // ── Try cache first ──────────────────────────────────────────────────────
  const cached = getCachedEntry(loc.latitude, loc.longitude)
  if (cached) {
    // Restore elevation from cache if it wasn't on the loc object
    if (cached.elevation != null && loc.elevation == null) loc.elevation = cached.elevation

    state.wxData     = cached.wxData
    state.aqiData    = cached.aqiData
    state.currentObs = cached.obsData
    state.alerts     = cached.alertsData
    state.fetchedAt  = cached.timestamp

    show(wxDisplay)
    wxDisplay.classList.add('fade-up')

    renderAlertsBanner(cached.alertsData)
    renderPredictionCard(state.wxData)
    renderLocBar(loc, t())
    renderStationCard(cached.obsData)
    renderModelTabs(getActiveModels(), state.wxData, t(), onModelSelect)
    renderAll()
    renderMapCard(loc.latitude, loc.longitude, loc.name)
    fetchNearbyWebcam(loc.latitude, loc.longitude).then(renderWebcamCard)

    const _wxKeys = Object.entries(state.wxData).filter(([,v]) => v !== null).map(([k]) => k)
    const _wxWeights = computeModelWeights(
      _wxKeys, loc.latitude, loc.longitude, state.currentLoc?.elevation ?? 0,
      state.wxData, state.currentObs?.temp, state.currentObs?.time,
    )
    const { data: ensData } = getEnsembleCurrent(state.wxData, _wxWeights)
    const ensWx = wxFromCode(ensData.code, t().wx)
    if (ensWx.type === 'rain') startAnimation('rain')
    else if (ensWx.type === 'snow') startAnimation('snow')
    else startAnimation('none')
    return
  }

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

  // Fetch weather, AQI, current obs, alerts and elevation in parallel
  const [wxData, aqiData, obsData, alertsData, elevation] = await Promise.all([
    fetchAllModels(loc.latitude, loc.longitude, getActiveModels(), onProgress),
    fetchAqi(loc.latitude, loc.longitude),
    fetchCurrentObs(loc.latitude, loc.longitude),
    fetchAlerts(loc.latitude, loc.longitude, loc.country_code, loc, state.lang),
    loc.elevation == null ? fetchElevation(loc.latitude, loc.longitude) : Promise.resolve(null),
  ])

  // Attach elevation to loc so locBar and localStorage both include it
  if (elevation != null) loc.elevation = elevation

  state.wxData     = wxData
  state.aqiData    = aqiData
  state.currentObs = obsData
  state.alerts     = alertsData
  state.fetchedAt  = Date.now()

  // MeteoBlue
  try {
    const mbData = await fetchMeteoblue(loc.latitude, loc.longitude, MB_KEY)
    state.wxData['meteoblue'] = mbData
    onProgress('meteoblue', true)
  } catch {
    state.wxData['meteoblue'] = null
    onProgress('meteoblue', false)
  }

  // Store in cache so subsequent selects of this location are stable
  wxCache.set(cacheKey(loc.latitude, loc.longitude), {
    wxData:     state.wxData,
    aqiData:    state.aqiData,
    obsData:    state.currentObs,
    alertsData: state.alerts,
    elevation:  loc.elevation ?? null,
    timestamp:  state.fetchedAt!,
  })

  hide(loadingScreen)
  show(wxDisplay)
  wxDisplay.classList.add('fade-up')

  renderAlertsBanner(alertsData)
  renderPredictionCard(state.wxData)
  renderLocBar(loc, t())
  renderStationCard(obsData)
  renderModelTabs(getActiveModels(), state.wxData, t(), onModelSelect)
  renderAll()

  // Map and webcam
  renderMapCard(loc.latitude, loc.longitude, loc.name)
  fetchNearbyWebcam(loc.latitude, loc.longitude).then(renderWebcamCard)

  // Ensemble current conditions
  const _wxKeys = Object.entries(state.wxData).filter(([,v]) => v !== null).map(([k]) => k)
  const _wxWeights = computeModelWeights(
    _wxKeys, loc.latitude, loc.longitude, state.currentLoc?.elevation ?? 0,
    state.wxData, state.currentObs?.temp, state.currentObs?.time,
  )
  const { data: ensData } = getEnsembleCurrent(state.wxData, _wxWeights)
  const ensWx = wxFromCode(ensData.code, t().wx)

  // Radar visibility:
  //  - Raining/snowing now → show, no tooltip (hoursUntil = null)
  //  - Storm approaching within 6 h → show with forecast badge
  //  - Nothing → hide
  const rainingNow = ensWx.type === 'rain' || ensWx.type === 'snow'
  const approachingIn = hoursUntilPrecip(state.wxData) // 0-6 or null
  if (rainingNow) {
    renderRadarCard(loc.latitude, loc.longitude, null)
  } else if (approachingIn !== null) {
    renderRadarCard(loc.latitude, loc.longitude, approachingIn)
  } else {
    clearRadarCard()
  }

  // Background animation — tied to current conditions only
  if (ensWx.type === 'rain') startAnimation('rain')
  else if (ensWx.type === 'snow') startAnimation('snow')
  else startAnimation('none')
}

// ── Brand → go home ───────────────────────────────────────────────────────────
function goHome() {
  hide(wxDisplay)
  hide(loadingScreen)
  show(welcomeScreen)
  state.currentLoc  = null
  state.selectedDay = 0
  state.currentPage = 'forecast'
  navDropdown.classList.add('hidden')
  headerLoc.classList.add('hidden')
  startAnimation('none')
  searchInput.value = ''
  renderFavsRow()   // refresh pills on welcome screen
}

const brandHomeEl = document.getElementById('brandHome')!
brandHomeEl.addEventListener('click', goHome)
brandHomeEl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome() }
})

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
    updateNavLabels()
    if (state.currentLoc) {
      renderPredictionCard(state.wxData)
      renderLocBar(state.currentLoc, t())
      renderModelTabs(getActiveModels(), state.wxData, t(), onModelSelect)
      renderAll()
    }
  })
})

// ── Canvas resize ─────────────────────────────────────────────────────────────
window.addEventListener('resize', resizeCanvas)

// ── Deep-link / shortcut URL handling ─────────────────────────────────────────
// Handles:
//   /?action=search         → open search immediately
//   /?page=hourly|models    → switch page after the last location loads
//   /?city=web+meteo://X    → auto-search for X (protocol handler)
;(function handleStartupUrl() {
  const params  = new URLSearchParams(location.search)
  const action  = params.get('action')
  const page    = params.get('page')
  const cityRaw = params.get('city')

  // Protocol handler: "web+meteo://Barcelona" arrives as city=web+meteo://Barcelona
  if (cityRaw) {
    const city = cityRaw.replace(/^web\+meteo:\/\//i, '').trim()
    if (city) {
      // Auto-search on load
      window.addEventListener('DOMContentLoaded', () => {
        searchLocations(city, state.lang).then(results => {
          if (results.length) selectLocation(results[0])
          else {
            // Pre-fill the search box so user just has to confirm
            searchInput.value = city
            searchInput.focus()
          }
        })
      })
    }
    return
  }

  // Shortcut: open search immediately
  if (action === 'search') {
    window.addEventListener('DOMContentLoaded', () => searchInput.focus())
    return
  }

  // Shortcut: switch to a page or mode after last location is re-loaded
  if (page === 'hourly' || page === 'models') {
    const saved = localStorage.getItem('mm_last_loc')
    if (saved) {
      try {
        const loc = JSON.parse(saved) as GeocodingResult
        window.addEventListener('DOMContentLoaded', () => selectLocation(loc).then(() => {
          if (page === 'models') {
            switchPage('models')
          } else {
            // hourly → stay on forecast page, switch to hours mode
            switchPage('forecast')
            setForecastMode('hours')
          }
        }))
      } catch { /* ignore bad storage */ }
    }
  }
})()

// ── Data freshness badge ───────────────────────────────────────────────────────
setInterval(() => {
  const badge = document.getElementById('freshnessBadge')
  if (!badge || !state.fetchedAt) return
  const mins = Math.round((Date.now() - state.fetchedAt) / 60000)
  const lang = LANG_DATA[state.lang]
  if (mins >= 120) {
    badge.textContent = lang.dataStale
    badge.classList.add('freshness-stale')
  } else {
    badge.textContent = mins <= 1 ? lang.freshnessNow : lang.freshnessFmt(mins)
    badge.classList.remove('freshness-stale')
  }
}, 60_000)

// ── Init ──────────────────────────────────────────────────────────────────────
inject()
injectSpeedInsights()
applyLang()
