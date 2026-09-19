"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { ArrowLeft, ChevronDown, GitBranch, Paperclip, Plus, Send, Terminal } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

type Message = { from: "user" | "agent"; body: string; time: string };

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
  { from: "user", body: "Make payments-db multi-AZ and allow checkout-worker to connect on 5432. Tell me what the whole cloud change means.", time: "10:42" },
  { from: "agent", body: "I made the changes in payments-ha, an isolated branch of payments-production. The branch is more resilient, but it introduces one new reachable database path. Nothing has been applied to your cloud.", time: "10:42" },
];

export function AgentWorkspace() {
  const [tab, setTab] = useState<"activity" | "diff">("activity");
  const [messages, setMessages] = useState(startingMessages);
  const [draft, setDraft] = useState("");
  const [isReplying, setReplying] = useState(false);
  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || isReplying) return;
    setMessages((current) => [...current, { from: "user", body, time: "now" }]);
    setDraft("");
    setReplying(true);
    window.setTimeout(() => {
      setMessages((current) => [...current, { from: "agent", body: "I’ll add that only to this branch and refresh the affected consequence lenses. I’ll leave anything beyond the branch model explicitly unresolved.", time: "now" }]);
      setReplying(false);
    }, 560);
  }

  return (
    <main className="relative isolate min-h-dvh overflow-x-hidden bg-black text-[#edf0ed]">
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-[1760px] flex-col px-4 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-7">
        <header className="mb-7 flex items-center justify-between lg:mb-0">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Back to Emfirge home" className="grid size-9 place-items-center rounded-full border border-white/15 text-white/75 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><ArrowLeft className="size-4" /></Link>
            <span className="grid size-9 place-items-center rounded-lg border border-white/15 bg-black/15 text-white"><BrandMark className="size-4" /></span>
            <p className="text-sm font-medium tracking-[-0.02em] text-white">Emfirge</p>
          </div>
          <p className="hidden font-mono text-[9px] uppercase tracking-[0.14em] text-white/45 sm:block">No cloud writes</p>
        </header>
        <section className="grid gap-4 lg:my-auto lg:h-[calc(100dvh-118px)] lg:grid-cols-[minmax(0,1.3fr)_minmax(430px,0.9fr)] lg:gap-6">
          <section className="agent-grain relative flex min-h-[650px] flex-col overflow-hidden rounded-[16px] border border-white/[0.14] bg-[#141614] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] lg:min-h-0" aria-label="Agent sandbox">
            <div className="flex items-center justify-between px-6 py-6 sm:px-8">
              <div className="flex items-center gap-2.5"><Terminal className="size-4 text-white/65" /><div><p className="text-sm font-medium text-white">payments-ha</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.13em] text-white/40">isolated branch</p></div></div>
              <button type="button" className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/55 transition hover:text-white"><GitBranch className="size-3.5" />Branch<ChevronDown className="size-3" /></button>
            </div>
            <div className="flex gap-5 px-6 sm:px-8">
              <TabButton active={tab === "activity"} onClick={() => setTab("activity")} label="Activity" />
              <TabButton active={tab === "diff"} onClick={() => setTab("diff")} label="Diff" />
            </div>
            <div className="relative flex-1 overflow-auto px-6 py-8 sm:px-8 sm:py-9">{tab === "activity" ? <Activity /> : <Diff />}</div>
            <div className="flex items-center justify-between px-6 py-5 font-mono text-[8px] uppercase tracking-[0.11em] text-white/35 sm:px-8"><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#c7f36b]" aria-hidden="true" />payments-production · read-only</span><span>0 writes</span></div>
          </section>

          <section className="agent-grain relative flex min-h-[650px] flex-col overflow-hidden rounded-[16px] border border-white/[0.14] bg-[#141614] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] lg:min-h-0" aria-label="Chat with Emfirge">
            <div className="flex items-center gap-3 px-6 py-6 sm:px-8"><span className="grid size-9 place-items-center rounded-full bg-white/[0.1] text-white"><BrandMark className="size-4" /></span><div><p className="text-base font-medium text-white">Emfirge</p><p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.13em] text-white/40">branch-aware agent</p></div></div>
            <div className="scrollbar-subtle flex-1 overflow-y-auto px-6 py-4 sm:px-8 sm:py-5">
              {messages.map((message, index) => <Message key={`${message.time}-${index}`} message={message} />)}
              {isReplying && <p className="text-sm text-white/45">Thinking…</p>}
            </div>
            <div className="px-5 pb-5 pt-3 sm:px-7 sm:pb-7">
              <form onSubmit={sendMessage} className="rounded-[18px] border border-white/10 bg-black/20 p-4">
                <label htmlFor="agent-message" className="sr-only">Message Emfirge</label>
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

