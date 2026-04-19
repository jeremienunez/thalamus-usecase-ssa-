import { useState } from "react";
import { Drawer, DrawerSection, KV } from "@/shared/ui/Drawer";
import { useDecision, useFinding } from "@/lib/queries";
import { useUiStore } from "@/lib/uiStore";
import { SOURCE_COLOR, STATUS_COLOR } from "@/lib/graphColors";
import type { FindingStatus } from "@/lib/api";
import { Check, X, Edit3 } from "lucide-react";

export function SweepDrawer({ findingId }: { findingId: string | null }) {
  const { data: f } = useFinding(findingId);
  const decide = useDecision();
  const close = useUiStore((s) => s.closeDrawer);
  const [reason, setReason] = useState("");

  if (!f) return <Drawer title="FINDING" subtitle="select a node">{null}</Drawer>;

  const submit = (decision: FindingStatus) => {
    decide.mutate(
      { id: f.id, decision, reason: reason || undefined },
      { onSuccess: () => { setReason(""); close(); } },
    );
  };

  return (
    <Drawer title="FINDING" subtitle={`${f.id} · ${f.cortex}`}>
      <DrawerSection title="STATUS">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-5 items-center border px-2 text-label"
            style={{
              color: STATUS_COLOR[f.status],
              borderColor: STATUS_COLOR[f.status] + "66",
              backgroundColor: STATUS_COLOR[f.status] + "1A",
            }}
          >
            {f.status.toUpperCase()}
          </span>
          <span className="mono text-caption text-muted">priority {f.priority}</span>
        </div>
      </DrawerSection>

      <DrawerSection title="SUMMARY">
        <div className="text-body text-primary">{f.title}</div>
        <div className="mt-2 text-caption text-muted">{f.summary}</div>
      </DrawerSection>

      <DrawerSection title={`EVIDENCE (${f.evidence.length})`}>
        {f.evidence.map((e, i) => (
          <div key={i} className="border-b border-hairline py-2 last:border-0">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-4 items-center border px-1.5 text-nano uppercase tracking-widest"
                style={{
                  color: SOURCE_COLOR[e.kind],
                  borderColor: SOURCE_COLOR[e.kind] + "66",
                }}
              >
                {e.kind}
              </span>
              <span className="mono text-caption text-dim truncate">{e.uri}</span>
            </div>
            <div className="mt-1 text-caption text-numeric">{e.snippet}</div>
          </div>
        ))}
      </DrawerSection>

      {f.swarmConsensus && (
        <DrawerSection title={`SWARM CONSENSUS (K=${f.swarmConsensus.k})`}>
          <SwarmBar {...f.swarmConsensus} />
          <div className="mt-2 grid grid-cols-3 gap-2 text-caption">
            <div><span className="label">ACCEPT</span><div className="mono text-cyan">{f.swarmConsensus.accept}</div></div>
            <div><span className="label">REJECT</span><div className="mono text-hot">{f.swarmConsensus.reject}</div></div>
            <div><span className="label">ABSTAIN</span><div className="mono text-muted">{f.swarmConsensus.abstain}</div></div>
          </div>
        </DrawerSection>
      )}

      <DrawerSection title={`LINKED ENTITIES (${f.linkedEntityIds.length})`}>
        <div className="flex flex-wrap gap-1">
          {f.linkedEntityIds.map((id) => (
            <span key={id} className="mono border border-hairline px-1.5 py-0.5 text-caption text-numeric">
              {id}
            </span>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection title="DECISION">
        <KV k="Created" v={f.createdAt.slice(0, 19) + "Z"} mono />
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)…"
          className="mt-2 h-20 w-full resize-none border border-hairline bg-base p-2 text-caption text-primary placeholder:text-dim focus:border-cyan focus:outline-none"
        />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            onClick={() => submit("accepted")}
            disabled={decide.isPending}
            className="flex h-8 items-center justify-center gap-1 border border-cyan/50 bg-cyan/10 text-label text-cyan hover:bg-cyan/20 disabled:opacity-50 cursor-pointer rounded-sm"
          >
            <Check size={12} strokeWidth={1.5} /> ACCEPT
          </button>
          <button
            onClick={() => submit("rejected")}
            disabled={decide.isPending}
            className="flex h-8 items-center justify-center gap-1 border border-hot/50 bg-hot/10 text-label text-hot hover:bg-hot/20 disabled:opacity-50 cursor-pointer rounded-sm"
          >
            <X size={12} strokeWidth={1.5} /> REJECT
          </button>
          <button
            onClick={() => submit("in-review")}
            disabled={decide.isPending}
            className="flex h-8 items-center justify-center gap-1 border border-hairline-hot text-label text-muted hover:text-primary hover:bg-hover disabled:opacity-50 cursor-pointer rounded-sm"
          >
            <Edit3 size={12} strokeWidth={1.5} /> REVIEW
          </button>
        </div>
      </DrawerSection>
    </Drawer>
  );
}

function SwarmBar({ accept, reject, abstain, k }: { accept: number; reject: number; abstain: number; k: number }) {
  const total = k;
  const a = (accept / total) * 100;
  const r = (reject / total) * 100;
  const ab = (abstain / total) * 100;
  return (
    <div className="flex h-2 w-full overflow-hidden border border-hairline">
      <div className="bg-cyan" style={{ width: `${a}%` }} />
      <div className="bg-hot" style={{ width: `${r}%` }} />
      <div className="bg-muted" style={{ width: `${ab}%` }} />
    </div>
  );
}
