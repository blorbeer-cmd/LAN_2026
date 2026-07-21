// Runs the Arcade scenarios declared in flows.e2e.test.ts in an independent
// Node test process. Setting the partition before requiring the module gives
// it a separate server/database/browser fixture and lets it execute in
// parallel with the remaining cross-view flows.

process.env.E2E_FLOW_PARTITION = 'arcade';
require('./flows.e2e.test');
