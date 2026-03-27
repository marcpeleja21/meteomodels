import { state } from '../state'
import { LANG_DATA } from '../config/i18n'
import type { WeatherAlert, AlertSeverity } from '../api/alerts'

interface SeverityStyle { bg: string; border: string; text: string; icon: string; label: string; pill: string }

function severityStyle(s: AlertSeverity): SeverityStyle {
  const t = LANG_DATA[state.lang]
  switch (s) {
    case 'Extreme':  return { bg:'rgba(90,0,0,0.92)',    border:'#ff1744', text:'#ffcdd2', icon:'🔴', label: t.alertExtreme, pill:'#ff1744' }
    case 'Severe':   return { bg:'rgba(70,25,0,0.92)',   border:'#ff6d00', text:'#ffe0b2', icon:'🟠', label: t.alertSevere,  pill:'#ff6d00' }
    case 'Moderate': return { bg:'rgba(55,42,0,0.92)',   border:'#ffc107', text:'#fff8e1', icon:'🟡', label: t.alertModerate,pill:'#ffc107' }
    default:         return { bg:'rgba(15,26,50,0.92)',  border:'#4fc3f7', text:'#e4f0fb', icon:'ℹ️', label: t.alertInfo,   pill:'#4fc3f7' }
  }
}

/** Pick the most severe alert to show in the top disclaimer bar */
function worstSeverity(alerts: WeatherAlert[]): AlertSeverity {
  if (alerts.some(a => a.severity === 'Extreme'))  return 'Extreme'
  if (alerts.some(a => a.severity === 'Severe'))   return 'Severe'
  if (alerts.some(a => a.severity === 'Moderate')) return 'Moderate'
  return 'Minor'
}

export function renderAlertsBanner(alerts: WeatherAlert[]) {
  const el = document.getElementById('alertsBanner')
  if (!el) return

  const t      = LANG_DATA[state.lang]
  const active = alerts.filter(a => a.severity !== 'Minor' && a.severity !== 'Unknown')

  if (!active.length) {
    el.innerHTML = ''
    el.style.display = 'none'
    return
  }

  el.style.display = 'block'

  const worst = worstSeverity(active)
  const wst   = severityStyle(worst)

  // Compact disclaimer bar (always visible at top) + expandable detail cards below
  el.innerHTML = `
    <div class="alert-disclaimer" style="border-color:${wst.border};background:${wst.bg}">
      <div class="alert-disclaimer-inner">
        <span class="alert-disclaimer-icon">${wst.icon}</span>
        <div class="alert-disclaimer-text">
          <strong style="color:${wst.border}">${wst.label.toUpperCase()}</strong>
          &nbsp;—&nbsp;${t.alertTitle}
          <span class="alert-count-badge" style="background:${wst.pill}">${active.length}</span>
        </div>
        <button class="alert-toggle-btn" aria-expanded="false">
          <span class="alert-toggle-chevron">▾</span>
        </button>
      </div>
    </div>

    <div class="alerts-detail" style="display:none">
      ${active.map(a => {
        const st  = severityStyle(a.severity)
        const exp = a.expires ? new Date(a.expires).toLocaleString() : ''
        return `
          <div class="alert-item" data-id="${a.id}"
               style="--ab:${st.bg};--abr:${st.border};--at:${st.text}">
            <div class="alert-row">
              <span class="alert-icon">${st.icon}</span>
              <div class="alert-body">
                <div class="alert-headline">
                  <span class="alert-badge" style="background:${st.pill}20;color:${st.pill};border-color:${st.pill}60">${st.label}</span>
                  <strong>${a.event}</strong>
                  ${a.headline && a.headline !== a.event ? `· ${a.headline}` : ''}
                </div>
                ${a.areas ? `<div class="alert-areas">📍 ${a.areas}</div>` : ''}
                ${a.description ? `<div class="alert-desc">${a.description}</div>` : ''}
                <div class="alert-meta">
                  <span>📋 ${t.alertSource}: <strong>${a.source}</strong></span>
                  ${exp ? `<span>⏱ ${t.alertExpires}: ${exp}</span>` : ''}
                </div>
              </div>
              <button class="alert-close" title="${t.alertDismiss}">✕</button>
            </div>
          </div>
        `
      }).join('')}
    </div>
  `

  // Toggle expand/collapse detail cards
  const toggleBtn    = el.querySelector<HTMLButtonElement>('.alert-toggle-btn')!
  const detailEl     = el.querySelector<HTMLDivElement>('.alerts-detail')!
  const chevronEl    = el.querySelector<HTMLSpanElement>('.alert-toggle-chevron')!
  const disclaimerEl = el.querySelector<HTMLDivElement>('.alert-disclaimer')!

  toggleBtn.addEventListener('click', () => {
    const open = detailEl.style.display === 'none'
    detailEl.style.display = open ? 'block' : 'none'
    chevronEl.style.transform = open ? 'rotate(180deg)' : ''
    disclaimerEl.style.borderBottomLeftRadius  = open ? '0' : ''
    disclaimerEl.style.borderBottomRightRadius = open ? '0' : ''
    toggleBtn.setAttribute('aria-expanded', String(open))
  })

  // Dismiss individual alert cards
  el.querySelectorAll<HTMLButtonElement>('.alert-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.alert-item') as HTMLElement
      item.style.maxHeight = item.scrollHeight + 'px'
      requestAnimationFrame(() => {
        item.style.transition = 'max-height .35s ease, opacity .3s ease'
        item.style.maxHeight  = '0'
        item.style.opacity    = '0'
        item.style.overflow   = 'hidden'
      })
      setTimeout(() => {
        item.remove()
        if (!el.querySelectorAll('.alert-item').length) {
          el.style.display = 'none'
        }
      }, 380)
    })
  })
}
