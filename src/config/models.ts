import type { WeatherModel } from '../types'
import { state } from '../state'

/** Returns true if the model's forecast range covers the given day index (0 = today) */
export function modelValidForDay(m: WeatherModel, dayIndex: number): boolean {
  return dayIndex < (m.maxDays ?? 999)
}

/** Returns true if the model's forecast range covers hours from now */
export function modelValidForHours(m: WeatherModel, hoursFromNow: number): boolean {
  return hoursFromNow < (m.maxDays ?? 999) * 24
}

/**
 * Approximate European bounding box.
 * Covers continental Europe + Iceland, Canary Islands, Cyprus, etc.
 */
export function isEurope(lat: number, lon: number): boolean {
  return lat >= 27 && lat <= 72 && lon >= -25 && lon <= 45
}

/**
 * Central European bounding box — covers the domain of high-res LAMs
 * such as ICON D2 (DWD, 2.2 km) and GeoSphere AROME Austria (2.5 km).
 * Roughly: Germany, Austria, Switzerland, France, Benelux, Czech, Poland,
 * northern Italy, Denmark. Excludes Iberian Peninsula and UK.
 */
export function isCentralEurope(lat: number, lon: number): boolean {
  return lat >= 43.5 && lat <= 57.5 && lon >= -4 && lon <= 20
}

/**
 * Returns the active model list for the current location in state.
 * - Inside Europe      → ICON EU shown,       ICON Global hidden
 * - Outside Europe     → ICON Global shown,   ICON EU hidden
 * - Central Europe     → ICON D2 + GeoSphere AROME shown
 * Falls back to full list when no location is loaded yet.
 */
export function getActiveModels(): WeatherModel[] {
  const loc = state.currentLoc
  if (!loc) return MODELS
  const europe  = isEurope(loc.latitude, loc.longitude)
  const central = isCentralEurope(loc.latitude, loc.longitude)
  return MODELS.filter(m => {
    if (m.key === 'icon')          return !europe   // global only outside Europe
    if (m.key === 'icon_eu')       return europe    // EU only inside Europe
    if (m.key === 'icon_d2')       return central   // DWD LAM — Central Europe only
    if (m.key === 'geosphere')     return central   // GeoSphere AROME — Central Europe only
    if (m.key === 'knmi_harmonie') return europe    // KNMI HARMONIE — Europe only
    if (m.key === 'dmi_harmonie')  return europe    // DMI HARMONIE — Europe only
    return true
  })
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
  { key:'icon_d2',       name:'ICON D2',         fullName:'ICON Deutschland 2 (2.2 km)',          apiId:'icon_d2',                     org:'DWD · Alemanya',     color:'#f48fb1', flag:'🇩🇪', avail:true, global:false, coverage:'Europa Central',  maxDays:2 },
  { key:'geosphere',    name:'ALADIN-AROME',    fullName:'AROME Àustria / ALADIN (2.5 km)',      apiId:'geosphere_arome_austria',     org:'GeoSphere · Àustria', color:'#9fa8da', flag:'🇦🇹', avail:true, global:false, coverage:'Alps / Europa Central', maxDays:2 },
  { key:'knmi_harmonie',name:'HARMONIE EU',     fullName:'HARMONIE-AROME Europa (2.5 km)',       apiId:'knmi_harmonie_arome_europe',  org:'KNMI · Països Baixos', color:'#b39ddb', flag:'🇳🇱', avail:true, global:false, coverage:'Europa', maxDays:2 },
  { key:'dmi_harmonie', name:'HARMONIE DMI',    fullName:'HARMONIE-AROME Europa / DMI (2.5 km)',apiId:'dmi_harmonie_arome_europe',   org:'DMI · Dinamarca',    color:'#4dd0e1', flag:'🇩🇰', avail:true, global:false, coverage:'Europa', maxDays:2 },
  { key:'ukmo',         name:'UKMO',            fullName:'UK Met Office Global (10 km)',         apiId:'ukmo_seamless',               org:'Met Office · UK',    color:'#ffb74d', flag:'🇬🇧', avail:true, global:true  },
  { key:'gem',          name:'GEM',             fullName:'Global Environmental Multiscale (15 km)',apiId:'gem_seamless',              org:'ECCC · Canadà',      color:'#c5e1a5', flag:'🇨🇦', avail:true, global:true  },
]
