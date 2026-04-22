import type { FastifyReply, FastifyRequest } from "fastify";
import type { SimSwarmService } from "../services/sim-swarm.service";
import type { SimTerminalService } from "../services/sim-terminal.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { SimSwarmIdParamsSchema } from "../schemas/sim.schema";
import { notFound, parseBigIntId } from "./sim-controller.utils";
import {
  toSimFishTerminalActionDto,
  toSimFishTerminalDto,
} from "../transformers/sim-http.transformer";

type SimSwarmLookupPort = Pick<SimSwarmService, "findById">;
type SimTerminalRoutePort = Pick<
  SimTerminalService,
  "listTerminalsForSwarm" | "listTerminalActionsForSwarm"
>;

async function requireSwarmId(
  req: FastifyRequest<{ Params: unknown }>,
  reply: FastifyReply,
  swarmRepo: SimSwarmLookupPort,
): Promise<bigint | null> {
  const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
  if (params === null) return null;
  const swarmId = parseBigIntId(params.id, "swarmId");
  const swarm = await swarmRepo.findById(swarmId);
  if (!swarm) throw notFound("sim_swarm", swarmId);
  return swarmId;
}

export function simTerminalsController(
  swarmRepo: SimSwarmLookupPort,
  terminalRepo: SimTerminalRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const swarmId = await requireSwarmId(req, reply, swarmRepo);
    if (swarmId === null) return;
    const rows = await terminalRepo.listTerminalsForSwarm(swarmId);
    return rows.map(toSimFishTerminalDto);
  });
}

export function simTerminalActionsController(
  swarmRepo: SimSwarmLookupPort,
  terminalRepo: SimTerminalRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const swarmId = await requireSwarmId(req, reply, swarmRepo);
    if (swarmId === null) return;
    const rows = await terminalRepo.listTerminalActionsForSwarm(swarmId);
    return rows.map(toSimFishTerminalActionDto);
  });
}
