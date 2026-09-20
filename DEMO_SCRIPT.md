# Kepler — 3-minute demo script

Run: `KEPLER_DEMO=1 agent/.venv/bin/uvicorn agent.main:app --port 8787` + `npm run dev`, open http://localhost:3000.

1. **0:00–0:20 — Problem.** "AWS tells you what changed, not whether it's dangerous, and never what a fix would do — without testing in prod." Show the Kepler workspace, header reads *0 cloud writes*.
2. **0:20–0:45 — Connect.** In chat, paste a read-only role ARN + region (or `demo`). Kepler replies it will fork the account read-only. Left panel starts a live trace: `emfirge_scan`, `emfirge_attack_paths`…
3. **0:45–1:30 — Investigate (all real).** Left zones fill: **9 critical findings**; the **attack path** `NAME_132 → INTERNET → NAME_140 → IAM_ROLE_007 → NAME_165`; **crown jewels** (IAM role, 6 findings, blast radius 5); **CIS 5/29 pass**. Point out this is your real graph, read-only.
4. **1:30–2:15 — Branch the fix.** Kepler creates branch `seal-ssh-sg`, applies "restrict SSH to a trusted CIDR", re-computes. **before → after**: critical `EMFIRGE-EC2-002` removed, `NAME_140` & `NAME_132` no longer internet-reachable, verdict `warn` (honest: other criticals remain). Nothing touched prod.
5. **2:15–2:45 — Human decision.** Kepler asks one question with buttons. Click **Approve** → "Recorded. 0 cloud writes." Emphasize: the agent did the judgment, the human made the call.
6. **2:45–3:00 — AWS + wrap.** Callout: reasoning on **Amazon Bedrock**, account read via **STS AssumeRole (read-only)**, Emfirge disclosed as reused engine. "Kepler shows you the future of a change before it's real."
