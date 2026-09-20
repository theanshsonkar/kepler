"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { GitBranch, Paperclip, Plus, Send, Terminal } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { parseSSE } from "@/lib/agent-events";
import { cn } from "@/lib/utils";

type Message = { id?: string; from: "user" | "agent"; body: string; time: string };
type Status = { state?: string; cloud_writes?: number; score?: number; security_score?: number; branchName?: string; account?: string; region?: string };

const activity = [
  ["10:42:03", "emfirge_scan({ role_arn: \"…/EmfirgeReadOnly\", region: \"ap-south-1\" })"],
  ["10:42:05", "build_graph() → 614 relationships · 9 categories"],
  ["10:42:06", "deepcopy(base) → branch \"payments-ha\""],
  ["10:42:07", "_fix_rds_multi_az(payments-db)"],
  ["10:42:08", "add_edge REACHES_VIA_SG(checkout-worker → payments-db:5432)"],
  ["10:42:09", "run_rules() → security · availability · cost · disaster_recovery"],
  ["10:42:10", "dijkstra_from_internet() · EDGE_WEIGHTS"],
  ["10:42:11", "get_attack_path_to(payments-db)"],
  ["10:42:11", "emfirge_simulate_breach({ query: \"reach payments-db\" })"],
  ["10:42:12", "verdict.hold(EMFIRGE-RDS-002 · Moderate)"],
];

const startingMessages: Message[] = [
  { from: "agent", body: "I'm Kepler. I fork your live AWS into an isolated branch, try a change, and show you the consequences before anything is real — 0 cloud writes. Send your role ARN + region (or type \"demo\") to begin.", time: "now" },
];

