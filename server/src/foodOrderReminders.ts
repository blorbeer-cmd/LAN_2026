import { db } from './db';
import { notifyPlayers } from './push';

export const FOOD_ORDER_PAYMENT_REMINDER_INTERVAL_MS = 60 * 60 * 1000;

interface UnpaidOrderRow {
  orderId: string;
  eventId: string;
  groupId: string;
  title: string;
  playerId: string;
  itemCount: number;
  createdAt: number;
}

interface ReminderGroup {
  playerId: string;
  eventId: string;
  groupId: string;
  orders: UnpaidOrderRow[];
}

function reminderGroups(): ReminderGroup[] {
  const rows = db
    .prepare(
      `SELECT fo.id AS orderId, fo.event_id AS eventId, e.group_id AS groupId,
              fo.title, i.player_id AS playerId, COUNT(i.id) AS itemCount,
              fo.created_at AS createdAt
       FROM food_orders fo
       JOIN events e ON e.id = fo.event_id
       JOIN food_order_items i ON i.order_id = fo.id
       JOIN players p ON p.id = i.player_id
       WHERE i.paid = 0
         AND fo.finalized_at IS NULL
         AND p.deactivated_at IS NULL
       GROUP BY fo.id, fo.event_id, e.group_id, fo.title, i.player_id, fo.created_at
       ORDER BY fo.created_at DESC`,
    )
    .all() as UnpaidOrderRow[];

  const groups = new Map<string, ReminderGroup>();
  for (const row of rows) {
    const key = `${row.groupId}:${row.eventId}:${row.playerId}`;
    const group = groups.get(key);
    if (group) {
      group.orders.push(row);
      continue;
    }
    groups.set(key, {
      playerId: row.playerId,
      eventId: row.eventId,
      groupId: row.groupId,
      orders: [row],
    });
  }
  return [...groups.values()];
}

function reminderTopicKey(playerId: string, eventId: string): string {
  return `food-order-payment-reminder:${playerId}:${eventId}`;
}

function wasSentRecently(group: ReminderGroup, now: number): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM push_log
         WHERE group_id = ? AND event_id = ? AND audience = 'direct'
           AND topic_key = ? AND created_at > ?
         LIMIT 1`,
      )
      .get(
        group.groupId,
        group.eventId,
        reminderTopicKey(group.playerId, group.eventId),
        now - FOOD_ORDER_PAYMENT_REMINDER_INTERVAL_MS,
      ),
  );
}

function reminderBody(orders: UnpaidOrderRow[]): string {
  const itemCount = orders.reduce((sum, order) => sum + order.itemCount, 0);
  const itemLabel = itemCount === 1 ? 'Position' : 'Positionen';
  if (orders.length === 1) {
    return `Du hast in „${orders[0].title}“ noch ${itemCount} unbezahlte ${itemLabel}. Bitte bezahle deinen Anteil.`;
  }
  return `Du hast in ${orders.length} Sammelbestellungen noch ${itemCount} unbezahlte ${itemLabel}. Bitte bezahle deine Anteile.`;
}

/**
 * Sends at most one payment reminder per player and event in a rolling hour.
 * The database log is the durable deduplication source, so a process restart
 * cannot immediately send the same hourly reminder again.
 */
export function runFoodOrderPaymentReminderOnce(now = Date.now()): number {
  let sent = 0;
  for (const group of reminderGroups()) {
    if (wasSentRecently(group, now)) continue;

    const singleOrder = group.orders.length === 1 ? group.orders[0] : null;
    const topicKey = reminderTopicKey(group.playerId, group.eventId);
    const delivery = notifyPlayers(
      [group.playerId],
      {
        title: 'Offene Essenszahlung',
        body: reminderBody(group.orders),
        url: singleOrder ? `/#foodOrders/${singleOrder.orderId}` : '/#foodOrders',
        type: 'food-order-payment',
        targetId: singleOrder?.orderId ?? 'foodOrders',
      },
      'direct',
      { key: topicKey, expiresAt: now + FOOD_ORDER_PAYMENT_REMINDER_INTERVAL_MS },
      { groupId: group.groupId, eventId: group.eventId },
    );
    if (delivery) sent += 1;
  }
  return sent;
}

export function startFoodOrderPaymentReminder(): NodeJS.Timeout {
  const run = () => {
    try {
      runFoodOrderPaymentReminderOnce();
    } catch (error) {
      // A reminder failure must not take down the LAN server. The next hourly
      // run gets another chance, while the error remains visible in logs.
      // eslint-disable-next-line no-console
      console.error('Food-order payment reminder failed:', error);
    }
  };

  run();
  const timer = setInterval(run, FOOD_ORDER_PAYMENT_REMINDER_INTERVAL_MS);
  timer.unref();
  return timer;
}
