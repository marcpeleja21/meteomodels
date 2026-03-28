export interface WebcamData {
  title:     string
  imageUrl:  string | null
  playerUrl: string | null
  linkUrl:   string | null
}

export async function fetchNearbyWebcam(lat: number, lon: number): Promise<WebcamData | null> {
  try {
    // Route through our Vercel edge proxy to avoid CORS restrictions
    const url = `/api/webcam?lat=${lat}&lon=${lon}`
    const res = await fetch(url)
    if (!res.ok) return null

    const json = await res.json()
    const webcams: any[] = json.webcams ?? []
    if (!webcams.length) return null

    // Pick the best webcam: prefer active + has preview image, then any with preview
    const hasPreview = (w: any): boolean =>
      !!(w.images?.current?.preview ?? w.images?.current?.thumbnail ?? w.images?.current?.full)
    const wc =
      webcams.find((w: any) => w.status === 'active' && hasPreview(w)) ??
      webcams.find((w: any) => hasPreview(w)) ??
      webcams.find((w: any) => w.status === 'active') ??
      webcams[0]
    if (!wc) return null

    // v3: player.day is a plain string
    const playerRaw = wc.player?.day
    const playerUrl: string | null =
      typeof playerRaw === 'string'
        ? playerRaw
        : wc.webcamId
          ? `https://webcams.windy.com/webcams/public/embed/player/${wc.webcamId}/day`
          : null

    // v3: images.current.preview > thumbnail > full
    const imageUrl: string | null =
      wc.images?.current?.preview ??
      wc.images?.current?.thumbnail ??
      wc.images?.current?.full ??
      null

    return {
      title:     wc.title ?? wc.location?.city ?? 'Webcam',
      imageUrl,
      playerUrl,
      linkUrl:   wc.webcamId
        ? `https://www.windy.com/webcams/${wc.webcamId}`
        : null,
    }
  } catch { return null }
}
