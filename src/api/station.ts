export interface CurrentObs {
  temp:      number | null
  feelsLike: number | null
  humidity:  number | null
  windspeed: number | null
  windDir:   number | null
  precip:    number | null
  code:      number | null
  time:      string | null
}

export async function fetchCurrentObs(lat: number, lon: number): Promise<CurrentObs | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weathercode,` +
      `windspeed_10m,winddirection_10m,precipitation` +
      `&wind_speed_unit=kmh&timezone=auto`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    const c = json.current
    if (!c) return null
    return {
      temp:      c.temperature_2m       ?? null,
      feelsLike: c.apparent_temperature ?? null,
      humidity:  c.relative_humidity_2m ?? null,
      windspeed: c.windspeed_10m        ?? null,
      windDir:   c.winddirection_10m    ?? null,
      precip:    c.precipitation        ?? null,
      code:      c.weathercode          ?? null,
      time:      c.time                 ?? null,
    }
  } catch {
    return null
  }
}
