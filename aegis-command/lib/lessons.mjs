import { randomUUID } from 'node:crypto';
import { member, requireThat } from './access.mjs';
import { text, choice, time, list, revision, revise } from './model.mjs';
export function lessonCommand(data, state, c, user) {
  const item = c.kind === 'lesson-update' ? state.lessons.find(l => l.id === c.entityId) : null;
  requireThat(c.kind === 'lesson-create' || item, 'Lesson not found in this incident.', 404);
  if (item) revision(item, c.revision);
  const owner = data.users.find(u => u.id === (c.ownerId || item?.ownerId) && u.status === 'active' && ['commander', 'responder'].includes(member(u, state.id)));
  requireThat(owner, 'Select an active incident member to own the improvement.');
  const v = { ...item, ...c }, status = choice(v.status || 'Open', ['Open', 'In progress', 'Complete', 'Accepted risk'], 'lesson status');
  const action = item?.actionTaskId ? state.tasks.find(t => t.id === item.actionTaskId) : null;
  requireThat(item || c.actionRequired === false || !['Complete', 'Accepted risk'].includes(status), 'Create the improvement action before completing or accepting its risk.');
  if (status === 'Accepted risk') requireThat(member(user, state.id) === 'commander', 'A commander must accept the residual risk.', 403);
  if (status === 'Complete' && action) requireThat(action.status === 'Complete', 'Complete the linked action task before closing this lesson.');
  const values = { title: text(v.title, 'Lesson title', { required: true, max: 200 }), category: choice(v.category || 'Process', ['Process', 'Technology', 'People', 'Communication'], 'lesson category'), observation: text(v.observation, 'What happened', { required: true }), impact: text(v.impact, 'What worked / impact', { required: true }), recommendation: text(v.recommendation, 'Improvement recommendation', { required: true }), ownerId: owner.id, owner: owner.name, status, evidenceRefs: list(v.evidenceRefs || [], 'Lesson references'), disposition: text(v.disposition, 'Risk/no-action disposition', { required: status === 'Accepted risk', max: 2000 }) };
  let actionTaskId = item?.actionTaskId || null;
  if (!item && c.actionRequired !== false) {
    const dueAt = time(c.actionDueAt, 'Improvement action due time', { required: true }); actionTaskId = randomUUID();
    state.tasks.push({ id: actionTaskId, lessonId: null, title: text(c.actionTitle || values.title, 'Improvement action title', { required: true, max: 200 }), description: values.recommendation, ownerId: owner.id, owner: owner.name, dueAt, priority: 'High', status: 'Open', done: false, scopeId: null, completionEvidence: '', disposition: '', revision: 1, history: [], createdAt: new Date().toISOString(), createdBy: user.id });
  } else if (!item && !actionTaskId) requireThat(values.disposition, 'Explain why this lesson needs no follow-up action.');
  if (item) {
    const reason = text(c.body, 'Lesson change rationale', { required: true });
    requireThat(owner.id === item.ownerId || member(user, state.id) === 'commander', 'Only a commander can reassign this improvement.', 403);
    if (action && owner.id !== action.ownerId && !action.done) revise(action, { ownerId: owner.id, owner: owner.name }, user, reason);
    if (action && status === 'Accepted risk' && !action.done) revise(action, { status: 'Cancelled', done: true, disposition: values.disposition }, user, reason);
    revise(item, values, user, reason);
  } else {
    const lesson = { ...values, id: randomUUID(), actionTaskId, revision: 1, history: [], createdAt: new Date().toISOString(), createdBy: user.id };
    if (actionTaskId) state.tasks.find(t => t.id === actionTaskId).lessonId = lesson.id;
    state.lessons.push(lesson);
  }
  return { title: item ? 'Lesson learned updated' : 'Lesson learned recorded', detail: values.title + ' · ' + status };
}
