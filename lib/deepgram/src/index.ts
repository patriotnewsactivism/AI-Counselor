import { deepgram } from "./client";

export { deepgram };

/**
 * Transcribes an audio buffer to text using Deepgram's Nova speech-to-text model.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const response = await deepgram.listen.v1.media.transcribeFile(
    { data: audioBuffer, contentType: mimeType },
    {
      model: "nova-3",
      smart_format: true,
      punctuate: true,
    },
  );

  if (!("results" in response)) {
    throw new Error("Deepgram transcription is still processing (async callback mode was not expected)");
  }

  const transcript =
    response.results.channels[0]?.alternatives?.[0]?.transcript;

  if (!transcript || transcript.trim().length === 0) {
    throw new Error("Could not understand the audio -- no speech detected");
  }

  return transcript.trim();
}

/**
 * Synthesizes speech from text using a warm, mature Deepgram Aura-2 voice.
 * Returns raw audio bytes (MP3) and the mime type.
 */
export async function synthesizeSpeech(
  text: string,
): Promise<{ audio: Buffer; mimeType: string }> {
  const binary = await deepgram.speak.v1.audio.generate({
    text,
    model: "aura-2-callista-en",
    encoding: "mp3",
  });

  const arrayBuffer = await binary.arrayBuffer();
  return { audio: Buffer.from(arrayBuffer), mimeType: "audio/mpeg" };
}
