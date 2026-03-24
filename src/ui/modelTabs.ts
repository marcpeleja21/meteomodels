import type { WeatherModel, LangData, OpenMeteoResponse } from '../types'
import { state } from '../state'

export function renderModelTabs(
  models: WeatherModel[],
  wxData: Record<string, OpenMeteoResponse | null>,
  t: LangData,
  onSelect: (key: string) => void
) {
  const wrap = document.getElementById('modelTabs')!
  const label = wrap.previousElementSibling as HTMLElement
  if (label) label.textContent = t.modelView

  const loaded = models.filter(m => wxData[m.key] != null)
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
