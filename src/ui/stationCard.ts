import type { CurrentObs } from '../api/station'

/** Station data is now rendered inside mainCard as a side-by-side comparison.
 *  This function hides the legacy stationCard element so the DOM stays clean. */
export function renderStationCard(_obs: CurrentObs | null) {
  const el = document.getElementById('stationCard')
  if (el) el.style.display = 'none'
}
