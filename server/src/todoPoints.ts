import { db } from './db';
import type { AutomaticAward } from './automaticPoints';

export const TODO_POINTS = 3;

interface TodoHelper {
  id: string;
  batch_id: string | null;
  title: string;
  status: string;
  points_value: number;
  player_id: string;
}

// Direct assignments are stored as separate rows but displayed as one task.
// A shared batch therefore has one entitlement, just like a multi-helper task.
export function todoSourceKey(task: { id: string; batch_id: string | null }): string {
  return task.batch_id ? `todo:batch:${task.batch_id}` : `todo:${task.id}`;
}

export function todoAwards(groupId: string, eventId: string): AutomaticAward[] {
  const helpers = db.prepare(`SELECT t.id,t.batch_id,t.title,t.status,t.points_value,a.player_id
    FROM checklist_tasks t JOIN checklist_task_assignees a ON a.task_id = t.id
    WHERE t.group_id = ? AND t.event_id = ? AND t.type = 'todo'
      AND t.points_model = 'category' AND t.status IN ('taken','done') AND a.player_id != t.created_by
    ORDER BY a.joined_at,a.rowid`).all(groupId, eventId) as TodoHelper[];
  const first = new Map<string, TodoHelper>();
  for (const helper of helpers) {
    const key = todoSourceKey(helper);
    if (!first.has(key)) first.set(key, helper);
  }
  return [...first].flatMap(([sourceKey, helper]) => helper.status === 'done' ? [{
    playerId: helper.player_id, sourceKey, amount: TODO_POINTS,
    title: `Aufgabe erledigt: ${helper.title}`,
  }] : []);
}
