import type { ApprovalOption } from "@agent-os/shared";

export interface ApprovalNotice {
  agentName: string;
  context: string;
  proposedAction: string;
  options: ApprovalOption[];
}

/** Render an approval as the multiple-choice message mirrored to Slack/Telegram. */
export function formatApprovalMessage(n: ApprovalNotice): string {
  const opts = n.options.map((o) => `  ${o.key} — ${o.label}`).join("\n");
  return [
    `🔔 *${n.agentName}* needs a decision`,
    "",
    n.context,
    "",
    `*Proposed:* ${n.proposedAction}`,
    "",
    "Reply with an option:",
    opts,
  ].join("\n");
}

/**
 * Mirror an approval to Slack and/or Telegram (Wilkinson answers "1B" from his
 * phone). Transports are env-configured; with none set it logs (dev). Best-effort
 * — never throws into the request path.
 */
export async function sendApprovalNotification(n: ApprovalNotice, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const text = formatApprovalMessage(n);
  const tasks: Promise<unknown>[] = [];

  if (env.SLACK_WEBHOOK_URL) {
    tasks.push(fetch(env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }));
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    tasks.push(
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" }),
      }),
    );
  }
  if (tasks.length === 0) {
    console.log(`[notify] (no transport configured)\n${text}`);
    return;
  }
  await Promise.allSettled(tasks);
}
