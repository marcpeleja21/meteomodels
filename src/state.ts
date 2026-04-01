import type { OpenMeteoResponse, AqiResponse, GeocodingResult, CurrentObs } from './types'

/** Maps browser navigator.language to one of the 4 supported app languages. */
function detectLang(): string {
  // navigator.languages is ordered by preference; fall back to navigator.language
  const candidates = (navigator.languages?.length ? navigator.languages : [navigator.language])
  for (const raw of candidates) {
    const code = raw.toLowerCase()
    if (code.startsWith('ca')) return 'ca'
    if (code.startsWith('es')) return 'es'
    if (code.startsWith('fr')) return 'fr'
    if (code.startsWith('en')) return 'en'
  }
  // No match — default to English for international visitors
  return 'en'
}

export const state = {
  wxData:      {} as Record<string, OpenMeteoResponse | null>,
  aqiData:     null as AqiResponse | null,
  currentLoc:  null as GeocodingResult | null,
  activeModel: 'ensemble' as string,
  lang:        localStorage.getItem('mm_lang') ?? detectLang(),
  meteobluKey: localStorage.getItem('mb_key') ?? '',
  activeMetric: 'temp' as string,
  selectedDay:  0 as number,        // 0 = current, 1+ = day index

  // Subpages
  currentPage:    'forecast' as 'forecast' | 'models',
  modelPageModel: 'ecmwf'    as string,
  modelPageVar:   'wind'     as string,
  modelPageSource:   'map'   as string,
  modelPagePlumeVar:   'temp'          as string,
  modelPagePlumeModel: 'gfs_seamless' as string,
  hourlyModel:    'ensemble' as string,

  // Forecast UI state
  forecastMode:         'days' as 'days' | 'hours',
  forecastDaysExpanded: false  as boolean,
  currentObs:           null   as CurrentObs | null,

  // Table
  tableDays: 4 as number,   // 4 = compact, 7 = full
}
