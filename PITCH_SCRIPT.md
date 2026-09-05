# 5-Minute Pitch Video Script — RazorSafe (Track 03)

Target length: **5:00**. Words are paced for slow, confident delivery (~130 wpm) — don't rush the two live-case walkthroughs, they're the part that actually proves the architecture.

**Live site:** https://razorpay-frontend-eight.vercel.app/
**Demo merchant:** `Verve Retail Co.` — pick it from the merchant picker on the Dashboard tab. It was renamed specifically so it's the one unmistakable name in that list (everything else is still "Demo Merchant Pvt Ltd" x N or the Razorpay test account) — you should be able to spot and click it without hunting.

**Read this before recording:** the two cases below are pulled from the live database and both belong to this merchant. Nothing in this app deletes cases, so they'll still be there — open Cases and Ctrl+F for the customer name if the list order isn't what you expect.

---

## The two cases you'll show (the whole "why human matters" argument rests on these)

### Case A — Auto-recovered, no human touched it
- Customer: **Ananya Iyer**, amount **₹1,416.88**
- Failure reason (AI diagnosis): `bank_decline`, 98% confidence
- AI recommendation: `retry_payment`, 93% confidence
- Guardrail: **approved**
- Result: retried automatically, **succeeded**, state = `recovered`

### Case B — Escalated to a human, same AI recommendation
- Customer: **Aarav Sharma**, amount **₹2,106.33**
- Failure reason (AI diagnosis): `insufficient_funds`, 99% confidence
- AI recommendation: `retry_payment`, 94% confidence — **the exact same action type as Case A**
- Guardrail: **rejected** — rule `customer_opt_out`: *"customer has opted out of contact — 'retry_payment' is not permitted"*
- Result: escalated to a human, nothing was retried, nothing was sent

This pair is the whole pitch in miniature: the AI proposed the same thing twice. Only one of them ran. A rule the AI has no power to override made that call, not a second opinion from the model.

---

## SCRIPT

### [0:00–0:25] Hook
> "Every month, businesses on Razorpay lose revenue that was never actually lost for good — a card gets declined, a checkout gets abandoned, an invoice goes quiet. The money's recoverable. Somebody just has to notice, and act, fast enough. Most teams don't have that somebody. So the revenue just... leaks."

*(Visual: Landing page hero, let the floating stage chips animate for a second before you talk over them.)*

### [0:25–0:55] The problem with the obvious fix
> "The obvious fix is: point an AI at it. Let it read the failure, decide what to do, and act. But that's also the scary version — a language model deciding, on its own judgment, to retry someone's card or message a customer who told you not to contact them. You don't want autonomy here. You want leverage, with a leash."

### [0:55–1:35] The one-line architecture
> "So here's what I built — I call it RazorSafe. The AI never touches money or a customer's phone. It only ever *proposes* — 'here's what I think happened, here's what I'd do.' That proposal goes through a separate, deterministic guardrail — plain code, fifteen named rules, no model call inside it — and only an approved action is allowed to actually execute. If the guardrail says no, the case goes to a human. The AI is architecturally incapable of acting on its own. That's the name: it's Razorpay's recovery layer, and the whole point is that it's safe by construction, not by hoping the model behaves."