export function AgentWorkspace() {
  const [tab, setTab] = useState<"activity" | "compliance" | "diff">("activity");
  const [messages, setMessages] = useState(startingMessages);
  const [draft, setDraft] = useState("");
  const [isReplying, setReplying] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [realActivity, setRealActivity] = useState<[string, string][]>([]);
  const [findings, setFindings] = useState<unknown[]>([]);
  const [realDiff, setRealDiff] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({});
  const [attackPaths, setAttackPaths] = useState<any>(null);
  const [compliance, setCompliance] = useState<any>(null);
  const [beforeAfter, setBeforeAfter] = useState<any>(null);
  const [decision, setDecision] = useState<any>(null);
  const [decisionActed, setDecisionActed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/session", { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to create session");
        const data = await response.json() as { session_id?: string };
        if (active && data.session_id) setSessionId(data.session_id);
      })
      .catch(() => { if (active) setSessionId(null); });
    return () => { active = false; };
  }, []);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!sessionId || !body || isReplying) return;
    setMessages((current) => [...current, { from: "user", body, time: "now" }]);
    setDraft("");
    setReplying(true);
    setTab("activity");
    const agentMessageId = `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let agentStarted = false;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId, message: body }) });
      if (!response.ok) throw new Error("Unable to send message");
      for await (const event of parseSSE(response)) {
        if (event.type === "token") {
          const data = event.data;
          const token = typeof data === "string" ? data : data && typeof data === "object" && typeof (data as { text?: unknown }).text === "string" ? (data as { text: string }).text : "";
          if (!token) continue;
          if (!agentStarted) {
            agentStarted = true;
            setMessages((current) => [...current, { id: agentMessageId, from: "agent", body: token, time: "now" }]);
          } else {
            setMessages((current) => current.map((message) => (message.id === agentMessageId ? { ...message, body: message.body + token } : message)));
          }
        } else if (event.type === "activity") {
          const data = event.data as { line?: unknown };
          const line = data?.line;
          if (typeof line === "string") setRealActivity((current) => [...current, [event.ts, line]]);
        } else if (event.type === "finding") setFindings((current) => [...current, event.data]);
        else if (event.type === "diff") {
          const data = event.data as { text?: unknown };
          setRealDiff(typeof data?.text === "string" ? data.text : typeof event.data === "string" ? event.data : null);
        } else if (event.type === "status") {
          const data = event.data ?? {};
          setStatus((current) => ({ ...current, ...data, branchName: data.branch_name ?? data.branch ?? current.branchName }));
        } else if (event.type === "attackpaths") setAttackPaths(event.data);
        else if (event.type === "compliance") setCompliance(event.data);
        else if (event.type === "beforeafter") setBeforeAfter(event.data);
        else if (event.type === "decision") { setDecision(event.data); setDecisionActed(false); }
        else if (event.type === "error") {
          const data = event.data as { message?: unknown };
          setMessages((current) => [...current, { from: "agent", body: typeof data?.message === "string" ? data.message : String(event.data), time: "now" }]);
          setReplying(false);
          break;
        }
      }
    } catch (error) {
      setMessages((current) => [...current, { from: "agent", body: error instanceof Error ? error.message : "Unable to complete request", time: "now" }]);
    } finally { setReplying(false); }
  }

  return (
    <main className="relative isolate min-h-dvh overflow-x-hidden bg-black text-[#edf0ed]">
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-[1760px] flex-col px-4 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-7">
        <header className="mb-7 flex items-center justify-between lg:mb-0">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg border border-white/15 bg-black/15 text-white"><BrandMark className="size-4" /></span>
            <p className="text-sm font-medium tracking-[-0.02em] text-white">Kepler</p>
          </div>
          <p className="hidden font-mono text-[9px] uppercase tracking-[0.14em] text-white/45 sm:block">No cloud writes</p>
        </header>
        <section className="grid gap-4 lg:my-auto lg:h-[calc(100dvh-118px)] lg:grid-cols-[minmax(0,1.3fr)_minmax(430px,0.9fr)] lg:gap-6">
          <section className="agent-grain relative flex min-h-[650px] flex-col overflow-hidden rounded-[16px] border border-white/[0.14] bg-[#141614] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] lg:min-h-0" aria-label="Agent sandbox">
            <div className="flex items-center justify-between px-6 py-6 sm:px-8">
              <div className="flex items-center gap-2.5"><Terminal className="size-4 text-white/65" /><div><p className="text-sm font-medium text-white">cloud branch</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.13em] text-white/40">read-only · 0 cloud writes</p></div></div>
              <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/55"><GitBranch className="size-3.5" />{status.branchName ? status.branchName : "read-only fork"}</span>
            </div>
            <div className="flex gap-5 px-6 sm:px-8">
              <TabButton active={tab === "activity"} onClick={() => setTab("activity")} label="Activity" />
              <TabButton active={tab === "compliance"} onClick={() => setTab("compliance")} label="Compliance" />
              <TabButton active={tab === "diff"} onClick={() => setTab("diff")} label="Diff" />
            </div>
            <div className="relative flex-1 overflow-auto px-6 py-8 sm:px-8 sm:py-9">{tab === "diff" ? <Diff beforeAfter={beforeAfter} realDiff={realDiff} /> : <Activity view={tab} realActivity={realActivity} attackPaths={attackPaths} compliance={compliance} />}</div>
            <div className="flex items-center justify-between px-6 py-5 font-mono text-[8px] uppercase tracking-[0.11em] text-white/35 sm:px-8"><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#c7f36b]" aria-hidden="true" />{status.account || status.region ? `acct ${status.account ?? "unknown"} · ${status.region ?? "unknown"} · read-only` : status.branchName ? `${status.branchName} · read-only` : "not connected · read-only"}</span><span>0 cloud writes</span></div>
          </section>

          <section className="agent-grain relative flex min-h-[650px] flex-col overflow-hidden rounded-[16px] border border-white/[0.14] bg-[#141614] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] lg:min-h-0" aria-label="Chat with Kepler">
            <div className="flex items-center gap-3 px-6 py-6 sm:px-8"><span className="grid size-9 place-items-center rounded-full bg-white/[0.1] text-white"><BrandMark className="size-4" /></span><div><p className="text-base font-medium text-white">Kepler</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.13em] text-white/40">branch-aware agent</p></div></div>
            <div className="scrollbar-subtle flex-1 overflow-y-auto px-6 py-4 sm:px-8 sm:py-5">
              {messages.map((message, index) => <Message key={`${message.time}-${index}`} message={message} />)}
              {decision && !decisionActed && (
                <div className="mb-7 flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setDecisionActed(true); setTab("activity"); setRealActivity((c) => [...c, [new Date().toISOString(), "<- approved · change recorded · 0 cloud writes · nothing promoted"]]); setMessages((c) => [...c, { from: "agent", body: "Recorded. Nothing was applied to your cloud — 0 cloud writes. The fix stays modeled on the branch until you promote it yourself.", time: "now" }]); }} className="rounded-full bg-[#c7f36b] px-4 py-2 text-xs font-medium text-[#141616] transition hover:brightness-110">Approve fix</button>
                  <button type="button" onClick={() => { setDecisionActed(true); setTab("activity"); setRealActivity((c) => [...c, [new Date().toISOString(), "<- kept as-is · branch discarded · nothing changed"]]); setMessages((c) => [...c, { from: "agent", body: "Kept as-is. Branch discarded — nothing changed.", time: "now" }]); }} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/75 transition hover:bg-white/10">Keep as-is</button>
                  <button type="button" onClick={() => setTab("diff")} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/75 transition hover:bg-white/10">Review diff</button>
                </div>
              )}
              {isReplying && <p className="text-sm text-white/45">Thinking…</p>}
            </div>
            <div className="px-5 pb-5 pt-3 sm:px-7 sm:pb-7">
              <form onSubmit={sendMessage} className="rounded-[18px] border border-white/10 bg-black/20 p-4">
                <label htmlFor="agent-message" className="sr-only">Message Kepler</label>
                <textarea id="agent-message" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="How can we help?" className="min-h-24 w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-white outline-none placeholder:text-white/35" />
                <div className="mt-2 flex items-center justify-between"><div className="flex items-center gap-1"><button type="button" aria-label="Attach Terraform or change request" className="grid size-9 place-items-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white"><Paperclip className="size-4" /></button><button type="button" aria-label="Add a branch mutation" className="grid size-9 place-items-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white"><Plus className="size-4" /></button></div><button type="submit" disabled={!draft.trim() || isReplying} className="flex h-10 items-center gap-2 rounded-full bg-[#f2f3ee] px-4 text-sm font-medium text-[#141616] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"><span>Send</span><Send className="size-3.5" /></button></div>
              </form>
              <p className="mt-3 text-center font-mono text-[8px] uppercase tracking-[0.1em] text-white/30">Changes stay on this branch</p>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} className={cn("border-b px-0 py-3 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7f36b]/60", active ? "border-[#c7f36b] text-white" : "border-transparent text-white/40 hover:text-white/70")}>{label}</button>;
}

function TypeLine({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) { setShown(text.length); return; }
    setShown(0);
    let i = 0;
    const id = setInterval(() => { i += 1; setShown(i); if (i >= text.length) clearInterval(id); }, 16);
    return () => clearInterval(id);
  }, [text, animate]);
  return <>{text.slice(0, shown)}{animate && shown < text.length && <span className="caret-blink">▊</span>}</>;
}

function ActivityFeed({ realActivity }: { realActivity: [string, string][] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [realActivity.length]);
  const base = "font-mono text-[11px] leading-7 sm:text-xs";
  if (realActivity.length === 0) return <div className={base}><p className="mb-3 text-white/45">// live trace · agent ↔ emfirge</p><p className="text-white/45">// send your role ARN + region to scan your own cloud</p><p className="mt-1 text-white/35">// or type "demo" and hit send to watch a full run</p></div>;
  return (
    <div className={base}>
      <p className="mb-3 text-white/45">// live trace · agent ↔ emfirge</p>
      <div ref={ref} className="scrollbar-subtle max-h-[38vh] space-y-1.5 overflow-y-auto pr-2">
        {realActivity.map(([ts, line], i, arr) => {
          const last = i === arr.length - 1;
          return (
            <div key={i} className="line-in grid grid-cols-[70px_minmax(0,1fr)] gap-3">
              <span className="text-white/30">{(() => { const d = new Date(ts); return isNaN(d.getTime()) ? ts : d.toLocaleTimeString([], { hour12: false }); })()}</span>
              <p className={cn(line.startsWith("<-") ? "text-[#c7f36b]" : last ? "text-white" : "text-white/70")}><TypeLine text={line} animate={last} /></p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Activity({ view, realActivity, attackPaths, compliance }: { view: "activity" | "compliance"; realActivity: [string, string][]; attackPaths: any; compliance: any; }) {
  const paths: any[] = attackPaths?.paths ?? [];
  const criticals: any[] = attackPaths?.critical_resources ?? [];
  const criticalCount = paths.filter((p) => String(p.severity).toLowerCase() === "critical").length;
  const netPath = paths.find((p) => Array.isArray(p.path) && p.path.includes("INTERNET"));
  const base = "font-mono text-[11px] leading-7 sm:text-xs";
  if (view === "activity") {
    return (
      <div className="flex flex-col gap-6">
        <ActivityFeed realActivity={realActivity} />
        {paths.length > 0 && (
          <div className={cn(base, "space-y-6 border-t border-white/10 pt-6")}>
            <div><p className="mb-3 text-white/45">// findings · {criticalCount} critical</p><div className="space-y-1">{paths.slice(0, 4).map((p, i) => (<p key={i} className={String(p.severity).toLowerCase() === "critical" ? "text-[#e8b292]" : "text-white/70"}>{String(p.severity).toLowerCase() === "critical" ? "! " : "· "}{p.finding_title}</p>))}{paths.length > 4 && <p className="text-white/30">+{paths.length - 4} more</p>}</div></div>
            {netPath && (<div><p className="mb-3 text-white/45">// attack path · internet → crown jewel</p><p className="break-words text-white/80">{netPath.path.join("  →  ")}</p></div>)}
            {criticals.length > 0 && (<div><p className="mb-3 text-white/45">// crown jewels</p><div className="space-y-1">{criticals.slice(0, 2).map((c, i) => (<div key={i} className="flex justify-between gap-3"><span className="text-white/70">{c.label}</span><span className="text-white/40">{c.finding_count} findings · blast {c.blast_radius}</span></div>))}</div></div>)}
          </div>
        )}
      </div>
    );
  }
  if (!compliance) return <div className={base}><p className="text-white/45">// no compliance data yet</p></div>;
  const failed: any[] = (compliance.controls ?? []).filter((c: any) => String(c.status).toLowerCase() === "fail");
  return (
    <div className={cn(base, "space-y-6")}>
      <div><p className="mb-3 text-white/45">// compliance</p><p className="text-white/70">{compliance.framework} {compliance.version} — <span className="text-[#c7f36b]">{compliance.passed} pass</span> · <span className="text-[#e8b292]">{compliance.failed} fail</span> / {compliance.total}</p></div>
      {failed.length > 0 && (<div className="border-t border-white/10 pt-6"><p className="mb-3 text-white/45">// failing controls</p><div className="space-y-1">{failed.slice(0, 6).map((c: any, i: number) => (<p key={i} className="text-white/70">! {c.title}</p>))}{failed.length > 6 && <p className="text-white/30">+{failed.length - 6} more</p>}</div></div>)}
    </div>
  );
}

function Diff({ beforeAfter, realDiff }: { beforeAfter: any; realDiff: string | null }) {
  const base = "font-mono text-[11px] leading-7 sm:text-xs";
  if (!beforeAfter) return <div className={cn(base, "text-white/70")}><p className="mb-6 text-white/45">// branch diff</p><p className="text-white/45">{realDiff ?? "no branch changes yet"}</p></div>;
  const removed: any[] = beforeAfter.removed_findings ?? [];
  const added: any[] = beforeAfter.added_findings ?? [];
  const sealed: string[] = beforeAfter.no_longer_internet_reachable ?? [];
  return (
    <div className={cn(base, "space-y-6 text-white/70")}>
      <div><p className="mb-3 text-white/45">// before → after</p>{sealed.length > 0 && <p className="text-[#c7f36b]">sealed  {sealed.join(", ")} · no longer internet-reachable</p>}<p className="text-white/45">score {beforeAfter.score_before} → {beforeAfter.score_after} · other criticals remain</p></div>
      <div className="border-t border-white/10 pt-6"><p className="mb-3 text-white/45">// branch diff · findings</p><div className="space-y-1">{removed.map((f, i) => (<p key={`r${i}`} className="text-[#c7f36b]">- {f.rule_id || "finding"} · {f.resource_id} · {f.severity}</p>))}{added.map((f, i) => (<p key={`a${i}`} className="text-[#e8b292]">+ {f.rule_id || "finding"} · {f.resource_id} · {f.severity}</p>))}</div></div>
      <p className="font-sans text-sm leading-6 text-white/45">These changes exist only on the branch. Nothing was applied to your cloud.</p>
    </div>
  );
}

function Message({ message }: { message: Message }) {
  const user = message.from === "user";
  return <article className={cn("mb-7", user && "ml-auto max-w-[94%]")}><div className={cn("mb-2 flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.12em]", user ? "justify-end text-white/35" : "text-white/35")}><span>{user ? "You" : "Kepler"}</span><span>·</span><span>{message.time}</span></div><div className={cn("text-sm leading-6", user ? "rounded-[15px] rounded-tr-sm bg-white/10 px-4 py-3.5 text-white/90" : "text-white/75")}>{message.body}</div></article>;
}
