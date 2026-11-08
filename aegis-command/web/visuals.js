import { esc } from './forms.js';

const paths = {
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
  scope: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  decision: '<path d="M12 3v7m0 0-6 6m6-6 6 6M3 16h6v5H3zm12 0h6v5h-6z"/>',
  record: '<path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h7m-7 4h7"/>',
  message: '<path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8m-8 4h5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
};
export const icon = name => `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.record}</svg>`;
export const brief = (text, length = 125) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return esc(clean.length > length ? clean.slice(0, length).replace(/\s+\S*$/, '') + '…' : clean);
};
export const avatar = name => `<span class="avatar" aria-hidden="true">${esc(String(name || '?').trim().split(/\s+/).map(n => n[0]).slice(0, 2).join(''))}</span>`;
export function tone(value) {
  if (['Critical', 'Locked', 'Unavailable', 'Confirmed alteration', 'Confirmed exposure', 'Confirmed', 'Rejected', 'Overdue'].includes(value)) return 'red';
  if (['High', 'Blocked', 'Degraded', 'Pending', 'Unknown', 'Suspected alteration', 'Suspected exposure', 'Suspected', 'Quarantined', 'Hypothesis'].includes(value)) return 'amber';
  if (['Complete', 'Validated', 'Accessible', 'Verified against baseline', 'Approved', 'Confirmed fact', 'Contained', 'Approved for controlled download'].includes(value)) return 'green';
  if (['In progress', 'Recovering'].includes(value)) return 'blue';
  return '';
}
export function section(title, body, kicker = '', symbol = 'record', emphasis = '') {
  return `<section class="panel ${emphasis}"><header class="panel-heading"><div>${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<h2>${esc(title)}</h2></div><span class="panel-symbol">${icon(symbol)}</span></header>${body}</section>`;
}
export function dueLabel(date) {
  if (!date) return 'No deadline';
  const due = new Date(date), today = new Date().toISOString().slice(0, 10), day = due.toISOString().slice(0, 10);
  return day === today ? 'Today · ' + new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(due) + ' UTC' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: due.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : 'numeric', timeZone: 'UTC' }).format(due);
}
