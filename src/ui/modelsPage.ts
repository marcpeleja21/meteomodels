import { state } from '../state'
import { LANG_DATA } from '../config/i18n'
import { renderEnsemblePlume } from './ensemblePlume'
import { ENS_MODELS, type EnsModelKey, type EnsVarKey } from '../api/ensembleMembers'

const WINDY_MODELS = [
  { key: 'ecmwf', label: 'ECMWF' },
  { key: 'gfs',   label: 'GFS'   },
  { key: 'icon',  label: 'ICON'  },
  { key: 'nam',   label: 'NAM'   },
  { key: 'arome', label: 'AROME' },
]

type ModelsSource = 'map' | 'ensemble'

export function renderModelsPage() {
  const el  = document.getElementById('pageModels')
  if (!el) return
  const loc = state.currentLoc
  if (!loc) { el.innerHTML = ''; return }

  const t = LANG_DATA[state.lang]
  const source     = (state.modelPageSource     ?? 'map')          as ModelsSource
  const plumeVar   = (state.modelPagePlumeVar   ?? 'temp')         as EnsVarKey
  const plumeModel = (state.modelPagePlumeModel ?? 'gfs_seamless') as EnsModelKey

  // Windy variable labels — built from i18n so they update on language change
  const WINDY_VARS = [
    { key: 'wind',      label: `💨 ${t.statWind}`    },
    { key: 'temp',      label: `🌡️ ${t.mTemp}`       },
    { key: 'rain',      label: `💦 ${t.statPrecip}`  },
    { key: 'clouds',    label: t.windyClouds          },
    { key: 'pressure',  label: `📊 ${t.mPres}`       },
    { key: 'gust',      label: t.windyGusts           },
    { key: 'snowcover', label: t.windySnow            },
    { key: 'cape',      label: '⚡ CAPE'              },
  ]

  const PLUME_VARS: { key: 'temp' | 'precip' | 'wind'; label: string }[] = [
    { key: 'temp',   label: `🌡️ ${t.mTemp}`      },
    { key: 'precip', label: `🌧️ ${t.statPrecip}` },
    { key: 'wind',   label: `💨 ${t.statWind}`   },
  ]

  const sourceTabsHtml = `
    <div class="ctrl-group">
      <div class="ctrl-tabs source-tabs">
        <button class="ctrl-tab${source === 'map'      ? ' active' : ''}" data-src="map">${t.mapInteractive}</button>
        <button class="ctrl-tab${source === 'ensemble' ? ' active' : ''}" data-src="ensemble">${t.ensemblePlumes}</button>
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
        ℹ️ ${t.mapBy} <a href="https://windy.com" target="_blank" style="color:var(--accent2)">Windy.com</a>
      </div>
    `
  } else {
    // Ensemble / Plumes
    bodyHtml = `
      <div class="models-controls">
        <div class="ctrl-group">
          <span class="ctrl-label">${t.ctrlModel}:</span>
          <div class="ctrl-tabs">
            ${ENS_MODELS.map(m =>
              `<button class="ctrl-tab${m.key === plumeModel ? ' active' : ''}" data-pmdl="${m.key}">${m.flag} ${m.label}</button>`
            ).join('')}
          </div>
        </div>
        <div class="ctrl-group">
          <span class="ctrl-label">${t.ctrlVariable}:</span>
          <div class="ctrl-tabs">
            ${PLUME_VARS.map(v =>
              `<button class="ctrl-tab${v.key === plumeVar ? ' active' : ''}" data-pvar="${v.key}">${v.label}</button>`
            ).join('')}
          </div>
        </div>
      </div>
      <div class="plume-section">
        <div class="plume-title">${t.plumesTitle} · ${PLUME_VARS.find(v => v.key === plumeVar)?.label ?? ''}</div>
        <div class="plume-sub">${t.plumesSubtitle}</div>
        <div id="plumeChart" style="position:relative"></div>
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
    // Plume model selector
    el.querySelectorAll<HTMLButtonElement>('[data-pmdl]').forEach(btn => {
      btn.addEventListener('click', () => {
        ;(state as any).modelPagePlumeModel = btn.dataset.pmdl!
        renderModelsPage()
      })
    })
    // Plume variable selector
    el.querySelectorAll<HTMLButtonElement>('[data-pvar]').forEach(btn => {
      btn.addEventListener('click', () => {
        ;(state as any).modelPagePlumeVar = btn.dataset.pvar!
        renderModelsPage()
      })
    })
    // Render the plume chart with real ensemble members
    const plumeEl = document.getElementById('plumeChart')
    if (plumeEl) renderEnsemblePlume(plumeEl, plumeVar, plumeModel)
  }
}
