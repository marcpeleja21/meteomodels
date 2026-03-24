import type { GeocodingResult, LangData } from '../types'

export function renderLocBar(loc: GeocodingResult, t: LangData) {
  const el = document.getElementById('locBar')!
  const parts = [loc.admin1, loc.country].filter(Boolean).join(', ')
  const alt = loc.elevation !== undefined ? `${Math.round(loc.elevation)} m ${t.altLabel}` : ''

  const now = new Date()
  const hh  = String(now.getHours()).padStart(2, '0')
  const mm  = String(now.getMinutes()).padStart(2, '0')
  const day = t.days[now.getDay()]
  const mon = t.months[now.getMonth()]
  const dateStr = `${day} ${now.getDate()} ${mon} · ${hh}:${mm}`

  el.innerHTML = `
    <div>
      <div class="loc-name">${loc.name}${alt ? ` <small style="font-size:.85rem;font-weight:400;color:var(--text-muted);margin-left:8px">${alt}</small>` : ''}</div>
      <div class="loc-sub">${parts}</div>
      <div class="loc-time">${t.updated}: ${dateStr}</div>
    </div>
  `
}
