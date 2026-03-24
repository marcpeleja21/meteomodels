import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

let mapInstance: L.Map | null = null

export async function renderMapCard(lat: number, lon: number, _name: string) {
  const el = document.getElementById('mapCard')
  if (!el) return

  el.innerHTML = '<div id="leafletMap" style="height:200px;border-radius:10px;overflow:hidden"></div>'

  if (mapInstance) {
    mapInstance.remove()
    mapInstance = null
  }

  await new Promise<void>(r => requestAnimationFrame(() => r()))

  const map = L.map('leafletMap', {
    zoomControl: true,
    scrollWheelZoom: false,
    attributionControl: false,
  })

  map.setView([lat, lon], 11)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map)

  const icon = L.divIcon({
    html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">📍</div>',
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  })

  L.marker([lat, lon], { icon }).addTo(map)

  mapInstance = map
}
