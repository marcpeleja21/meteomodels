import type { OpenMeteoResponse, AqiResponse, GeocodingResult, CurrentObs } from './types'

export const state = {
  wxData:      {} as Record<string, OpenMeteoResponse | null>,
  aqiData:     null as AqiResponse | null,
  currentLoc:  null as GeocodingResult | null,
  activeModel: 'ensemble' as string,
  lang:        localStorage.getItem('mm_lang') ?? 'ca',
  meteobluKey: localStorage.getItem('mb_key') ?? '',
  activeMetric: 'temp' as string,
  selectedDay:  0 as number,        // 0 = current, 1+ = day index

  // Subpages
  currentPage:    'forecast' as 'forecast' | 'models',
  modelPageModel: 'ecmwf'    as string,
  modelPageVar:   'wind'     as string,
  modelPageSource:   'map'   as string,
  modelPagePlumeVar: 'temp'  as string,
  hourlyModel:    'ensemble' as string,

  // Forecast UI state
  forecastMode:         'days' as 'days' | 'hours',
  forecastDaysExpanded: false  as boolean,
  currentObs:           null   as CurrentObs | null,

  // Table
  tableDays: 4 as number,   // 4 = compact, 7 = full
}
