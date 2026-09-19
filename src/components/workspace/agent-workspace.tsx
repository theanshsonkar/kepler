"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { ArrowLeft, ChevronDown, GitBranch, Paperclip, Plus, Send, Terminal } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { parseSSE } from "@/lib/agent-events";
import { cn } from "@/lib/utils";

type Message = { from: "user" | "agent"; body: string; time: string };
type ActivityLine = { time?: string; line: string };
type Decision = { question?: string; options: string[]; recommended?: string };

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "message", "line", "value"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function activityValue(value: unknown): ActivityLine | null {
  if (typeof value === "string") return { line: value };
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const line = textValue(record.line ?? record.text ?? value);
  return line ? { line, time: typeof record.time === "string" ? record.time : undefined } : null;
}

function decisionValue(value: unknown): Decision | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const rawOptions = record.options;
  const options = Array.isArray(rawOptions) ? rawOptions.map(textValue).filter(Boolean) : [];
  if (!options.length) return null;
  return { question: typeof record.question === "string" ? record.question : undefined, options, recommended: typeof record.recommended === "string" ? record.recommended : undefined };
}

export function AgentWorkspace() {
  const [tab, setTab] = useState<"activity" | "diff">("activity");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isReplying, setReplying] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activityLines, setActivityLines] = useState<ActivityLine[]>([]);
  const [findings, setFindings] = useState<unknown[]>([]);
  const [diffData, setDiffData] = useState<unknown>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [cloudWrites, setCloudWrites] = useState(0);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);

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

  async function sendMessage(input: FormEvent<HTMLFormElement> | string) {
    if (typeof input !== "string") input.preventDefault();
    const body = (typeof input === "string" ? input : draft).trim();
    if (!sessionId || !body || isReplying) return;
    setMessages((current) => [...current, { from: "user", body, time: "now" }]);
    setDraft("");
    setReplying(true);
    let agentMessageIndex: number | null = null;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId, message: body }) });
      if (!response.ok) throw new Error("Unable to send message");
      for await (const event of parseSSE(response)) {
        const data = event.data;
        if (event.type === "token") {
          const token = textValue(data && typeof data === "object" ? (data as Record<string, unknown>).text : data);
          if (!token) continue;
          setMessages((current) => {
            if (agentMessageIndex === null) { agentMessageIndex = current.length; return [...current, { from: "agent", body: token, time: "now" }]; }
            return current.map((message, index) => index === agentMessageIndex ? { ...message, body: message.body + token } : message);
          });
        } else if (event.type === "activity") {
          const line = activityValue(data); if (line) setActivityLines((current) => [...current, line]);
        } else if (event.type === "finding") setFindings((current) => [...current, data]);
        else if (event.type === "diff") setDiffData(data);
        else if (event.type === "decision") setDecision(decisionValue(data));
        else if (event.type === "status") {
          const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
          setStatus(textValue(record.state ?? data) || null);
          if (typeof record.cloud_writes === "number") setCloudWrites(record.cloud_writes);
          if (record.state === "connected") {
            if (typeof record.account === "string") setAccount(record.account);
            if (typeof record.region === "string") setRegion(record.region);
          }
          const branch = record.branch_name ?? record.branch;
          if (typeof branch === "string") setBranchName(branch);
        } else if (event.type === "error") {
          const message = textValue(data);
          setMessages((current) => [...current, { from: "agent", body: message, time: "now" }]);
          setReplying(false);
        }
      }
    } catch (error) {
      setMessages((current) => [...current, { from: "agent", body: error instanceof Error ? error.message : "Unable to complete request", time: "now" }]);
    } finally { setReplying(false); }
  }

  return (
    <main className="relative isolate min-h-dvh overflow-x-hidden bg-black text-[#edf0ed]">
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-[1760px] flex-col px-4 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-7">
        <header className="mb-7 flex items-center justify-between lg:mb-0"><div className="flex items-center gap-3"><Link href="/" aria-label="Back to Emfirge home" className="grid size-9 place-items-center rounded-full border border-white/15 text-white/75 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ArrowLeft className="size-4" /></Link><span className="grid size-9 place-items-center rounded-lg border border-white/15 bg-black/15 text-white"><BrandMark className="size-4" /></span><p className="text-sm font-medium tracking-[-0.02em] text-white">Emfirge</p></div><p className="hidden font-mono text-[9px] uppercase tracking-[0.14em] text-white/45 sm:block">cloud writes · {cloudWrites}</p></header>
        <section className="grid gap-4 lg:my-auto lg:h-[calc(100dvh-118px)] lg:grid-cols-[minmax(0,1.3fr)_minmax(430px,0.9fr)] lg:gap-6">
          <section className="agent-grain relative flex min-h-[650px] flex-col overflow-hidden rounded-[16px] border border-white/[0.14] bg-[#141614] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] lg:min-h-0" aria-label="Agent sandbox">
            <div className="flex items-center justify-between px-6 py-6 sm:px-8"><div className="flex items-center gap-2.5"><Terminal className="size-4 text-white/65" /><div><p className="text-sm font-medium text-white">{branchName ?? "Branch pending"}</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.13em] text-white/40">isolated branch</p></div></div><button type="button" className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/55 transition hover:text-white"><GitBranch className="size-3.5" />Branch<ChevronDown className="size-3" /></button></div>
            <div className="flex gap-5 px-6 sm:px-8"><TabButton active={tab === "activity"} onClick={() => setTab("activity")} label="Activity" /><TabButton active={tab === "diff"} onClick={() => setTab("diff")} label="Diff" /></div>
            <div className="relative flex-1 overflow-auto px-6 py-8 sm:px-8 sm:py-9">{tab === "activity" ? <Activity activityLines={activityLines} findings={findings} status={status} /> : <Diff diffData={diffData} />}</div>
            <div className="flex items-center justify-between px-6 py-5 font-mono text-[8px] uppercase tracking-[0.11em] text-white/35 sm:px-8"><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#c7f36b]" aria-hidden="true" />{account || region ? `acct ${account ?? "unknown"} · ${region ?? "unknown"} · read-only` : branchName ? `${branchName} · read-only` : "branch pending · read-only"}</span><span>{status ?? "pending"}</span></div>
          </section>
          <section className="agent-grain relative flex min-h-[650px] flex-col overflow-hidden rounded-[16px] border border-white/[0.14] bg-[#141614] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] lg:min-h-0" aria-label="Chat with Kepler">
            <div className="flex items-center gap-3 px-6 py-6 sm:px-8"><span className="grid size-9 place-items-center rounded-full bg-white/[0.1] text-white"><BrandMark className="size-4" /></span><div><p className="text-base font-medium text-white">Kepler</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.13em] text-white/40">branch-aware agent</p></div></div>
            <div className="scrollbar-subtle flex-1 overflow-y-auto px-6 py-4 sm:px-8 sm:py-5">{messages.map((message, index) => <Message key={`${message.time}-${index}`} message={message} />)}{isReplying && <p className="text-sm text-white/45">Thinking…</p>}</div>
            {decision && <div className="mx-6 mb-4 rounded-[15px] border border-white/10 bg-black/20 p-4 sm:mx-8"><p className="text-sm leading-6 text-white/80">{decision.question}</p><div className="mt-3 grid gap-2">{decision.options.map((option) => <button key={option} type="button" onClick={() => sendMessage(option)} className="rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/10 hover:text-white">{option}</button>)}</div>{decision.recommended && <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">recommended · {decision.recommended}</p>}</div>}
            <div className="px-5 pb-5 pt-3 sm:px-7 sm:pb-7"><form onSubmit={sendMessage} className="rounded-[18px] border border-white/10 bg-black/20 p-4"><label htmlFor="agent-message" className="sr-only">Message Kepler</label><textarea id="agent-message" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="How can we help?" className="min-h-24 w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-white outline-none placeholder:text-white/35" /><div className="mt-2 flex items-center justify-between"><div className="flex items-center gap-1"><button type="button" aria-label="Attach Terraform or change request" className="grid size-9 place-items-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white"><Paperclip className="size-4" /></button><button type="button" aria-label="Add a branch mutation" className="grid size-9 place-items-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white"><Plus className="size-4" /></button></div><button type="submit" disabled={!sessionId || !draft.trim() || isReplying} className="flex h-10 items-center gap-2 rounded-full bg-[#f2f3ee] px-4 text-sm font-medium text-[#141616] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"><span>Send</span><Send className="size-3.5" /></button></div></form><p className="mt-3 text-center font-mono text-[8px] uppercase tracking-[0.1em] text-white/30">Changes stay on this branch</p></div>
          </section>
        </section>
      </div>
    </main>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) { return <button type="button" onClick={onClick} className={cn("border-b px-0 py-3 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7f36b]/60", active ? "border-[#c7f36b] text-white" : "border-transparent text-white/40 hover:text-white/70")}>{label}</button>; }

function Activity({ activityLines, findings, status }: { activityLines: ActivityLine[]; findings: unknown[]; status: string | null }) {
  return <div className="font-mono text-[11px] leading-7 sm:text-xs"><p className="mb-6 text-white/45">// consequence plan</p><div className="space-y-1.5">{activityLines.map((item, index) => <div key={`${item.time ?? ""}-${item.line}-${index}`} className="line-in grid grid-cols-[70px_minmax(0,1fr)] gap-3"><span className="text-white/30">{item.time ?? ""}</span><p className="text-white/70">{item.line}</p></div>)}</div>{findings.length > 0 && <div className="mt-9 grid max-w-xl gap-7 border-t border-white/10 pt-6"><div><p className="text-white/35">// findings</p>{findings.map((finding, index) => <p key={index} className="mt-2 text-white/70">{textValue(finding)}</p>)}</div></div>}{status && <div className="mt-9 max-w-xl border-t border-white/10 pt-6"><div className="flex items-center justify-between gap-3"><p className="text-white/35">// current operation</p><span className="text-[9px] text-white/45">{status}</span></div></div>}</div>;
}

function Diff({ diffData }: { diffData: unknown }) {
  const diff = textValue(diffData);
  return <div className="font-mono text-[11px] leading-7 text-white/70 sm:text-xs"><p className="mb-6 text-white/45">// branch diff</p>{diff ? <pre className="overflow-auto whitespace-pre-wrap">{diff}</pre> : <p className="text-white/45">No diff data yet.</p>}</div>;
}

function Message({ message }: { message: Message }) { const user = message.from === "user"; return <article className={cn("mb-7", user && "ml-auto max-w-[94%]")}><div className={cn("mb-2 flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.12em]", user ? "justify-end text-white/35" : "text-white/35")}><span>{user ? "You" : "Kepler"}</span><span>·</span><span>{message.time}</span></div><div className={cn("text-sm leading-6", user ? "rounded-[15px] rounded-tr-sm bg-white/10 px-4 py-3.5 text-white/90" : "text-white/75")}>{message.body}</div></article>; }

