export interface WebcamData {
  title: string
  imageUrl: string | null
  playerUrl: string | null
}

// Windy free API — requires key at https://developers.windy.com (Community plan, free)
const WINDY_KEY = ''

export async function fetchNearbyWebcam(lat: number, lon: number): Promise<WebcamData | null> {
  if (!WINDY_KEY) return null
  try {
    const url = `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat},${lon},30&limit=1&orderby=rating&include=images,player`
    const res = await fetch(url, { headers: { 'x-windy-api-key': WINDY_KEY } })
    if (!res.ok) return null
    const json = await res.json()
    const wc = json.webcams?.[0]
    if (!wc) return null
    return {
      title: wc.title ?? '',
      imageUrl: wc.images?.current?.preview ?? null,
      playerUrl: wc.player?.day?.iframe ?? null,
    }
  } catch { return null }
}
