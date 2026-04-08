/**
 * Fetches ERA5-based historical climate normals from the Open-Meteo archive API.
 *
 * For a given location we pull the last 10 complete years of daily data and
 * keep only the ±21-day window around today's day-of-year (calendar-circular,
 * so Jan 5 also picks up Dec 25–Jan 26 from each year).  The result is the
 * "control" reference line — what the models' ensemble spread is compared
 * against, exactly like ensemble plumes compare members to the climatological
 * mean.
 *
 * Results are cached per location (1-decimal lat/lon) for the session so
 * subsequent renders and language changes are instant.
 */

export interface ClimaStats {
  tempMean:     number  // °C  — historical mean temperature for this date window
  precipPerDay: number  // mm  — historical mean daily precipitation
  windMean:     number  // km/h — historical mean wind speed
  sampleYears:  number  // how many years of data were averaged
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDayOfYear(d: Date): number {
  // 1–366
  const start = Date.UTC(d.getUTCFullYear(), 0, 0)
  return Math.floor((d.getTime() - start) / 86_400_000)
}

/** Shortest circular distance between two day-of-year values (0–365). */
function doyDist(a: number, b: number): number {
  const diff = Math.abs(a - b)
  return Math.min(diff, 366 - diff)
}

// ── Session cache ──────────────────────────────────────────────────────────────
const cache = new Map<string, ClimaStats>()

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchClimatology(
  lat: number,
  lon: number,
): Promise<ClimaStats | null> {
  const cacheKey = `${lat.toFixed(1)},${lon.toFixed(1)}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  const now      = new Date()
  const doy      = getDayOfYear(now)
  const thisYear = now.getUTCFullYear()

  // Use the last 10 complete calendar years so we never include partial data
  const lastYear  = thisYear - 1
  const firstYear = lastYear - 9   // 10 years

  const url =
    'https://archive-api.open-meteo.com/v1/archive' +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${firstYear}-01-01&end_date=${lastYear}-12-31` +
    `&daily=temperature_2m_mean,precipitation_sum,wind_speed_10m_mean` +
    `&timezone=UTC`

  try {
    const res = await fetch(url)
    if (!res.ok) return null

    const json = await res.json()
    const times:  string[]           = json.daily?.time            ?? []
    const temps:  (number | null)[]  = json.daily?.temperature_2m_mean ?? []
    const precip: (number | null)[]  = json.daily?.precipitation_sum   ?? []
    const wind:   (number | null)[]  = json.daily?.wind_speed_10m_mean ?? []

    if (!times.length) return null

    const tempVals:   number[] = []
    const precipVals: number[] = []
    const windVals:   number[] = []
    const yearsFound = new Set<number>()

    for (let i = 0; i < times.length; i++) {
      const d    = new Date(times[i])
      const doyI = getDayOfYear(d)
      // ±21-day window around today's calendar position, circular
      if (doyDist(doy, doyI) > 21) continue

      yearsFound.add(d.getUTCFullYear())
      if (temps[i]  != null) tempVals.push(temps[i]!)
      if (precip[i] != null) precipVals.push(precip[i]!)
      if (wind[i]   != null) windVals.push(wind[i]!)
    }

    if (!tempVals.length) return null

    const stats: ClimaStats = {
      tempMean:     tempVals.reduce((a, b) => a + b, 0) / tempVals.length,
      precipPerDay: precipVals.length
        ? precipVals.reduce((a, b) => a + b, 0) / precipVals.length
        : 0,
      windMean: windVals.length
        ? windVals.reduce((a, b) => a + b, 0) / windVals.length
        : 0,
      sampleYears: yearsFound.size,
    }

    cache.set(cacheKey, stats)
    return stats
  } catch {
    return null
  }
}
