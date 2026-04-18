/**
 * Runtime config HTTP handlers — read/patch/reset per domain.
 *
 * GET    /api/config/runtime               → list all domains (defaults + overrides merged)
 * GET    /api/config/runtime/:domain       → single domain
 * PATCH  /api/config/runtime/:domain       → partial update (body = Partial<domain shape>)
 * DELETE /api/config/runtime/:domain       → reset to defaults (clears Redis overrides)
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  RuntimeConfigService,
  RuntimeConfigDomain,
  RuntimeConfigMap,
} from "../services/runtime-config.service";
import { ValidationError } from "../services/runtime-config.service";
import { RUNTIME_CONFIG_DOMAINS } from "@interview/shared/config";

function isDomain(d: string): d is RuntimeConfigDomain {
  return (RUNTIME_CONFIG_DOMAINS as string[]).includes(d);
}

export function listRuntimeConfigController(service: RuntimeConfigService) {
  return async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const out: Record<string, unknown> = {};
    for (const domain of RUNTIME_CONFIG_DOMAINS) {
      out[domain] = await service.get(domain);
    }
    reply.send({ domains: out });
  };
}

export function getRuntimeConfigController(service: RuntimeConfigService) {
  return async (
    req: FastifyRequest<{ Params: { domain: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { domain } = req.params;
    if (!isDomain(domain)) {
      reply.code(404).send({ error: `unknown domain: ${domain}` });
      return;
    }
    const value = await service.get(domain);
    reply.send({ domain, value });
  };
}

export function patchRuntimeConfigController(service: RuntimeConfigService) {
  return async (
    req: FastifyRequest<{
      Params: { domain: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { domain } = req.params;
    if (!isDomain(domain)) {
      reply.code(404).send({ error: `unknown domain: ${domain}` });
      return;
    }
    try {
      const updated = await service.update(
        domain,
        (req.body ?? {}) as Partial<RuntimeConfigMap[typeof domain]>,
      );
      reply.send({ domain, value: updated });
    } catch (err) {
      if (err instanceof ValidationError) {
        reply.code(400).send({ error: err.message });
        return;
      }
      throw err;
    }
  };
}

export function resetRuntimeConfigController(service: RuntimeConfigService) {
  return async (
    req: FastifyRequest<{ Params: { domain: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { domain } = req.params;
    if (!isDomain(domain)) {
      reply.code(404).send({ error: `unknown domain: ${domain}` });
      return;
    }
    const value = await service.reset(domain);
    reply.send({ domain, value });
  };
}