function Activity() {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    if (shown >= activity.length) return;
    const timer = setTimeout(() => setShown((value) => value + 1), 420);
    return () => clearTimeout(timer);
  }, [shown]);
  return <div className="font-mono text-[11px] leading-7 sm:text-xs"><p className="mb-6 text-white/45">// consequence plan</p><div className="space-y-1.5">{activity.slice(0, shown).map(([time, line], index) => <div key={line} className="line-in grid grid-cols-[70px_minmax(0,1fr)] gap-3"><span className="text-white/30">{time}</span><p className={cn(index === activity.length - 1 ? "text-[#e8b292]" : "text-white/70")}>{line}{index === shown - 1 && <span className="caret-blink ml-0.5">▊</span>}</p></div>)}</div><p className="mt-9 max-w-xl text-sm font-sans leading-6 text-white/55">One new path needs review before this branch can be exported. The production account remains unchanged.</p><div className="mt-9 grid max-w-xl gap-7 border-t border-white/10 pt-6 sm:grid-cols-2"><div><p className="text-white/35">// computed from branch</p><p className="mt-2 text-white/70">+ Multi-AZ · availability</p><p className="text-white/70">+ $182.40/mo · cost</p><p className="text-[#e8b292]">! REACHES_VIA_SG :5432 · security</p></div><div><p className="text-white/35">// confidence</p><p className="mt-2 text-white/70">network reachability&nbsp;&nbsp;HIGH</p><p className="text-white/70">IAM semantics&nbsp;&nbsp;MEDIUM</p><p className="text-white/45">runtime behavior&nbsp;&nbsp;needs real run</p></div></div><div className="mt-9 max-w-xl border-t border-white/10 pt-6"><div className="flex items-center justify-between gap-3"><p className="text-white/35">// current operation</p><span className="text-[9px] text-white/45">IN PROGRESS</span></div><p className="mt-3 text-sm font-sans text-white/80">get_attack_path_to(payments-db) · dijkstra_from_internet</p><dl className="mt-4 grid gap-x-7 gap-y-1 text-white/45 sm:grid-cols-2"><div className="flex justify-between gap-3"><dt>input graph</dt><dd className="text-white/70">614 relationships</dd></div><div className="flex justify-between gap-3"><dt>edges</dt><dd className="text-white/70">REACHES · REACHES_VIA_SG · CAN_ASSUME</dd></div><div className="flex justify-between gap-3"><dt>branch writes</dt><dd className="text-white/70">0</dd></div><div className="flex justify-between gap-3"><dt>next</dt><dd className="text-white/70">emfirge_check_compliance(CIS)</dd></div></dl></div></div>;
}

function Diff() {
  const diff = "~ aws_db_instance.payments\n- multi_az = false\n+ multi_az = true\n\n~ aws_security_group.payments\n+ ingress { from_port = 5432\n+   source = checkout-worker }";
  return <div className="font-mono text-[11px] leading-7 text-white/70 sm:text-xs"><p className="mb-6 text-white/45">// branch diff · 3 mutations</p><pre className="overflow-auto whitespace-pre-wrap">{diff}</pre><p className="mt-9 font-sans text-sm leading-6 text-white/45">These changes exist only on payments-ha. They are not an applied Terraform plan.</p></div>;
}

function Message({ message }: { message: Message }) {
  const user = message.from === "user";
  return <article className={cn("mb-7", user && "ml-auto max-w-[94%]")}><div className={cn("mb-2 flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.12em]", user ? "justify-end text-white/35" : "text-white/35")}><span>{user ? "You" : "Emfirge"}</span><span>·</span><span>{message.time}</span></div><div className={cn("text-sm leading-6", user ? "rounded-[15px] rounded-tr-sm bg-white/10 px-4 py-3.5 text-white/90" : "text-white/75")}>{message.body}</div></article>;
}

