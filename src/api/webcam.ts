export interface WebcamData {
  title:     string
  imageUrl:  string | null
  playerUrl: string | null
  linkUrl:   string | null
}

/** Haversine great-circle distance in km */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function fetchNearbyWebcam(lat: number, lon: number): Promise<WebcamData | null> {
  try {
    // Route through our Vercel edge proxy to avoid CORS restrictions
    const url = `/api/webcam?lat=${lat}&lon=${lon}`
    const res = await fetch(url)
    if (!res.ok) return null

    const json = await res.json()
    const allWebcams: any[] = json.webcams ?? []
    if (!allWebcams.length) return null

    // Exclude cruise-ship webcams — they may be hundreds of km away from the selected location
    const CRUISE_RE = /cruise|ship|vessel|ferry|cruiser|viking|msc |costa |carnival|celebrity|royal caribbean/i
    const webcams = allWebcams.filter((w: any) => {
      const text = [w.title, w.location?.city, w.location?.country, w.category?.name].filter(Boolean).join(' ')
      return !CRUISE_RE.test(text)
    })

    if (!webcams.length) return null

    // Sort by haversine distance from the user's exact coordinates.
    // The server already does this, but we re-sort client-side as a safety net
    // in case the proxy response is cached or the order changed after filtering.
    webcams.sort((a: any, b: any) => {
      const aLat = a.location?.latitude
      const aLon = a.location?.longitude
      const bLat = b.location?.latitude
      const bLon = b.location?.longitude
      const dA = (aLat != null && aLon != null) ? haversineKm(lat, lon, aLat, aLon) : Infinity
      const dB = (bLat != null && bLon != null) ? haversineKm(lat, lon, bLat, bLon) : Infinity
      return dA - dB
    })

    // Pick the best webcam among those closest: prefer active + has preview image, then any with preview.
    // Because the list is now sorted by distance, the first matching webcam is the nearest suitable one.
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
