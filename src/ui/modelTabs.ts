import type { WeatherModel, LangData, OpenMeteoResponse } from '../types'
import { state } from '../state'
import { modelValidForDay } from '../config/models'

export function renderModelTabs(
  models: WeatherModel[],
  wxData: Record<string, OpenMeteoResponse | null>,
  t: LangData,
  onSelect: (key: string) => void
) {
  const wrap = document.getElementById('modelTabs')!
  const label = wrap.previousElementSibling as HTMLElement
  if (label) label.textContent = t.modelView

  const dayI  = state.selectedDay
  const loaded = models.filter(m => wxData[m.key] != null && modelValidForDay(m, dayI))

  // If the currently active model is no longer valid (e.g. AROME selected, then day 2+ clicked),
  // quietly fall back to ensemble without re-rendering (caller will handle it)
  if (state.activeModel !== 'ensemble' && !loaded.find(m => m.key === state.activeModel)) {
    state.activeModel = 'ensemble'
  }
  const tabs: Array<{ key: string; label: string; color?: string }> = [
    { key: 'ensemble', label: t.ensemble },
    ...loaded.map(m => ({ key: m.key, label: `${m.flag} ${m.name}`, color: m.color })),
  ]

  wrap.innerHTML = tabs.map(tab => {
    const active = tab.key === state.activeModel ? ' active' : ''
    const style  = tab.color && tab.key === state.activeModel
      ? ` style="background:${tab.color}22;border-color:${tab.color};color:${tab.color}"`
      : ''
    return `<button class="mtab${active}" data-key="${tab.key}"${style}>${tab.label}</button>`
  }).join('')

  wrap.querySelectorAll<HTMLButtonElement>('.mtab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeModel = btn.dataset.key!
      onSelect(state.activeModel)
    })
  })
}
