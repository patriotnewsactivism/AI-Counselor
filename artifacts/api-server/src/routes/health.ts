import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { probeProviders } from "@workspace/gemini";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Reports which LLM providers are actually reachable, so a dead reply chain
 * can be diagnosed from a browser instead of by reading server logs.
 *
 * Deliberately unauthenticated: when the companion stops replying, the
 * fastest signal is one someone can fetch without a session token. It leaks
 * only which providers are configured and how they responded — never key
 * material. Results are cached so this can't be used to burn provider quota.
 */
const PROBE_CACHE_MS = 30_000;
let cached: { at: number; payload: unknown } | null = null;

router.get("/healthz/llm", async (_req, res): Promise<void> => {
  if (cached && Date.now() - cached.at < PROBE_CACHE_MS) {
    res.json(cached.payload);
    return;
  }

  const providers = await probeProviders();
  const payload = {
    checkedAt: new Date().toISOString(),
    healthy: providers.some((p) => p.ok),
    firstWorking: providers.find((p) => p.ok)?.name ?? null,
    providers,
  };

  cached = { at: Date.now(), payload };
  res.json(payload);
});

export default router;
