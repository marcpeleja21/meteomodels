import type { WebcamData } from '../api/webcam'

export function renderWebcamCard(data: WebcamData | null) {
  const el = document.getElementById('webcamCard')
  if (!el) return

  if (!data || !data.imageUrl) {
    // Show a neutral placeholder so the media-row grid stays balanced with the map
    el.innerHTML = `
      <div class="media-card webcam-placeholder">
        <div class="webcam-no-signal">📷 <span>Cap webcam disponible a prop</span></div>
      </div>`
    return
  }

  const linkAttr = data.linkUrl ? `href="${data.linkUrl}" target="_blank" rel="noopener"` : ''

  // Always use the static image (iframe embeds are blocked without a Windy premium plan).
  // The image auto-refreshes every 5 min via a timestamp query-param rotation.
  el.innerHTML = `
    <div class="media-card">
      <div class="media-label">
        <a ${linkAttr} style="color:inherit;text-decoration:none">📷 ${data.title}</a>
      </div>
      ${data.playerUrl ? `
        <a class="webcam-live-badge" ${linkAttr} title="Veure en directe a Windy">
          🔴 EN DIRECTE
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

  // Auto-refresh the snapshot every 5 minutes
  const img = el.querySelector<HTMLImageElement>('#webcamImg')
  if (img && data.imageUrl) {
    const base = data.imageUrl.split('?')[0]
    setInterval(() => {
      img.src = `${base}?t=${Date.now()}`
    }, 5 * 60 * 1000)
  }
}
