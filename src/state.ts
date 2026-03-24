import type { OpenMeteoResponse, AqiResponse, GeocodingResult } from './types'

export const state = {
  wxData: {} as Record<string, OpenMeteoResponse | null>,
  aqiData: null as AqiResponse | null,
  currentLoc: null as GeocodingResult | null,
  activeModel: 'ensemble' as string,
  lang: localStorage.getItem('mm_lang') ?? 'ca',
  meteobluKey: localStorage.getItem('mb_key') ?? '',
  activeMetric: 'tmax' as string,
}
