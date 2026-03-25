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

    // Prefer active webcams; fall back to first result
    const wc = webcams.find((w: any) => w.status === 'active') ?? webcams[0]
    if (!wc) return null

    // v3: player can be { day: "url" } or { day: { embed: "url" } }
    const playerRaw = wc.player?.day
    const playerUrl: string | null =
      typeof playerRaw === 'string'
        ? playerRaw
        : typeof playerRaw?.embed === 'string'
          ? playerRaw.embed
          : typeof playerRaw?.link === 'string'
            ? playerRaw.link
            : wc.webcamId
              ? `https://webcams.windy.com/webcams/public/embed/player/${wc.webcamId}/day`
              : null

    // v3: images.current.preview or images.current.full
    const imageUrl: string | null =
      wc.images?.current?.preview ??
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
