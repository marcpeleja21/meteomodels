import { state } from '../state'
import { LANG_DATA } from '../config/i18n'
import type { WeatherAlert, AlertSeverity } from '../api/alerts'

interface SeverityStyle { bg: string; border: string; text: string; icon: string; label: string }

function severityStyle(s: AlertSeverity): SeverityStyle {
  switch (s) {
    case 'Extreme':  return { bg:'rgba(90,0,0,0.85)',  border:'#ff1744', text:'#ffcdd2', icon:'🔴', label:'Extrem'   }
    case 'Severe':   return { bg:'rgba(70,25,0,0.85)', border:'#ff6d00', text:'#ffe0b2', icon:'🟠', label:'Sever'    }
    case 'Moderate': return { bg:'rgba(55,42,0,0.85)', border:'#ffc107', text:'#fff8e1', icon:'🟡', label:'Moderat'  }
    default:         return { bg:'rgba(15,26,50,0.85)',border:'#4fc3f7', text:'#e4f0fb', icon:'ℹ️', label:'Avís'     }
  }
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

  el.innerHTML = `
    <div class="alerts-wrap">
      <div class="alerts-title">
        ⚠️ ${t.alertTitle}
      </div>
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
                  <span class="alert-badge">${st.label}</span>
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

  // Dismiss handlers
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
