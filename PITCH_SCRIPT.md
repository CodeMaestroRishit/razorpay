# 5-Minute Pitch Video Script — RazorSafe (Track 03)

Target length: **5:00**. Words are paced for slow, confident delivery (~130 wpm) — don't rush the case walkthroughs, they're the part that actually proves the architecture.

**Live site:** https://razorpay-frontend-eight.vercel.app/
**Demo merchant:** `Verve Retail Co.` — pick it from the merchant picker on the Dashboard tab. It was renamed specifically so it's the one unmistakable name in that list (everything else is still "Demo Merchant Pvt Ltd" x N or the Razorpay test account) — you should be able to spot and click it without hunting.

**Read this before recording:** every case below is pulled from the live database and belongs to this merchant. Nothing in this app deletes cases, so they'll still be there — open Cases and Ctrl+F for the customer name if the list order isn't what you expect.

---

## The cases you'll show

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

### Case C — recovering in the customer's own language (Sarvam)
Pick any one of these — all three are real, verified Sarvam translations, not templates:
- **Vikram Rao** — Hinglish — case `4ee06f2d…`
- **Priya Patel** — Tamil — case `bbaf7a9d…`
- **Ananya Iyer** (a different case than Case A) — Bengali — case `aae3e5df…`

Each shows the AI's English draft next to Sarvam's actual native-script output, side by side, in the Agent Timeline.

---

## SCRIPT

### [0:00–0:30] Hook — a small story
> "Meet a merchant on Razorpay — call him Rohan. Last month, 340 of his customers' card payments failed. Not because they didn't want what they'd bought — their bank just declined the charge, or a saved card quietly expired, or someone got to the last step of checkout and closed the tab. Every one of those was recoverable money. Nobody on his team caught most of it in time, because nobody was watching in real time. That's not a hypothetical. That's what 'revenue leakage' actually looks like — not a dashboard number, a hundred small moments nobody followed up on."

*(Visual: Landing page hero, let the floating stage chips animate for a second before you talk over them.)*

### [0:30–0:55] The problem with the obvious fix
> "The obvious fix is: point an AI at it. Let it read the failure, decide what to do, and act. But that's also the scary version — a language model deciding, on its own judgment, to retry someone's card or message a customer who told you not to contact them. You don't want autonomy here. You want leverage, with a leash."

### [0:55–1:30] The one-line architecture
> "So here's what I built — I call it RazorSafe. The AI never touches money or a customer's phone. It only ever *proposes* — 'here's what I think happened, here's what I'd do.' That proposal goes through a separate, deterministic guardrail — plain code, fifteen named rules, no model call inside it — and only an approved action is allowed to actually execute. If the guardrail says no, the case goes to a human. The AI is architecturally incapable of acting on its own. That's the name: it's safe by construction, not by hoping the model behaves."

