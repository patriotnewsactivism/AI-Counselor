/**
 * Records a short clip and returns it as 16-bit PCM WAV (base64), which is
 * the only format the api-server's Voice ID backend understands (see
 * artifacts/api-server/src/lib/wav.ts + mfcc.ts -- deliberately dependency-
 * free, so the server only parses one well-defined uncompressed container).
 *
 * Flow: MediaRecorder captures whatever the browser's default codec is
 * (webm/opus in Chrome/Firefox) -> AudioContext.decodeAudioData turns that
 * into raw PCM -> OfflineAudioContext resamples to 16kHz mono -> a small
 * hand-written WAV header wraps the samples. No server-side ffmpeg/decoder
 * needed at all.
 */

const TARGET_SAMPLE_RATE = 16000;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioContext = new AudioContextCtor();
  const decoded = await audioContext.decodeAudioData(arrayBuffer);

  // Downmix to mono + resample to TARGET_SAMPLE_RATE via an OfflineAudioContext.
  const durationSeconds = decoded.duration;
  const offlineContext = new OfflineAudioContext(1, Math.ceil(durationSeconds * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
  const source = offlineContext.createBufferSource();
  source.buffer = decoded;
  const merger = offlineContext.createChannelMerger(1);
  source.connect(merger);
  merger.connect(offlineContext.destination);
  source.start();
  const rendered = await offlineContext.startRendering();

  await audioContext.close();
  return encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export interface VoiceAuthRecorder {
  stop: () => Promise<{ audioBase64: string; mimeType: string }>;
}

/** Starts recording immediately; call the returned `stop()` to finish and get WAV/base64. */
export async function startVoiceAuthRecording(): Promise<VoiceAuthRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mediaRecorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve) => {
    mediaRecorder.onstop = () => resolve();
  });

  mediaRecorder.start();

  return {
    stop: async () => {
      mediaRecorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const rawBlob = new Blob(chunks, { type: mediaRecorder.mimeType });
      const wavBlob = await blobToWav(rawBlob);
      const audioBase64 = await blobToBase64(wavBlob);
      return { audioBase64, mimeType: "audio/wav" };
    },
  };
}
