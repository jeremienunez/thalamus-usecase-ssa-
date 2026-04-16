1. [auth.middleware.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/middleware/auth.middleware.ts#L1) + [admin.routes.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/routes/admin.routes.ts#L18) — **CRIT** — Admin protection is effectively disabled (`authenticate` hardcodes admin user; `requireRoles/requireTier` are no-ops), so `/admin/sweep/*` is publicly reachable. Fix: implement real authN/authZ (JWT/session validation + enforced role/tier checks returning 401/403).

2. [thalamus.routes.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/routes/thalamus.routes.ts#L76) — **HIGH** — Destructive route `DELETE /findings/:id` (and all Thalamus routes) has no auth gate at route level. Fix: add shared preHandler auth/role middleware for all Thalamus endpoints, especially mutation routes.

3. [server.ts](/home/jerem/interview-thalamus-sweep/apps/console-api/src/server.ts#L16) — **MED** — HTTP boundary validation is weak (`Number(req.query.*)` and unchecked `req.body.decision`), enabling NaN/Infinity/unbounded values and invalid status writes. Fix: apply zod/Fastify schemas with numeric bounds/enums for every query/body param.

4. [thalamus.controller.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/controllers/thalamus.controller.ts#L95) — **MED** — Unvalidated `Number(...)`/`BigInt(...)` conversions on query/params can throw and produce 500s on malformed input. Fix: validate/coerce with zod before conversion and return 400 on invalid IDs/numbers.

5. [fetcher-rss.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/sources/fetcher-rss.ts#L67) — **HIGH** — SSRF surface: `fetch(source.url)` uses DB-provided URL with no `safeFetch`/private-network checks/allowlist. Fix: enforce `safeFetch` + domain allowlist/denylist on all external fetchers.

6. [crawler.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/crawler.ts#L191) — **HIGH** — URLs extracted from model/web-search output are accepted and stored without SSRF validation, enabling poisoned URLs to flow downstream (including promotion). Fix: validate every discovered URL (`validateExternalUrl` + DNS/private-IP checks) before use/persistence.

7. [crawler.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/crawler.ts#L365) — **MED** — SSRF guard is partial: only pre-checks URL string; actual crawl path doesn’t enforce redirect-hop/DNS-rebinding protections from `safeFetch`. Fix: route crawler HTTP through redirect-aware SSRF-safe fetch logic.

8. [executor.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/executor.ts#L221) + [scout.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/scout.ts#L121) + [curator.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/curator.ts#L91) — **MED** — Prompt-injection guardrails are applied in cortex executor but not consistently in explorer scout/curator prompt assembly. Fix: apply `sanitizeText/sanitizeDataPayload` (or equivalent) before every LLM call path.

9. [sweep.repository.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/sweep.repository.ts#L15) + [satellite-sweep-chat.repository.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite-sweep-chat.repository.ts#L19) — **MED** — Redis keys/counters are global and not tenant-scoped, risking cross-tenant collisions/data bleed in shared Redis. Fix: namespace all keys by tenant/org/user context and enforce that context at repository boundary.

10. [fixture-transport.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/transports/fixture-transport.ts#L70) + [nano-caller.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/nano-caller.ts#L139) — **LOW** — Path traversal risk: fallback fixture name is concatenated into file path without basename validation (`../` can escape fixture dir). Fix: restrict fallback names to safe basename regex and reject path separators.

11. [index.ts](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/seed/index.ts#L183) — **LOW** — Secret exposure: seed script logs full `DATABASE_URL` (credentials can leak to logs/CI). Fix: mask credentials before logging (e.g., replace `//user:pass@` with `//***@`).

12. [server.ts](/home/jerem/interview-thalamus-sweep/apps/console-api/src/server.ts#L6) — **LOW** — CORS is effectively open (`origin: true`) and reflects arbitrary origins. Fix: restrict to explicit allowlisted origins and only enable credentials if required.

Checked SQL-injection hotspots you called out: `satellite.repository.ts` info_schema/raw usage re-whitelists column names before interpolation, so I did not find a new user-controlled SQLi path there.
