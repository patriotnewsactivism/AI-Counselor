/**
 * Minimal WAV (RIFF/PCM) reader. Deliberately dependency-free: the frontend
 * always encodes enrollment/verification audio to 16-bit PCM WAV before
 * sending it (see ai-therapist's voice-capture.ts), so the server only ever
 * needs to parse that one well-defined container -- no ffmpeg, no native
 * decoder, nothing that would touch pnpm-lock.yaml.
 */

export interface DecodedWav {
  sampleRate: number;
  channelCount: number;
  /** Mono samples, normalized to [-1, 1] -- stereo input is downmixed by averaging channels. */
  samples: Float64Array;
}

export function parseWav(buffer: Buffer): DecodedWav {
  if (buffer.length < 44) {
    throw new Error("Audio too short to be a valid WAV file");
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE (audio/wav) file");
  }

  let offset = 12;
  let fmt: {
    audioFormat: number;
    channelCount: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let dataStart = -1;
  let dataLength = -1;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkBodyStart = offset + 8;

    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkBodyStart),
        channelCount: buffer.readUInt16LE(chunkBodyStart + 2),
        sampleRate: buffer.readUInt32LE(chunkBodyStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkBodyStart + 14),
      };
    } else if (chunkId === "data") {
      dataStart = chunkBodyStart;
      dataLength = chunkSize;
    }

    // Chunks are word-aligned (padded to an even byte count).
    offset = chunkBodyStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt) throw new Error("WAV file has no fmt chunk");
  if (dataStart < 0) throw new Error("WAV file has no data chunk");
  if (fmt.audioFormat !== 1) throw new Error(`Unsupported WAV encoding (audioFormat=${fmt.audioFormat}), expected PCM`);
  if (fmt.bitsPerSample !== 16) throw new Error(`Unsupported bit depth (${fmt.bitsPerSample}), expected 16-bit PCM`);

  const safeDataLength = Math.min(dataLength, buffer.length - dataStart);
  const frameCount = Math.floor(safeDataLength / (2 * fmt.channelCount));
  const samples = new Float64Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let ch = 0; ch < fmt.channelCount; ch++) {
      const sampleOffset = dataStart + (i * fmt.channelCount + ch) * 2;
      sum += buffer.readInt16LE(sampleOffset) / 32768;
    }
    samples[i] = sum / fmt.channelCount;
  }

  return { sampleRate: fmt.sampleRate, channelCount: fmt.channelCount, samples };
}
