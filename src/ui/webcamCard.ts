import type { WebcamData } from '../api/webcam'

export function renderWebcamCard(data: WebcamData | null) {
  const el = document.getElementById('webcamCard')
  if (!el) return

  if (!data) {
    // Show a neutral placeholder so the media-row grid stays balanced with the map
    el.innerHTML = `
      <div class="media-card webcam-placeholder">
        <div class="webcam-no-signal">📷 <span>Cap webcam disponible a prop</span></div>
      </div>`
    return
  }

  const linkAttr = data.linkUrl ? `href="${data.linkUrl}" target="_blank"` : ''

  if (data.playerUrl) {
    // Embed the Windy player iframe + overlay label linked to Windy
    el.innerHTML = `
      <div class="media-card">
        <div class="media-label">
          <a ${linkAttr} style="color:inherit;text-decoration:none">📷 ${data.title}</a>
        </div>
        <iframe
          src="${data.playerUrl}"
          frameborder="0"
          allowfullscreen
          class="webcam-frame"
          loading="lazy">
        </iframe>
      </div>`
  } else if (data.imageUrl) {
    el.innerHTML = `
      <div class="media-card">
        <div class="media-label">
          <a ${linkAttr} style="color:inherit;text-decoration:none">📷 ${data.title}</a>
        </div>
        <a ${linkAttr}>
          <img src="${data.imageUrl}" class="webcam-img" alt="${data.title}" loading="lazy"/>
        </a>
      </div>`
  }
}
