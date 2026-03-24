import type { WebcamData } from '../api/webcam'

export function renderWebcamCard(data: WebcamData | null) {
  const el = document.getElementById('webcamCard')
  if (!el) return
  if (!data || (!data.imageUrl && !data.playerUrl)) {
    el.innerHTML = ''
    return
  }
  if (data.playerUrl) {
    el.innerHTML = `<div class="media-card"><div class="media-label">📷 ${data.title}</div><iframe src="${data.playerUrl}" frameborder="0" allowfullscreen class="webcam-frame"></iframe></div>`
  } else if (data.imageUrl) {
    el.innerHTML = `<div class="media-card"><div class="media-label">📷 ${data.title}</div><img src="${data.imageUrl}" class="webcam-img" alt="${data.title}"/></div>`
  }
}
