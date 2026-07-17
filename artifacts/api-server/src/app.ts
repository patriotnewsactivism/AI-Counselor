import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS — in production, restrict to your actual frontend domain via
// ALLOWED_ORIGINS="https://your-app.com,https://www.your-app.com"
const rawOrigins = process.env.ALLOWED_ORIGINS;
const corsOptions = rawOrigins
  ? {
      credentials: true,
      origin: rawOrigins.split(",").map((o) => o.trim()),
    }
  : {
      credentials: true,
      origin: true, // dev: allow any origin
    };

app.use(cors(corsOptions));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Standard Clerk middleware — uses CLERK_SECRET_KEY + CLERK_PUBLISHABLE_KEY
// from env — standard setup for a fixed custom domain.
app.use(clerkMiddleware());

app.use("/api", router);

// The Railway service is intentionally self-contained: it serves both the
// JSON API and the Vite-built SPA. Keep the API namespace above the static
// middleware so `/api/*` can never be swallowed by the SPA fallback.
const apiServerDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(apiServerDir, "../../ai-therapist/dist/public");

app.use(express.static(frontendDist));
app.get("/{*splat}", (_req, res, next) => {
  if (_req.path.startsWith("/api/")) {
    next();
    return;
  }

  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) next(err);
  });
});

export default app;
