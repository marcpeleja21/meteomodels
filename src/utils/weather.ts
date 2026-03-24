import type { WeatherCondition, WxStrings } from '../types'

/** WMO weather interpretation code → { lbl, icon, type } */
export function wxFromCode(code: number | null, wx: WxStrings): WeatherCondition {
  if (code === null) return { lbl: wx.unknown, icon: '❓', type: 'clear' }

  if (code === 0)          return { lbl: wx.clear,    icon: '☀️',  type: 'clear'  }
  if (code === 1)          return { lbl: wx.mainly,   icon: '🌤️',  type: 'clear'  }
  if (code === 2)          return { lbl: wx.partly,   icon: '⛅',  type: 'cloud'  }
  if (code === 3)          return { lbl: wx.overcast, icon: '☁️',  type: 'cloud'  }
  if (code >= 45 && code <= 48) return { lbl: wx.fog,   icon: '🌫️', type: 'fog'   }
  if (code >= 51 && code <= 55) return { lbl: wx.drizzle, icon: '🌦️', type: 'rain' }
  if (code >= 56 && code <= 57) return { lbl: wx.fdrizzle, icon: '🌧️', type: 'rain' }
  if (code >= 61 && code <= 65) return { lbl: wx.rain,  icon: '🌧️', type: 'rain'  }
  if (code >= 66 && code <= 67) return { lbl: wx.frain, icon: '🌧️', type: 'rain'  }
  if (code >= 71 && code <= 75) return { lbl: wx.snow,  icon: '❄️',  type: 'snow'  }
  if (code === 77)          return { lbl: wx.grains,  icon: '🌨️', type: 'snow'  }
  if (code >= 80 && code <= 82) return { lbl: wx.showers, icon: '🌦️', type: 'rain' }
  if (code >= 85 && code <= 86) return { lbl: wx.sshowers, icon: '🌨️', type: 'snow' }
  if (code === 95)          return { lbl: wx.storm,   icon: '⛈️',  type: 'storm' }
  if (code >= 96)           return { lbl: wx.storm,   icon: '⛈️',  type: 'storm' }
  return { lbl: wx.unknown, icon: '❓', type: 'clear' }
}

/** AQI European index → { lbl, cls } */
export function aqiInfo(aqi: number | null, aqiStr: { good:string; fair:string; mod:string; poor:string; vpoor:string; ext:string }) {
  if (aqi === null) return null
  if (aqi <= 20)   return { lbl: aqiStr.good,  cls: 'green'  }
  if (aqi <= 40)   return { lbl: aqiStr.fair,  cls: 'green'  }
  if (aqi <= 60)   return { lbl: aqiStr.mod,   cls: 'yellow' }
  if (aqi <= 80)   return { lbl: aqiStr.poor,  cls: 'orange' }
  if (aqi <= 100)  return { lbl: aqiStr.vpoor, cls: 'red'    }
  return { lbl: aqiStr.ext, cls: 'red' }
}

/** Round to 1 decimal, return null if NaN */
export function round1(v: number | null): number | null {
  if (v === null || isNaN(v)) return null
  return Math.round(v * 10) / 10
}

export function avg(vals: (number | null)[]): number | null {
  const filtered = vals.filter((v): v is number => v !== null && !isNaN(v))
  if (!filtered.length) return null
  return filtered.reduce((a, b) => a + b, 0) / filtered.length
}

export function fmt(v: number | null, decimals = 0): string {
  if (v === null) return '—'
  return v.toFixed(decimals)
}
