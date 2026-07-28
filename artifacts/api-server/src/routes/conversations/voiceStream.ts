import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { clerkMiddleware, getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, voiceProfilesTable } from "@workspace/db";
import { identifyOrEnrollSpeaker } from "@workspace/gemini";
import {
  GrokTranscriptionStream,
  synthesizeSpeechGrok,
  type GrokTranscriptEvent,
} from "@workspace/grok-voice";
import { getOrCreateProfile } from "../../lib/getOrCreateProfile";
import { runCompanionExchangePipelined } from "../../lib/companionExchange";
import { findOwnedConversation } from "./shared";
import { logger } from "../../lib/logger";

/**
 * Streaming voice pipeline (Grok STT/TTS) over a persistent WebSocket.
 *
 * Turn-taking: the mic keeps listening through pauses. Final STT segments
 * are accumulated until the wake word (default "over") is detected as a
 * sign-off at the end of the accumulated text. Only then is the combined
 * transcript sent to the companion exchange as one turn — preventing
 * fragmented responses to individual phrases.
 */

const WS_PATH = "/ws/voice-stream";

const wss = new WebSocketServer({ noServer: true });

interface ConnCtx {
  userId: string;
  conversationId: number;
}

export function handleVoiceStreamUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url ?? "", "http://internal");
  if (url.pathname !== WS_PATH) return;

  const conversationIdRaw = url.searchParams.get("conversationId");
  const conversationId = conversationIdRaw ? Number(conversationIdRaw) : NaN;
  if (!conversationIdRaw || Number.isNaN(conversationId)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const token = url.searchParams.get("token");
  if (token) {
    req.headers.authorization = `Bearer ${token}`;
  }

  const stubRes = {
    setHeader() { return stubRes; },
    getHeader() { return undefined; },
    writeHead() { return stubRes; },
    end() {},
  } as unknown as Response;

  clerkMiddleware()(req as unknown as Request, stubRes, () => {
    const auth = getAuth(req as unknown as Request);
    const userId = auth?.userId;
    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, { userId, conversationId } satisfies ConnCtx);
    });
  });
}

wss.on("connection", (ws: WebSocket, _req: IncomingMessage, ctx: ConnCtx) => {
  void runVoiceStreamConnection(ws, ctx).catch((err) => {
    logger.error({ err }, "voice-stream connection failed");
    try {
      ws.send(JSON.stringify({ type: "error", message: "Internal error" }));
    } catch {
      /* socket likely already closed */
    }
    ws.close();
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitOnTriggerWord(text: string, trigger: string): string | null {
  if (!trigger) return null;
  const match = new RegExp(`\\b${escapeRegExp(trigger)}\\b[.,!?]*\\s*$`, "i").exec(text);
  if (!match) return null;
  return text.slice(0, match.index).trim();
}

async function runVoiceStreamConnection(ws: WebSocket, ctx: ConnCtx): Promise<void> {
  const { userId, conversationId } = ctx;

  const conversation = await findOwnedConversation(conversationId, userId);
  if (!conversation) {
    ws.send(JSON.stringify({ type: "error", message: "Conversation not found" }));
    ws.close();
    return;
  }

  const profile = await getOrCreateProfile(userId);
  const wakeWord = (profile.wakeWord?.trim() || "over").trim().toLowerCase();

  let utteranceChunks: Buffer[] = [];
  let pendingTranscript = "";
  let bargeIn = false;
  let responding = false;

  const stt = new GrokTranscriptionStream({
    sampleRate: 16000,
    onTranscript: (event: GrokTranscriptEvent) => {
      ws.send(JSON.stringify({ type: "transcript", text: event.text, isFinal: event.isFinal }));
      if (event.isFinal && event.text.trim().length > 0) {
        const segment = event.text.trim();
        const combined = pendingTranscript
          ? `${pendingTranscript} ${segment}`.trim()
          : segment;

        const said = splitOnTriggerWord(combined, wakeWord);
        if (said !== null) {
          // Wake word detected — end the turn with the accumulated text.
          pendingTranscript = "";
          const audioBuffer = Buffer.concat(utteranceChunks);
          utteranceChunks = [];
          if (said) {
            void handleTurnComplete(said, audioBuffer);
          }
          // If said is empty (just "over" with nothing before it), keep listening.
        } else {
          // No wake word yet — accumulate and keep listening.
          pendingTranscript = combined;
        }
      }
    },
    onError: (err: Error) => {
      logger.warn({ err }, "Grok STT stream error");
      ws.send(JSON.stringify({ type: "error", message: "Speech recognition error" }));
    },
    onClose: () => {
      /* xAI-side socket closed; client socket lifecycle is independent */
    },
  });

  async function handleTurnComplete(transcript: string, audioBuffer: Buffer): Promise<void> {
    if (responding) return;
    responding = true;
    bargeIn = false;

    let speakerName: string | null = null;
    try {
      const enrolledProfiles = await db
        .select({
          id: voiceProfilesTable.id,
          name: voiceProfilesTable.name,
          sampleAudio: voiceProfilesTable.sampleAudio,
          sampleMimeType: voiceProfilesTable.sampleMimeType,
        })
        .from(voiceProfilesTable)
        .where(eq(voiceProfilesTable.userId, userId));

      const result = await identifyOrEnrollSpeaker({
        profiles: enrolledProfiles,
        newAudioBase64: audioBuffer.toString("base64"),
        newMimeType: "audio/pcm",
        transcript,
      });

      if (result.matchedProfileId !== null) {
        speakerName = result.matchedName;
        db.update(voiceProfilesTable)
          .set({ lastHeardAt: new Date() })
          .where(eq(voiceProfilesTable.id, result.matchedProfileId))
          .execute()
          .catch(() => { /* non-critical */ });
      } else if (result.introducedName) {
        speakerName = result.introducedName;
      }
    } catch (err) {
      logger.warn({ err }, "Speaker identification failed, continuing without it");
    }

    await runCompanionExchangePipelined(
      {
        conversationId,
        profile,
        userContent: transcript,
        speakerName,
      },
      (sentence: string) => {
        if (bargeIn) return;
        void (async () => {
          try {
            ws.send(JSON.stringify({ type: "assistant-sentence", text: sentence }));
            const { audio } = await synthesizeSpeechGrok(sentence);
            if (!bargeIn && ws.readyState === ws.OPEN) ws.send(audio);
          } catch (err) {
            logger.warn({ err }, "Grok TTS synthesis failed for sentence");
          }
        })();
      },
    );

    if (!bargeIn) ws.send(JSON.stringify({ type: "assistant-done" }));
    responding = false;
  }

  ws.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      utteranceChunks.push(buf);
      stt.sendAudio(buf);
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "barge-in") {
        bargeIn = true;
        pendingTranscript = "";
      }
    } catch {
      /* ignore malformed control frames */
    }
  });

  ws.on("close", () => {
    stt.close();
  });
}
