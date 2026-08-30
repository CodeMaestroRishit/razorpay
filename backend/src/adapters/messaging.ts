/**
 * Messaging send is always a logged no-op for the hackathon build (§17
 * Phase 4, §19 "no live phone call infrastructure"). Swap the body of
 * `send()` for a real SMS/email/WhatsApp provider call when ready — the
 * executor and guardrail engine don't need to change, since this is the
 * only place a message actually leaves the system.
 */
export interface MessagingAdapter {
  send(params: { channel: string; to: string; text: string }): Promise<{ sent: boolean; providerRef: string }>;
}

export class LoggedNoOpMessagingAdapter implements MessagingAdapter {
  async send(params: { channel: string; to: string; text: string }) {
    console.log(`[messaging:noop] ${params.channel} -> ${params.to}: ${params.text}`);
    return { sent: true, providerRef: `noop_${Date.now()}` };
  }
}

export function createMessagingAdapter(): MessagingAdapter {
  return new LoggedNoOpMessagingAdapter();
}