*(Visual: switch to "How it works" tab, show the full pipeline diagram — Detect → Score → Diagnose → Recommend → Guardrail → Execute → Measure → Audit. Point at the Guardrail block specifically — it's colored differently on purpose.)*

### [1:35–2:00] Prove it's not a mockup, live, on camera
*(Visual: click Dashboard → pick "Verve Retail Co." → the "Watch it happen, live" panel is right at the top. Click "Trigger a live case".)*

> "I'm not going to show you a screen recording or a pre-baked JSON blob. Watch this — I'm clicking a button right now that fires a brand-new event into the real pipeline."

*(Let it run on screen, narrate each step as it lights up — you genuinely don't know the outcome in advance, which is the point: "Detect... now the model's actually being called for root cause, that pause is real inference latency, not a fake spinner... recommendation's in... and now the guardrail's deciding." Whatever it lands on — approved-and-executed or escalated — say so honestly. This is live, so don't script the outcome; just narrate what actually happens.)*

> "That's a real OpenAI call, a real guardrail evaluation, a real database write — every time I hit that button it's a different case, because it's not a demo recording, it's the actual system."

### [2:00–2:20] Into the dashboard
> "This dashboard is wired to a real Postgres database with row-level security, so one merchant's data is physically unreachable by another's queries. Every retry carries an idempotency key so a duplicated webhook can't double-charge anyone. And a sweeper job resumes cases on their own schedule, so nothing just fires once and gets forgotten."

*(Visual: point at the funnel numbers — revenue at risk, recovered amount, recovery rate, and the treated-vs-holdout split.)*

> "This holdout number matters more than it looks — a slice of cases get *no* AI help at all, on purpose, so the recovery rate you're seeing is measured against a real baseline, not asserted."

### [2:20–3:05] Case A — the AI gets to act
*(Visual: Cases tab, find Ananya Iyer / ₹1,416.88, click the row to open the Agent Timeline drawer. These next two are pre-existing cases, not the live one you just triggered — kept because their outcomes are known and make the exact contrast you want.)*

> "Here's one from earlier — a payment that failed on a bank decline. The AI reads the failure code, decides it's the kind of thing a simple retry usually fixes — ninety-three percent confidence — and proposes `retry_payment`. It goes to the guardrail: nothing's blocking it, this customer hasn't opted out, no retry's been tried yet, it's within policy. Approved. Executed. Recovered. No human in the loop — because this one didn't need one."

### [3:05–3:50] Case B — the AI gets overruled
*(Visual: back to Cases, find Aarav Sharma / ₹2,106.33, open its timeline.)*

> "Now this one. Same failure family — insufficient funds this time. The AI reasons through it the exact same way, and proposes the exact same action: `retry_payment`, ninety-four percent confidence. But the guardrail rejects it. Not because the AI was wrong about the diagnosis — it wasn't. It's rejected because this specific customer opted out of contact, and the rule is absolute: no action that touches this customer executes, period, regardless of what the model thinks is a good idea. The case gets escalated to a human instead."

### [3:50–4:15] Why that human step is the point, not a gap
> "This is deliberate, not a limitation I haven't gotten around to fixing. A model can be persuaded, prompted, or just wrong in a way that sounds confident. A compliance rule like 'do not contact this person' can't be talked out of itself — it's code, not a suggestion the AI is weighing. And the moment a case needs judgment the rule can't encode — is this actually fraud, does this customer need a different channel, is there a relationship here worth handling by hand — that's exactly when you want a person deciding, not a model that will confidently act anyway. The guardrail's job isn't to make the AI smarter. It's to know exactly where the AI's judgment should stop mattering."

### [4:15–4:50] Everything else, fast
> "A few more things happening under the hood: this recovers in whatever language the customer actually speaks — not just English or Hinglish, Sarvam covers most Indian languages, so outreach doesn't default to English by accident. Every retry is idempotent, so a duplicated webhook can't double-charge anyone. And this whole guardrail file — the one thing standing between a proposal and a real action — has forty-four tests pinned against it."

*(Visual: quick scroll of the How it works page — the guardrail rule table, the closing stat band.)*

### [4:50–5:00] Close
> "Detect, diagnose, propose, and — only when it's actually safe — act. Everything in between is logged, auditable, and provably tested. That's RazorSafe."

*(Visual: end on the landing page hero line — "Recover. Never unsupervised.")*

---

## Delivery notes
- The two-case comparison (2:20–3:50) is the part judges will remember — don't speed through it. If you're short on time elsewhere, cut from "Everything else, fast" (4:15–4:50), not this one.
- The live-trigger moment (1:35–2:00) is genuinely live — you don't control the outcome. If it happens to land on an approved retry instead of an escalation, that's fine, don't fake disappointment or re-record; just narrate what actually happened and let the two curated cases right after carry the specific contrast.
- The live trigger takes a few real seconds (two model calls back to back) — don't panic-narrate over the pause, the silence while "Diagnose (AI)" is spinning *is* the proof it's real. Let it breathe.
- Say the guardrail rule name out loud (`customer_opt_out`) when you're on Case B — it's on screen in the rejection badge, and hearing the specific rule land makes the "not a vibe, an actual rule" point land harder.
- If a judge asks "why not just let the AI retry anyway, it's just a payment retry" — the answer is in the script already: the rule isn't about payment risk, it's about consent. An opted-out customer getting *any* automated touch, even a "harmless" one, is the exact failure mode the guardrail exists to prevent.
