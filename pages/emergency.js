// Emergency: no test, straight to "Call 911". Records the time and (simulated) alerts family.
import { addEmergency, addAlert } from '../store.js';
import { renderRed } from './redscreen.js';

export function render(el) {
  const em = addEmergency(new Date().toISOString()); // symptomNoticedAt defaults to now
  addAlert('emergency', 'Pressed "Feeling something wrong right now?"');
  return renderRed(el, {
    title: 'Call 911 now',
    lead: 'If you think something is wrong — even if it seems to be getting better — call 911. Don\'t wait for this app or a check.',
    emergencyAt: em.at,
  });
}
