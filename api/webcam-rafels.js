/**
 * Vercel Edge Function — Webcam proxy for Ràfels
 *
 * Priority:
 *   1. WEBCAM_STREAM_URL  — live stream URL (HLS .m3u8 or MJPEG).
 *      Returned as JSON { mode:'stream', url } for the browser to play directly.
 *      Set this to the public URL of your go2rtc / mediamtx instance
 *      (e.g. via Cloudflare Tunnel): https://xxx.cfargotunnel.com/index.m3u8
 *
 *   2. WEBCAM_SNAPSHOT_URL — fallback single-JPEG proxy (credentials embedded
 *      in the URL stay server-side, the browser never sees them).
 */
export const config = { runtime: 'edge' }

export default async function handler() {
  // ── Streaming mode ─────────────────────────────────────────────────────────
  const streamUrl = process.env.WEBCAM_STREAM_URL
  if (streamUrl) {
    return new Response(JSON.stringify({ mode: 'stream', url: streamUrl }), {
      headers: {
        'Content-Type':                'application/json',
        'Cache-Control':               'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  // ── Snapshot proxy fallback ────────────────────────────────────────────────
  const snapshotUrl = process.env.WEBCAM_SNAPSHOT_URL
  if (!snapshotUrl) return new Response(null, { status: 404 })

  const supabaseKey = process.env.SUPABASE_KEY
  // Authenticated endpoint skips Supabase's Cloudflare CDN; public URL is cached
  const fetchUrl = supabaseKey
    ? snapshotUrl.replace('/object/public/', '/object/')
    : snapshotUrl

  try {
    const res = await fetch(fetchUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      ...(supabaseKey && { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }),
    })
    if (!res.ok) return new Response(null, { status: 502 })
    const data = await res.arrayBuffer()
    return new Response(data, {
      headers: {
        'Content-Type':             res.headers.get('Content-Type') ?? 'image/jpeg',
        'Cache-Control':            'no-store',
        'CDN-Cache-Control':        'no-store',
        'Vercel-CDN-Cache-Control': 'no-store',
      },
    })
  } catch {
    return new Response(null, { status: 504 })
  }
}
