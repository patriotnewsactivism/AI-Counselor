import express, { type Express } from "express";
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

export default app;
