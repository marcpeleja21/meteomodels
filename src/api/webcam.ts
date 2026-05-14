export interface WebcamData {
  title:     string
  imageUrl:  string | null
  playerUrl: string | null
  linkUrl:   string | null
  distKm?:   number   // distance from requested coordinates (added client-side)
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

/**
 * Fetch the nearest webcam to (lat, lon).
 * @param maxKm  Only return a webcam within this distance (default: no limit)
 */
export async function fetchNearbyWebcam(
  lat: number,
  lon: number,
  maxKm = Infinity,
): Promise<WebcamData | null> {
  try {
    // Route through our Vercel edge proxy to avoid CORS restrictions
    const url = `/api/webcam?lat=${lat}&lon=${lon}`
    const res = await fetch(url)
    if (!res.ok) return null

    const json = await res.json()
    const allWebcams: any[] = json.webcams ?? []
    if (!allWebcams.length) return null

    // Exclude cruise-ship webcams — they may be hundreds of km away
    const CRUISE_RE = /cruise|ship|vessel|ferry|cruiser|viking|msc |costa |carnival|celebrity|royal caribbean/i
    let webcams = allWebcams.filter((w: any) => {
      const text = [w.title, w.location?.city, w.location?.country, w.category?.name].filter(Boolean).join(' ')
      return !CRUISE_RE.test(text)
    })

    if (!webcams.length) return null

    // Sort by haversine distance from the user's exact coordinates
    webcams.sort((a: any, b: any) => {
      const dA = (a.location?.latitude != null && a.location?.longitude != null)
        ? haversineKm(lat, lon, a.location.latitude, a.location.longitude) : Infinity
      const dB = (b.location?.latitude != null && b.location?.longitude != null)
        ? haversineKm(lat, lon, b.location.latitude, b.location.longitude) : Infinity
      return dA - dB
    })

    // Apply distance cap (used e.g. for per-beach webcam: only accept within 10 km)
    if (isFinite(maxKm)) {
      webcams = webcams.filter((w: any) => {
        if (w.location?.latitude == null || w.location?.longitude == null) return false
        return haversineKm(lat, lon, w.location.latitude, w.location.longitude) <= maxKm
      })
      if (!webcams.length) return null
    }

    // Pick the best webcam: prefer active + preview image, then any with preview
    const hasPreview = (w: any): boolean =>
      !!(w.images?.current?.preview ?? w.images?.current?.thumbnail ?? w.images?.current?.full)
    const wc =
      webcams.find((w: any) => w.status === 'active' && hasPreview(w)) ??
      webcams.find((w: any) => hasPreview(w)) ??
      webcams.find((w: any) => w.status === 'active') ??
      webcams[0]
    if (!wc) return null

    const is3cat = typeof wc.webcamId === 'string' && wc.webcamId.startsWith('3cat_')

    const playerRaw = wc.player?.day
    const playerUrl: string | null = is3cat
      ? null
      : typeof playerRaw === 'string'
        ? playerRaw
        : wc.webcamId
          ? `https://webcams.windy.com/webcams/public/embed/player/${wc.webcamId}/day`
          : null

    const imageUrl: string | null =
      wc.images?.current?.preview ??
      wc.images?.current?.thumbnail ??
      wc.images?.current?.full ??
      null

    const camId = is3cat ? wc.webcamId.replace('3cat_', '') : null
    const linkUrl: string | null = is3cat
      ? `https://www.3cat.cat/el-temps/camera/${camId}/`
      : wc.webcamId
        ? `https://www.windy.com/webcams/${wc.webcamId}`
        : null

    const distKm = (wc.location?.latitude != null && wc.location?.longitude != null)
      ? haversineKm(lat, lon, wc.location.latitude, wc.location.longitude)
      : undefined

    return {
      title: wc.title ?? wc.location?.city ?? 'Webcam',
      imageUrl,
      playerUrl,
      linkUrl,
      distKm,
    }
  } catch { return null }
}
