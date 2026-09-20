# Kepler — Hackathon writeup

**Problem.** Cloud teams get told *what* changed (CloudTrail/Config) but not whether it's dangerous or what a fix would actually do. Testing changes safely means testing in production or drowning in alert noise.

**What we built.** Kepler, an autonomous branch-native cloud agent. It connects read-only to AWS, forks the live infrastructure graph into an isolated branch, applies a proposed fix, and shows the real consequences (findings, attack paths, compliance, before→after, blast radius) before anything is real. It only asks a human for the actual decision. 0 cloud writes.

**Why it matters.** It turns "an alert fired" into "here is the exact attack path, here is the one fix, here is proof it closes the path, approve?" — the judgment an on-call engineer does manually, done autonomously and safely.

**How AWS is used.** Amazon Bedrock (`openai.gpt-oss-120b`, ap-south-1) is the agent's brain via Strands. AWS STS AssumeRole gives read-only access to the account. The subject is the user's AWS estate (EC2/SG, RDS, S3, IAM, Lambda, …). Demo mode makes zero AWS calls for reproducibility.

**Originality & credits.** The cloud-branching engine (Emfirge, by the same author) is reused via `@emfirge/mcp` and disclosed. The new work is the autonomous agent loop, Bedrock+Strands+MCP integration, the streaming event pipeline, the Kepler workspace UI, and the human decision workflow.
