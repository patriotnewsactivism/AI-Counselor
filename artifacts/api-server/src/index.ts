import app from "./app";
import { logger } from "./lib/logger";
import { handleVoiceStreamUpgrade } from "./routes/conversations/voiceStream";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Streaming voice pipeline (Grok STT/TTS) rides the same HTTP server via a
// raw WebSocket upgrade -- kept separate from Express routing since it's a
// persistent duplex connection, not a request/response route.
server.on("upgrade", handleVoiceStreamUpgrade);
