import L from 'leaflet'
import { state } from '../state'
import { LANG_DATA } from '../config/i18n'

interface RainViewerResponse {
  host: string
  radar: {
    past: Array<{ time: number; path: string }>
    nowcast?: Array<{ time: number; path: string }>
  }
}

let radarMap: L.Map | null = null
let radarLayer: L.TileLayer | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null

async function fetchLatestRadarPath(): Promise<{ host: string; path: string } | null> {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data: RainViewerResponse = await res.json()
    const frames = data.radar?.past
    if (!frames || !frames.length) return null
    const latest = frames[frames.length - 1]
    return { host: data.host, path: latest.path }
  } catch {
    return null
  }
}

export async function renderRadarCard(lat: number, lon: number) {
  const el = document.getElementById('radarCard')
  if (!el) return

  const lang = LANG_DATA[state.lang] ?? LANG_DATA.en

  // Clear any previous timer
  if (refreshTimer !== null) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }

  el.innerHTML = `
    <div class="media-card radar-card">
      <div class="media-label">${lang.radarTitle}</div>
      <div id="radarMapEl" style="height:260px;border-radius:10px;overflow:hidden;position:relative">
        <div class="radar-loading">${lang.radarLoading}</div>
      </div>
      <div class="radar-attribution">
        Radar © <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a>
        · Map © <a href="https://www.openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap</a>
      </div>
    </div>`

  // Destroy previous map instance
  if (radarMap) {
    radarMap.remove()
    radarMap = null
    radarLayer = null
  }

  // Wait a frame for the DOM to render
  await new Promise<void>(r => requestAnimationFrame(() => r()))

  const mapEl = document.getElementById('radarMapEl')
  if (!mapEl) return

  const radarData = await fetchLatestRadarPath()

  if (!radarData) {
    mapEl.innerHTML = `<div class="radar-error">${lang.radarError}</div>`
    return
  }

  // Remove loading placeholder
  mapEl.innerHTML = ''

  const map = L.map('radarMapEl', {
    zoomControl: true,
    scrollWheelZoom: false,
    attributionControl: false,
  })

  map.setView([lat, lon], 8)

  // Base OSM tiles (dark-ish for better radar visibility)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    opacity: 0.7,
  }).addTo(map)

  // RainViewer radar overlay
  const tileUrl = `${radarData.host}${radarData.path}/256/{z}/{x}/{y}/4/1_1.png`
  const overlay = L.tileLayer(tileUrl, {
    opacity: 0.7,
    tileSize: 256,
  })
  overlay.addTo(map)

  // Location marker
  const icon = L.divIcon({
    html: '<div style="font-size:20px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">📍</div>',
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 20],
  })
  L.marker([lat, lon], { icon }).addTo(map)

  radarMap = map
  radarLayer = overlay

  // Refresh radar tiles every 5 minutes
  refreshTimer = setInterval(async () => {
    const fresh = await fetchLatestRadarPath()
    if (!fresh || !radarMap) return
    if (radarLayer) {
      radarMap.removeLayer(radarLayer)
    }
    const freshUrl = `${fresh.host}${fresh.path}/256/{z}/{x}/{y}/4/1_1.png`
    radarLayer = L.tileLayer(freshUrl, { opacity: 0.7, tileSize: 256 })
    radarLayer.addTo(radarMap)
  }, 5 * 60 * 1000)
}
