import { state } from '../state'
import { renderEnsemblePlume } from './ensemblePlume'

const WINDY_MODELS = [
  { key: 'ecmwf', label: 'ECMWF' },
  { key: 'gfs',   label: 'GFS'   },
  { key: 'icon',  label: 'ICON'  },
  { key: 'nam',   label: 'NAM'   },
  { key: 'arome', label: 'AROME' },
]

const WINDY_VARS = [
  { key: 'wind',      label: '💨 Vent'         },
  { key: 'temp',      label: '🌡️ Temperatura'  },
  { key: 'rain',      label: '💦 Precipitació' },
  { key: 'clouds',    label: '☁️ Núvols'       },
  { key: 'pressure',  label: '📊 Pressió'      },
  { key: 'gust',      label: '💨 Ràfegues'     },
  { key: 'snowcover', label: '❄️ Neu'           },
  { key: 'cape',      label: '⚡ CAPE'          },
]

type ModelsSource = 'map' | 'ensemble'

const PLUME_VARS: { key: 'temp' | 'precip' | 'wind'; label: string }[] = [
  { key: 'temp',   label: '🌡️ Temperatura' },
  { key: 'precip', label: '🌧️ Precipitació' },
  { key: 'wind',   label: '💨 Vent'         },
]

export function renderModelsPage() {
  const el  = document.getElementById('pageModels')
  if (!el) return
  const loc = state.currentLoc
  if (!loc) { el.innerHTML = ''; return }

  const source  = (state.modelPageSource ?? 'map') as ModelsSource
  const plumeVar = (state.modelPagePlumeVar ?? 'temp') as 'temp' | 'precip' | 'wind'

  const sourceTabsHtml = `
    <div class="ctrl-group">
      <div class="ctrl-tabs source-tabs">
        <button class="ctrl-tab${source === 'map'      ? ' active' : ''}" data-src="map">🗺 Mapa Interactiu</button>
        <button class="ctrl-tab${source === 'ensemble' ? ' active' : ''}" data-src="ensemble">📊 Ensemble / Plomes</button>
      </div>
    </div>
  `

  let bodyHtml = ''

  if (source === 'map') {
    const mdl = state.modelPageModel
    const vrb = state.modelPageVar
    const lat  = loc.latitude.toFixed(4)
    const lon  = loc.longitude.toFixed(4)
    const src  = `https://embed.windy.com/embed2.html` +
      `?lat=${lat}&lon=${lon}` +
      `&detailLat=${lat}&detailLon=${lon}` +
      `&ptype=${mdl}&source=${mdl}&product=${mdl}` +
      `&overlay=${vrb}` +
      `&step=0&menu=&message=&marker=true` +
      `&calendar=now&pressure=&type=map&location=coordinates` +
      `&detail=&metricWind=default&metricTemp=default&radarRange=-1`

    bodyHtml = `
      <div class="models-controls">
        <div class="ctrl-group">
          <span class="ctrl-label">Model:</span>
          <div class="ctrl-tabs">
            ${WINDY_MODELS.map(m =>
              `<button class="ctrl-tab${m.key === mdl ? ' active' : ''}" data-model="${m.key}">${m.label}</button>`
            ).join('')}
          </div>
        </div>
        <div class="ctrl-group">
          <span class="ctrl-label">Variable:</span>
          <div class="ctrl-tabs">
            ${WINDY_VARS.map(v =>
              `<button class="ctrl-tab${v.key === vrb ? ' active' : ''}" data-var="${v.key}">${v.label}</button>`
            ).join('')}
          </div>
        </div>
      </div>
      <div class="windy-frame-wrap">
        <iframe id="windyFrame" src="${src}"
          width="100%" height="540"
          frameborder="0" allowfullscreen
          style="border-radius:var(--radius);display:block">
        </iframe>
      </div>
      <div class="models-note">
        ℹ️ Mapa interactiu de <a href="https://windy.com" target="_blank" style="color:var(--accent2)">Windy.com</a>
      </div>
    `
  } else {
    // Ensemble / Plumes
    bodyHtml = `
      <div class="models-controls">
        <div class="ctrl-group">
          <span class="ctrl-label">Variable:</span>
          <div class="ctrl-tabs">
            ${PLUME_VARS.map(v =>
              `<button class="ctrl-tab${v.key === plumeVar ? ' active' : ''}" data-pvar="${v.key}">${v.label}</button>`
            ).join('')}
          </div>
        </div>
      </div>
      <div class="plume-section">
        <div class="plume-title">Plomes de previsió · ${PLUME_VARS.find(v => v.key === plumeVar)?.label ?? ''}</div>
        <div class="plume-sub">Cada línia és un model. La línia gruixuda és la mitjana de l'ensemble.</div>
        <div id="plumeChart"></div>
      </div>
    `
  }

  el.innerHTML = `
    <div class="models-page">
      <div class="models-source-bar">${sourceTabsHtml}</div>
      ${bodyHtml}
    </div>
  `

  // Source toggle
  el.querySelectorAll<HTMLButtonElement>('[data-src]').forEach(btn => {
    btn.addEventListener('click', () => {
      ;(state as any).modelPageSource = btn.dataset.src!
      renderModelsPage()
    })
  })

  if (source === 'map') {
    el.querySelectorAll<HTMLButtonElement>('[data-model]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.modelPageModel = btn.dataset.model!
        renderModelsPage()
      })
    })
    el.querySelectorAll<HTMLButtonElement>('[data-var]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.modelPageVar = btn.dataset.var!
        renderModelsPage()
      })
    })
  } else {
    // Plume variable selector
    el.querySelectorAll<HTMLButtonElement>('[data-pvar]').forEach(btn => {
      btn.addEventListener('click', () => {
        ;(state as any).modelPagePlumeVar = btn.dataset.pvar!
        renderModelsPage()
      })
    })
    // Render the plume chart
    const plumeEl = document.getElementById('plumeChart')
    if (plumeEl) renderEnsemblePlume(plumeEl, plumeVar)
  }
}
