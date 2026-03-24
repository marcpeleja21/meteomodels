export interface WebcamData {
  title:     string
  imageUrl:  string | null
  playerUrl: string | null
  linkUrl:   string | null
}

const WINDY_KEY = 'GC7hTRIRIMPMcO8qFe27DzAZIWJoOnH3'

export async function fetchNearbyWebcam(lat: number, lon: number): Promise<WebcamData | null> {
  try {
    const url = `https://api.windy.com/webcams/api/v3/webcams` +
      `?nearby=${lat},${lon},50` +
      `&limit=5&orderby=rating&include=images,player`

    const res = await fetch(url, { headers: { 'x-windy-api-key': WINDY_KEY } })
    if (!res.ok) return null

    const json = await res.json()
    // Pick first active webcam
    const wc = (json.webcams ?? []).find((w: any) => w.status === 'active') ?? json.webcams?.[0]
    if (!wc) return null

    return {
      title:     wc.title ?? '',
      imageUrl:  wc.images?.current?.preview ?? null,
      playerUrl: wc.player?.day ?? null,          // v3: player.day is a URL string
      linkUrl:   `https://www.windy.com/webcams/${wc.webcamId}`,
    }
  } catch { return null }
}
