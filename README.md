# Kepler

**Kepler branches your cloud, tries the change, and shows you the future before it's real.**

Kepler is an autonomous, branch-native cloud agent. It connects to your AWS account **read-only**, forks your live infrastructure into an isolated branch, applies a proposed fix on that branch, and measures the consequences — findings, attack paths, compliance, blast radius — **before anything touches production**. It only interrupts a human when there's a real decision to make. **0 cloud writes, always.**

Named after Johannes Kepler, who computed where a planet would be before anyone looked.

> Built for the WeMakeDevs AWS "First Commit" hackathon — [https://www.wemakedevs.org/aws/first-commit](https://www.wemakedevs.org/aws/first-commit)

## The problem

AWS tells you *what* changed (CloudTrail, Config) but drowns you in alerts and never tells you whether a change is actually dangerous or what a fix would do. Engineers either ignore the noise or test risky changes in production.

## What Kepler does

1. Connects to your AWS account through a **read-only** IAM role.
2. Scans it and builds a graph of your infrastructure.
3. Traces real **attack paths** (internet → security group → EC2 → IAM role → database) and finds the crown-jewel resources.
4. Forks the graph into an **isolated branch**, applies a proposed fix (e.g. seal SSH open to 0.0.0.0/0), and re-computes the consequences.
5. Shows a **before → after**: which critical findings disappear, which resources are no longer internet-reachable, and the new verdict.
6. Asks the human one question — **Approve / Keep as-is / Review diff** — and records the decision. Nothing is ever written to your cloud.

## How AWS is used

- **Amazon Bedrock** — the agent's reasoning model (`openai.gpt-oss-120b-1:0`, region `ap-south-1`) drives every step via the Strands Agents SDK.
- **AWS STS AssumeRole** — the Emfirge backend assumes your **read-only** role (SecurityAudit-style, ExternalId `aws-risk-agent`) to read the account. No write permissions are ever requested.
- **Your AWS account** is the subject: EC2 & security groups, RDS, S3, IAM, Lambda, ECS, VPC, CloudTrail, etc. are read and modeled.
- **Free tier friendly**: Bedrock is pay-per-token (cents per run); the read-only role costs nothing; a built-in demo mode makes zero AWS calls.

## Architecture

Browser (Kepler UI) → Next.js API relay (SSE) → Python agent (FastAPI + Strands) → Amazon Bedrock for reasoning + Emfirge MCP (stdio) → Emfirge backend → your AWS account (read-only). See `ARCHITECTURE.md`.

## Setup

Prereqs: Node 18+, Python 3.11+, an AWS account with Bedrock access in `ap-south-1` (ambient AWS credentials via `aws configure` or env), and Node (for the MCP subprocess).

1. Frontend deps: `npm install`
2. Agent deps: `cd agent && python -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..`
3. Copy env templates: `cp .env.example .env` and `cp agent/.env.example agent/.env` and fill values (see comments).
4. Run the agent (terminal 1): `agent/.venv/bin/uvicorn agent.main:app --port 8787`
5. Run the frontend (terminal 2): `npm run dev` → [http://localhost:3000](http://localhost:3000)
6. In the chat, send your read-only role ARN + region to begin (Kepler will guide you), or run in demo mode below.

## Demo mode (deterministic, no AWS, no quota)

Start the agent with `KEPLER_DEMO=1` and it replays one real captured run (real Emfirge output, tokenized) so the UI shows the full flow with zero network calls:  
