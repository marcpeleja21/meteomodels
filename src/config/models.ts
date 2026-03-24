import type { WeatherModel } from '../types'

/** Returns true if the model's forecast range covers the given day index (0 = today) */
export function modelValidForDay(m: WeatherModel, dayIndex: number): boolean {
  return dayIndex < (m.maxDays ?? 999)
}

/** Returns true if the model's forecast range covers hours from now */
export function modelValidForHours(m: WeatherModel, hoursFromNow: number): boolean {
  return hoursFromNow < (m.maxDays ?? 999) * 24
}

export const MODELS: WeatherModel[] = [
  { key:'gfs',       name:'GFS',         fullName:'Global Forecast System',       apiId:'gfs_seamless',                 org:'NOAA · EUA',      color:'#4fc3f7', flag:'🇺🇸', avail:true,  global:true  },
  { key:'ecmwf',     name:'ECMWF IFS',   fullName:'Integrated Forecasting System', apiId:'ecmwf_ifs025',                org:'ECMWF · Europa',  color:'#ce93d8', flag:'🇪🇺', avail:true,  global:true  },
  { key:'icon',      name:'ICON',        fullName:'ICON Global',                   apiId:'icon_seamless',               org:'DWD · Alemanya',  color:'#ef9a9a', flag:'🇩🇪', avail:true,  global:true  },
  { key:'icon_eu',   name:'ICON EU',     fullName:'ICON Europa (7 km)',            apiId:'icon_eu',                     org:'DWD · Alemanya',  color:'#ffab91', flag:'🇩🇪', avail:true,  global:false, coverage:'Europa' },
  { key:'meteoblue', name:'MeteoBlue',   fullName:'NMM Nonhydrostatic Meso-Scale', apiId:null,                          org:'MeteoBlue · CH',  color:'#a5d6a7', flag:'🇨🇭', avail:false, mb:true      },
  { key:'arome_hd',  name:'AROME HD',    fullName:'AROME France HD (1.5 km)',      apiId:'meteofrance_arome_france_hd', org:'Météo-France',    color:'#80deea', flag:'🇫🇷', avail:true,  global:false, coverage:'França', maxDays:2 },
  { key:'arome',     name:'AROME 2.5km', fullName:'AROME France (2.5 km)',         apiId:'meteofrance_arome_france',    org:'Météo-France',    color:'#80cbc4', flag:'🇫🇷', avail:true,  global:false, coverage:'França', maxDays:2 },
  { key:'arpege',    name:'ARPEGE EU',   fullName:'ARPEGE Europa · proxy ALADIN',  apiId:'meteofrance_arpege_europe',   org:'Météo-France',    color:'#ffcc80', flag:'🇫🇷', avail:true,  global:false, coverage:'Europa' },
]
