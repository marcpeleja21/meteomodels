import type { OpenMeteoResponse } from '../types'

export interface DivergenceResult {
  tempSpread:   number               // °C difference between highest and lowest model max-temp
  precipSpread: number               // percentage points difference in precip probability
  level:        'low' | 'med' | 'high'
}

/**
 * Compute how much the loaded models disagree for the current day (index 0).
 * Returns null if fewer than 2 models are loaded.
 */
export function computeDivergence(
  wxData: Record<string, OpenMeteoResponse | null>,
): DivergenceResult | null {
  const maxTemps: number[] = []
  const precipProbs: number[] = []

  for (const d of Object.values(wxData)) {
    if (!d) continue
    const t = d.daily.temperature_2m_max[0]
    const p = d.daily.precipitation_probability_max?.[0]
    if (t != null) maxTemps.push(t)
    if (p != null) precipProbs.push(p)
  }

  if (maxTemps.length < 2) return null

  const tempSpread   = Math.max(...maxTemps) - Math.min(...maxTemps)
  const precipSpread = precipProbs.length >= 2
    ? Math.max(...precipProbs) - Math.min(...precipProbs)
    : 0

  const level =
    tempSpread > 6 || precipSpread > 50 ? 'high' :
    tempSpread > 3 || precipSpread > 30 ? 'med'  : 'low'

  return { tempSpread, precipSpread, level }
}
