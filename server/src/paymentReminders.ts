// One shared cadence for every reminder about an open payment. Keeping the
// policy in one place prevents event contributions and food orders from
// drifting apart again.
export const PAYMENT_REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000;
