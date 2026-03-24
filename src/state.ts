import type { OpenMeteoResponse, AqiResponse, GeocodingResult } from './types'

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
  currentPage:    'forecast' as 'forecast' | 'models' | 'hourly',
  modelPageModel: 'ecmwf'    as string,
  modelPageVar:   'wind'     as string,
  hourlyModel:    'ensemble' as string,
}