*(Visual: switch to "How it works" tab, show the full pipeline diagram — Detect → Score → Diagnose → Recommend → Guardrail → Execute → Measure → Audit. Point at the Guardrail block specifically — it's colored differently on purpose.)*

### [1:30–1:55] Prove it's not a mockup, live, on camera
*(Visual: click Dashboard → pick "Verve Retail Co." → the "Watch it happen, live" panel is right at the top. Click "Trigger a live case".)*

> "I'm not going to show you a screen recording or a pre-baked JSON blob. Watch this — I'm clicking a button right now that fires a brand-new event into the real pipeline."

*(Let it run on screen, narrate each step as it lights up — you genuinely don't know the outcome in advance: "Detect... now the model's actually being called for root cause, that pause is real inference latency... recommendation's in... and now the guardrail's deciding." Whatever it lands on, say so honestly — this is live, don't script the outcome.)*

> "Real OpenAI call, real guardrail evaluation, real database write — different every time, because it's not a recording."

### [1:55–2:20] What's actually underneath this
> "This runs on a real Postgres database with row-level security, so one merchant's rows are physically unreachable by another merchant's queries — not filtered in application code, enforced by the database itself. Every webhook — including real signed Razorpay webhooks, HMAC-verified — writes an idempotency key before anything executes, so a duplicated delivery can't double-charge or double-message anyone. And a sweeper job resumes cases on their own retry schedule, so a case that isn't resolved doesn't just die — it comes back through this same loop until it's recovered or closed."

*(Visual: point at the funnel numbers — revenue at risk, recovered amount, recovery rate, and the treated-vs-holdout split.)*

> "This holdout number matters more than it looks — a slice of cases get *no* AI help at all, on purpose, so the recovery rate you're seeing is measured against a real baseline, not asserted."

### [2:20–2:55] Case A — the AI gets to act
*(Visual: Cases tab, find Ananya Iyer / ₹1,416.88, click the row to open the Agent Timeline drawer.)*

> "Here's one from earlier — a payment that failed on a bank decline. The AI reads the failure code, decides a simple retry usually fixes this — ninety-three percent confidence — and proposes `retry_payment`. It goes to the guardrail: nothing's blocking it, this customer hasn't opted out, no retry's been tried yet, it's within policy. Approved. Executed. Recovered. No human in the loop — because this one didn't need one."

### [2:55–3:30] Case B — the AI gets overruled
*(Visual: back to Cases, find Aarav Sharma / ₹2,106.33, open its timeline.)*

> "Now this one. Same failure family — insufficient funds. The AI proposes the exact same action, `retry_payment`, ninety-four percent confidence. But the guardrail rejects it. Not because the diagnosis was wrong — it wasn't. It's rejected because this specific customer opted out of contact, and that rule is absolute: no action touching this customer executes, period, regardless of what the model thinks is a good idea. Escalated to a human instead."

### [3:30–3:55] Why that human step is the point, not a gap
> "This is deliberate. A model can be persuaded, prompted, or confidently wrong. A rule like 'do not contact this person' can't be talked out of itself — it's code, not a suggestion the AI is weighing. The moment a case needs judgment a rule can't encode, that's exactly when you want a person deciding, not a model that will act anyway. The guardrail's job isn't to make the AI smarter — it's to know exactly where the AI's judgment should stop mattering."

### [3:55–4:30] It recovers revenue in the customer's own language
*(Visual: open Case C — any of Vikram Rao / Hinglish, Priya Patel / Tamil, or Ananya Iyer / Bengali. Scroll to the "Executed" step in the Agent Timeline.)*

> "One more thing this does, and I want to show it rather than claim it. The AI always drafts its message in English first — that keeps reasoning consistent and auditable. But look what actually gets sent."

*(Point at the highlighted block — the English draft, and right below it, Sarvam's real output in native script.)*

> "That's a live call to Sarvam, not a template — this customer reads Tamil, so that's what they get, code-mixed naturally instead of stiff textbook translation. Swap the customer and you get Hindi, Bengali, Hinglish, whatever they actually speak. A merchant recovering revenue in Chennai and one in Kolkata each get dunned in the language their customer reads — not a single English default because that's easier to build."

### [4:30–4:50] Everything else, fast
> "A few more things under the hood: every retry is idempotent end to end, real signed Razorpay webhooks are supported alongside the synthetic ones you just watched, and the guardrail file — the one thing standing between a proposal and a real action — has forty-four tests pinned against it."

*(Visual: quick scroll of the How it works page — the guardrail rule table, the closing stat band.)*

### [4:50–5:00] Close
> "Detect, diagnose, propose, and — only when it's actually safe — act, in whatever language the customer speaks. Everything in between is logged, auditable, and provably tested. That's RazorSafe."

*(Visual: end on the landing page hero line — "Recover. Never unsupervised.")*

---

## Delivery notes
- The two-case comparison (2:20–3:30) is the part judges will remember most — don't speed through it. If you're short on time elsewhere, trim "Everything else, fast" (4:30–4:50) first, not this or the Sarvam beat.
- The live-trigger moment (1:30–1:55) is genuinely live — you don't control the outcome. If it lands on an approved retry instead of an escalation, that's fine, don't fake disappointment or re-record; narrate what actually happened and let Case A/B right after carry the specific contrast.
- The live trigger takes a few real seconds (two model calls back to back) — don't panic-narrate over the pause, the silence while "Diagnose (AI)" is spinning *is* the proof it's real. Let it breathe.
- Say the guardrail rule name out loud (`customer_opt_out`) when you're on Case B — it's on screen in the rejection badge, and hearing the specific rule land makes the "not a vibe, an actual rule" point land harder.
- For the Sarvam beat (3:55–4:30), read the native-script text out loud if you can pronounce it, even roughly — actually voicing it lands harder than pointing at it silently. If you can't, it's fine to just say "that's genuine Tamil, not a placeholder" while pointing.
- If a judge asks "why not just let the AI retry anyway, it's just a payment retry" — the rule isn't about payment risk, it's about consent. An opted-out customer getting *any* automated touch, even a "harmless" one, is the exact failure mode the guardrail exists to prevent.
