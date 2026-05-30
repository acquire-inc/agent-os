// scripts/seed/_doctrine.test.ts
// Unit test for the doctrine trigger parser — locks the cron output for the real
// trigger strings that appear in the doctrine, so "build it better" stays built.
// Run: tsx _doctrine.test.ts

import { parseTriggers } from "./_doctrine.js";

let pass = 0, fail = 0;
function check(name: string, raw: string, wantFirst: string) {
  const { triggers } = parseTriggers(raw, "x");
  const got = triggers[0]?.type === "cron" ? triggers[0].schedule : `${triggers[0]?.type}(${(triggers[0] as { eventKey?: string }).eventKey ?? ""})`;
  if (got === wantFirst) { pass++; }
  else { fail++; console.log(`  ✗ ${name}: "${raw}"\n      want ${wantFirst}  got ${got}`); }
}

// Daily / time.
check("daily HH:MM", "Daily 07:00 + on-demand", "0 7 * * *");
check("every morning", "Daily 06:30", "30 6 * * *");
check("every night", "Every night (23:30)", "30 23 * * *");
check("every 15 min", "Every 15 minutes", "*/15 * * * *");
check("hourly", "Hourly + event", "0 * * * *");
// Weekly with parens + day + time.
check("weekly paren day time", "Weekly (Saturday 07:00)", "0 7 * * 6");
check("weekly friday time", "Weekly Friday 16:00", "0 16 * * 5");
// Monthly with day + time in parens.
check("monthly day time", "Monthly (1st, 08:00)", "0 8 1 * *");
check("monthly day-of-month words", "Monthly (1st of month, 06:00)", "0 6 1 * *");
check("monthly bare", "Monthly", "0 9 1 * *");
// Quarterly.
check("quarterly", "Quarterly (last week) + on-demand", "0 9 1 1,4,7,10 *");
// Events / webhooks / on-demand.
check("webhook", "Webhook on form submission", "webhook(form.submission)");
check("event-with-webhook→webhook", "Event (payment failure webhook)", "webhook(payment.failure.webhook)");
check("event-no-webhook→state", "Event (Close opp non-standard price)", "state(close.opp.non.standard.price)");
check("on-demand", "On-demand", "on_demand()");
check("spawned", "Spawned by `offer-architect` at the end of each draft run", "state(spawned.by.offer.architect.at.the.end.of.each.dr)");

// Multi-trigger count.
const multi = parseTriggers("Daily 07:00 + on-demand", "x").triggers;
if (multi.length === 2) pass++; else { fail++; console.log(`  ✗ multi-trigger count: got ${multi.length}`); }

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
