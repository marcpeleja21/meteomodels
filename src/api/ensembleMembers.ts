/**
 * Fetches real ensemble member data from the Open-Meteo Ensemble API.
 * Returns individual member arrays that can be plotted as spaghetti lines.
 *
 * AROME HD is a deterministic (non-ensemble) model — it is handled specially
 * by pulling hourly data from state.wxData instead of the ensemble API, and
 * is returned as a single-member dataset with `deterministic: true`.
 */
import { state } from '../state'

export type EnsModelKey =
  | 'gfs_seamless'
  | 'icon_seamless'
  | 'ecmwf_ifs04'
  | 'gem_global'
  | 'arome_hd'

export type EnsVarKey = 'temp' | 'precip' | 'wind'

export interface EnsembleMemberData {
  times:         string[]             // ISO hourly timestamps
  members:       (number | null)[][]  // [memberIdx][timeIdx] → value | null
  unit:          string
  nMembers:      number
  deterministic: boolean              // true when only one deterministic member
}

export const ENS_MODELS: {
  key:           EnsModelKey
  label:         string
  flag:          string
  nMembers:      number
  deterministic: boolean
}[] = [
  { key: 'gfs_seamless',  label: 'GFS ENS',   flag: '🇺🇸', nMembers: 30, deterministic: false },
  { key: 'icon_seamless', label: 'ICON ENS',  flag: '🇩🇪', nMembers: 39, deterministic: false },
  { key: 'ecmwf_ifs04',   label: 'ECMWF ENS', flag: '🇪🇺', nMembers: 51, deterministic: false },
  { key: 'gem_global',    label: 'GEM ENS',   flag: '🇨🇦', nMembers: 20, deterministic: false },
  { key: 'arome_hd',      label: 'AROME HD',  flag: '🇫🇷', nMembers:  1, deterministic: true  },
]

const VAR_API: Record<EnsVarKey, { name: string; unit: string }> = {
  temp:   { name: 'temperature_2m', unit: '°C'   },
  precip: { name: 'precipitation',  unit: 'mm'   },
  wind:   { name: 'wind_speed_10m', unit: 'km/h' },
}

// Simple in-memory cache keyed by lat,lon,model,variable
const _cache = new Map<string, EnsembleMemberData>()

export async function fetchEnsembleMembers(
  lat: number,
  lon: number,
  model: EnsModelKey = 'gfs_seamless',
  variable: EnsVarKey = 'temp',
): Promise<EnsembleMemberData | null> {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${model},${variable}`
  if (_cache.has(cacheKey)) return _cache.get(cacheKey)!

  const { name: varName, unit } = VAR_API[variable]

  // ── AROME HD: deterministic model — read from state.wxData ───────────────
  if (model === 'arome_hd') {
    const wxData = state.wxData['arome_hd']
    if (!wxData?.hourly) return null

    const raw: (number | null)[] =
      variable === 'temp'   ? wxData.hourly.temperature_2m  :
      variable === 'precip' ? wxData.hourly.precipitation    :
                              wxData.hourly.wind_speed_10m

    if (!raw?.length) return null

    const result: EnsembleMemberData = {
      times:    wxData.hourly.time,
      members:  [raw],
      unit,
      nMembers: 1,
      deterministic: true,
    }
    _cache.set(cacheKey, result)
    return result
  }

  // ── Ensemble models: call Open-Meteo Ensemble API ─────────────────────────
  const url =
    `https://ensemble-api.open-meteo.com/v1/ensemble` +
    `?latitude=${lat}&longitude=${lon}` +
    `&models=${model}` +
    `&hourly=${varName}` +
    `&wind_speed_unit=kmh` +
    `&forecast_days=7` +
    `&timezone=auto`

  try {
    const res  = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    if (json.error) return null

    const hourly = json.hourly ?? {}
    const times: string[] = hourly.time ?? []

    // Collect all member arrays — keys like temperature_2m_member00 … member50
    const memberKeys = (Object.keys(hourly) as string[])
      .filter(k => k.startsWith(`${varName}_member`))
      .sort()

    const members: (number | null)[][] = memberKeys.map(k => hourly[k] as (number | null)[])

    if (!members.length) return null

    const result: EnsembleMemberData = {
      times,
      members,
      unit,
      nMembers: members.length,
      deterministic: false,
    }
    _cache.set(cacheKey, result)
    return result
  } catch {
    return null
  }
}

/** Clear cached data (e.g. when location changes) */
export function clearEnsembleCache() {
  _cache.clear()
}
