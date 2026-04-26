import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSseClient } from "@/adapters/sse/SseClientContext";
import { subscribeSimOperatorEvents } from "@/adapters/sse/sim-operator";
import { useOperatorSwarmsQuery } from "@/usecases";
import { qk } from "@/usecases/keys";
import { FishOperatorView } from "./FishOperatorView";

export function FishOperatorEntry() {
  const swarmsQuery = useOperatorSwarmsQuery();
  const [selectedSwarmId, setSelectedSwarmId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSwarmId && swarmsQuery.data?.swarms.length) {
      const running = swarmsQuery.data.swarms.find((s) => s.status === "running");
      setSelectedSwarmId(running?.id ?? swarmsQuery.data.swarms[0]?.id ?? null);
    }
  }, [selectedSwarmId, swarmsQuery.data]);

  const sseClient = useSseClient();
  const qc = useQueryClient();

  useEffect(() => {
    if (!selectedSwarmId) return;

    const sub = subscribeSimOperatorEvents(sseClient, selectedSwarmId, {
      onEvent: (event) => {
        if (event.event === "status") {
          qc.setQueryData(qk.operatorSwarmStatus(selectedSwarmId), event.data);
        } else if (event.event === "aggregate") {
          qc.setQueryData(qk.operatorSwarmClusters(selectedSwarmId), event.data);
        } else if (event.event === "terminals") {
          qc.setQueryData(
            qk.operatorSwarmTerminals(selectedSwarmId),
            event.data.terminals,
          );
        } else if (event.event === "done" || event.event === "error") {
          qc.invalidateQueries({ queryKey: qk.operatorSwarmStatus(selectedSwarmId) });
        }
      },
    });
    return () => sub.close();
  }, [selectedSwarmId, sseClient, qc]);

  if (!selectedSwarmId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <div className="text-cyan animate-pulse mono">AWAITING SWARM...</div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white">
      <FishOperatorView swarmId={selectedSwarmId} />
    </div>
  );
}
