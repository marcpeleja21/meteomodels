export interface WeatherModel {
  key: string
  name: string
  fullName: string
  apiId: string | null
  org: string
  color: string
  flag: string
  avail: boolean
  global?: boolean
  coverage?: string
  mb?: boolean
  maxDays?: number   // models with limited forecast range (e.g. AROME = 2 days)
}

export interface GeocodingResult {
  id: number
  name: string
  latitude: number
  longitude: number
  elevation?: number
  country: string
  admin1?: string
  admin2?: string
  timezone: string
  country_code: string
}

export interface HourlyData {
  time: string[]
  temperature_2m: (number | null)[]
  apparent_temperature: (number | null)[]
  precipitation_probability: (number | null)[]
  precipitation: (number | null)[]
  weathercode: (number | null)[]
  windspeed_10m: (number | null)[]
  winddirection_10m: (number | null)[]
  relative_humidity_2m: (number | null)[]
  pressure_msl: (number | null)[]
  cloudcover: (number | null)[]
}

export interface DailyData {
  time: string[]
  temperature_2m_max: (number | null)[]
  temperature_2m_min: (number | null)[]
  precipitation_sum: (number | null)[]
  precipitation_probability_max: (number | null)[]
  weathercode: (number | null)[]
  windspeed_10m_max: (number | null)[]
  windgusts_10m_max: (number | null)[]
}

export interface OpenMeteoResponse {
  latitude: number
  longitude: number
  timezone: string
  hourly: HourlyData
  daily: DailyData
  error?: boolean
  reason?: string
}

export interface AqiResponse {
  hourly: {
    time: string[]
    european_aqi: (number | null)[]
    pm10: (number | null)[]
    pm2_5: (number | null)[]
  }
}

export interface WeatherCondition {
  lbl: string
  icon: string
  type: string
}

export interface CurrentWeather {
  temp: number | null
  feels: number | null
  rain: number | null
  code: number | null
  wind: number | null
  windDir: number | null
  hum: number | null
  pres: number | null
  cloud: number | null
}

export interface ModelCurrentData extends CurrentWeather {
  maxT: number | null
  minT: number | null
}

export interface EnsembleData extends WeatherCondition {
  temp: number | null
  feels: number | null
  rain: number | null
  wind: number | null
  hum: number | null
  pres: number | null
  n: number
  isEns: boolean
  code: number | null
}

export type DisplayData =
  | EnsembleData
  | (ModelCurrentData & WeatherCondition & { isEns: false; modelName: string; n: number })

export interface DailyForecast {
  date: string
  maxT: number | null
  minT: number | null
  rain: number | null
  code: number | null
  cond: WeatherCondition
  n: number
}

export interface CurrentObs {
  temp:      number | null
  feelsLike: number | null
  humidity:  number | null
  windspeed: number | null
  windDir:   number | null
  precip:    number | null
  code:      number | null
  time:      string | null
  stationName: string | null   // city name from wttr.in nearest_area
  stationDist: number | null   // km from searched location
  stationLat:  number | null
  stationLon:  number | null
}

export interface AqiInfo {
  lbl: string
  cls: string
}

export interface MetricConfig {
  key: string
  unit: string
  src: (key: string, i: number) => number | null
  color: string
}

export interface WxStrings {
  clear: string
  mainly: string
  partly: string
  overcast: string
  fog: string
  drizzle: string
  fdrizzle: string
  rain: string
  hrain: string
  frain: string
  snow: string
  hsnow: string
  grains: string
  showers: string
  sshowers: string
  storm: string
  unknown: string
}

export interface AqiStrings {
  good: string
  fair: string
  mod: string
  poor: string
  vpoor: string
  ext: string
}

export interface LangData {
  appSub: string
  searchPh: string
  searchBtn: string
  mbKey: string
  mbKeyLabel: string
  mbKeySave: string
  welcomeTitle: string
  welcomeSub: string
  mbNote: string
  loading: string
  modelView: string
  ensemble: string
  now: string
  today: string
  updated: string
  statRain: string
  statWind: string
  statHum: string
  statPres: string
  statAqi: string
  statModels: string
  statFeels: string
  altLabel: string
  days: string[]
  months: string[]
  mTMax: string
  mTMin: string
  mTemp: string
  mRain: string
  mWind: string
  mHum: string
  mPres: string
  chartTitle: string
  days7: string
  forecastTitle:    string
  forecastByDay:    string
  forecastByHour:   string
  expandForecast:   string
  collapseForecast: string
  modelCol: string
  minLbl: string
  maxLbl: string
  noData: string
  noCode: string
  aqi: AqiStrings
  wx: WxStrings
  statPrecip:   string
  navForecast:  string
  navModels:    string
  navHourly:    string
  alertTitle:   string
  alertSource:  string
  alertExpires: string
  alertDismiss: string
  nModels: (n: number) => string
  ensLabel: (n: number) => string
  vsActual: string
}
