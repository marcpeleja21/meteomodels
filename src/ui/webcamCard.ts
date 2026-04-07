import type { WebcamData } from '../api/webcam'
import { state } from '../state'
import { LANG_DATA } from '../config/i18n'

export function renderWebcamCard(data: WebcamData | null) {
  const el = document.getElementById('webcamCard')
  if (!el) return

  const lang = LANG_DATA[state.lang] ?? LANG_DATA.en

  if (!data || !data.imageUrl) {
    el.innerHTML = `
      <div class="media-card webcam-placeholder">
        <div class="webcam-no-signal">📷 <span>${lang.noWebcam}</span></div>
      </div>`
    return
  }

  const linkAttr = data.linkUrl ? `href="${data.linkUrl}" target="_blank" rel="noopener"` : ''

  el.innerHTML = `
    <div class="media-card">
      <div class="media-label">
        <a ${linkAttr} style="color:inherit;text-decoration:none">📷 ${data.title}</a>
      </div>
      ${data.playerUrl ? `
        <a class="webcam-live-badge" ${linkAttr} title="${lang.webcamViewLive}">
          🔴 ${lang.webcamLive}
        </a>` : ''}
      <a ${linkAttr}>
        <img
          id="webcamImg"
          src="${data.imageUrl}"
          class="webcam-img"
          alt="${data.title}"
          loading="lazy"
          onerror="this.parentElement.parentElement.querySelector('.webcam-img-wrap')?.classList.add('hidden')"
        />
      </a>
    </div>`

  const img = el.querySelector<HTMLImageElement>('#webcamImg')
  if (img && data.imageUrl) {
    const base = data.imageUrl.split('?')[0]
    setInterval(() => {
      img.src = `${base}?t=${Date.now()}`
    }, 5 * 60 * 1000)
  }
}
