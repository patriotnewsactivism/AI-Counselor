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
 * NEW streaming voice pipeline (Grok STT/TTS), built ALONGSIDE the existing
 * one-shot HTTP `/conversations/:id/voice-messages` route -- nothing old has
 * been removed or rewired yet. This is the "Path A" replacement: it keeps
 * the exact same companion logic (getOrCreateProfile -> identifyOrEnrollSpeaker
 * -> runCompanionExchangePipelined), it just swaps the transport from
 * "upload one full blob, wait for one full reply blob" to a persistent
 * WebSocket that streams mic audio in and TTS audio out sentence-by-sentence.
 *
 * NOT YET LIVE-VERIFIED end-to-end with a real audio client -- do that
 * before cutting traffic over or deleting lib/deepgram.
 *
 * Protocol (server -> client JSON control frames, audio as binary frames):
 *   {type:"transcript", text, isFinal}      -- live STT transcript
 *   {type:"assistant-sentence", text}       -- about to stream audio for this sentence
 *   <binary audio frame(s), audio/mpeg>
 *   {type:"assistant-done"}                 -- reply finished
 *   {type:"error", message}
 * Client -> server:
 *   <binary PCM16LE audio frames>            -- mic audio, 16kHz mono
 *   {type:"barge-in"}                        -- stop current playback/synthesis
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
  if (url.pathname !== WS_PATH) return; // let other upgrade handlers (if any) deal with it

  const conversationIdRaw = url.searchParams.get("conversationId");
  const conversationId = conversationIdRaw ? Number(conversationIdRaw) : NaN;
  if (!conversationIdRaw || Number.isNaN(conversationId)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  // Cross-origin gotcha: the frontend (Vercel) and this API (Railway) are
  // different origins, and the frontend authenticates via a Clerk Bearer
  // token (session.getToken()), not cookies. Native browser WebSocket()
  // cannot send custom headers on the handshake, so the client must instead
  // pass the token as a query param -- inject it as a real Authorization
  // header on the raw request before running Clerk's normal verification,
  // so getAuth() below works exactly like it does for every HTTP route.
  const token = url.searchParams.get("token");
  if (token) {
    req.headers.authorization = `Bearer ${token}`;
  }

  // Clerk's auth normally runs as Express middleware on a real req/res cycle.
  // At the raw HTTP-upgrade stage there is no Express response object yet,
  // so we run clerkMiddleware() manually against this IncomingMessage with a
  // minimal stub Response, then read the result via getAuth().
  const stubRes = {
    setHeader() {
      return stubRes;
    },
    getHeader() {
      return undefined;
    },
    writeHead() {
      return stubRes;
    },
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

async function runVoiceStreamConnection(ws: WebSocket, ctx: ConnCtx): Promise<void> {
  const { userId, conversationId } = ctx;

  const conversation = await findOwnedConversation(conversationId, userId);
  if (!conversation) {
    ws.send(JSON.stringify({ type: "error", message: "Conversation not found" }));
    ws.close();
    return;
  }

  const profile = await getOrCreateProfile(userId);

  // Accumulate raw PCM for the CURRENT utterance so identifyOrEnrollSpeaker
  // still gets one full clip per turn, exactly like the old HTTP route --
  // speaker-ID logic itself is completely unchanged.
  let utteranceChunks: Buffer[] = [];
  let bargeIn = false;

  const stt = new GrokTranscriptionStream({
    sampleRate: 16000,
    onTranscript: (event: GrokTranscriptEvent) => {
      ws.send(JSON.stringify({ type: "transcript", text: event.text, isFinal: event.isFinal }));
      if (event.isFinal && event.text.trim().length > 0) {
        const audioBuffer = Buffer.concat(utteranceChunks);
        utteranceChunks = [];
        void handleFinalTranscript(event.text.trim(), audioBuffer);
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

  async function handleFinalTranscript(transcript: string, audioBuffer: Buffer): Promise<void> {
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
          .catch(() => {
            /* non-critical */
          });
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
        if (bargeIn) return; // client interrupted -- stop emitting further sentences
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
      if (msg.type === "barge-in") bargeIn = true;
    } catch {
      /* ignore malformed control frames */
    }
  });

  ws.on("close", () => {
    stt.close();
  });
}
