/**
 * Self-contained MFCC (Mel-Frequency Cepstral Coefficient) feature
 * extraction -- pre-emphasis, framing, Hamming window, FFT, Mel filterbank,
 * log, DCT-II. No dependency (meyda, etc.) is used deliberately: this
 * sandbox has no way to safely regenerate pnpm-lock.yaml, so this ships as
 * plain TypeScript against Node's stdlib only.
 *
 * This is the "classical baseline" tier of voice biometrics, not a deep
 * neural embedding (ECAPA-TDNN/x-vector/etc.) -- weaker separation between
 * speakers than a production ASV system, but self-contained, fast, and
 * good enough as a second factor layered on top of a spoken challenge
 * phrase (which is the real replay/liveness defense here, not the MFCC
 * match by itself). See voiceAuth.ts route docstring for the full picture.
 */

const FRAME_MS = 25;
const HOP_MS = 10;
const NUM_MEL_FILTERS = 26;
const NUM_CEPSTRAL_COEFFS = 13;
const PRE_EMPHASIS = 0.97;

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` length must be a power of 2. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}
function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

/** Triangular Mel filterbank, precomputed per (sampleRate, fftSize) pair. */
function buildMelFilterbank(sampleRate: number, fftSize: number, numFilters: number): Float64Array[] {
  const nyquist = sampleRate / 2;
  const melMin = hzToMel(0);
  const melMax = hzToMel(nyquist);
  const melPoints = new Array(numFilters + 2)
    .fill(0)
    .map((_, i) => melMin + ((melMax - melMin) * i) / (numFilters + 1));
  const hzPoints = melPoints.map(melToHz);
  const bin = hzPoints.map((hz) => Math.floor(((fftSize + 1) * hz) / sampleRate));

  const filters: Float64Array[] = [];
  for (let m = 1; m <= numFilters; m++) {
    const filter = new Float64Array(fftSize / 2 + 1);
    const left = bin[m - 1];
    const center = bin[m];
    const right = bin[m + 1];
    for (let k = left; k < center; k++) {
      if (center > left) filter[k] = (k - left) / (center - left);
    }
    for (let k = center; k < right; k++) {
      if (right > center) filter[k] = (right - k) / (right - center);
    }
    filters.push(filter);
  }
  return filters;
}

/** DCT-II, keeping only the first `numCoeffs` outputs. */
function dct(input: number[], numCoeffs: number): number[] {
  const n = input.length;
  const output = new Array(numCoeffs).fill(0);
  for (let k = 0; k < numCoeffs; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += input[i] * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * n));
    }
    output[k] = sum * (k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n));
  }
  return output;
}

/**
 * Extracts a per-frame MFCC matrix from mono PCM samples, then pools it
 * (mean + standard deviation of each coefficient across all voiced frames)
 * into one fixed-length vector -- a standard "statistics pooling" approach
 * for turning a variable-length utterance into a comparable fixed template.
 * Returns a 2*NUM_CEPSTRAL_COEFFS-length vector (13 means + 13 std-devs).
 */
export function extractMfccStatVector(samples: Float64Array, sampleRate: number): number[] {
  if (samples.length < sampleRate * 0.3) {
    throw new Error("Recording too short -- need at least ~0.3s of audio");
  }

  // Pre-emphasis
  const emphasized = new Float64Array(samples.length);
  emphasized[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    emphasized[i] = samples[i] - PRE_EMPHASIS * samples[i - 1];
  }

  const frameSize = Math.round((FRAME_MS / 1000) * sampleRate);
  const hopSize = Math.round((HOP_MS / 1000) * sampleRate);
  const fftSize = nextPowerOfTwo(frameSize);
  const filterbank = buildMelFilterbank(sampleRate, fftSize, NUM_MEL_FILTERS);

  // Hamming window, precomputed for frameSize
  const window = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }

  const frames: number[][] = [];
  // Simple energy-based voice-activity gate: skip near-silent frames so a
  // template isn't diluted by leading/trailing silence in the recording.
  let frameEnergies: number[] = [];
  const rawFrames: Float64Array[] = [];

  for (let start = 0; start + frameSize <= emphasized.length; start += hopSize) {
    const frame = emphasized.subarray(start, start + frameSize);
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    frameEnergies.push(energy);
    rawFrames.push(frame);
  }

  if (rawFrames.length === 0) {
    throw new Error("Recording produced no analysis frames");
  }

  const maxEnergy = Math.max(...frameEnergies);
  const energyThreshold = maxEnergy * 0.02; // 2% of peak frame energy

  for (let f = 0; f < rawFrames.length; f++) {
    if (frameEnergies[f] < energyThreshold) continue; // skip silence

    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < frameSize; i++) re[i] = rawFrames[f][i] * window[i];

    fft(re, im);

    const powerSpectrum = new Float64Array(fftSize / 2 + 1);
    for (let i = 0; i < powerSpectrum.length; i++) {
      powerSpectrum[i] = (re[i] * re[i] + im[i] * im[i]) / fftSize;
    }

    const melEnergies = filterbank.map((filter) => {
      let sum = 0;
      for (let i = 0; i < filter.length; i++) sum += filter[i] * powerSpectrum[i];
      return Math.log(sum + 1e-10);
    });

    frames.push(dct(melEnergies, NUM_CEPSTRAL_COEFFS));
  }

  if (frames.length === 0) {
    throw new Error("No voiced frames detected -- recording may be silent");
  }

  const means = new Array(NUM_CEPSTRAL_COEFFS).fill(0);
  for (const frame of frames) {
    for (let c = 0; c < NUM_CEPSTRAL_COEFFS; c++) means[c] += frame[c];
  }
  for (let c = 0; c < NUM_CEPSTRAL_COEFFS; c++) means[c] /= frames.length;

  const variances = new Array(NUM_CEPSTRAL_COEFFS).fill(0);
  for (const frame of frames) {
    for (let c = 0; c < NUM_CEPSTRAL_COEFFS; c++) {
      const diff = frame[c] - means[c];
      variances[c] += diff * diff;
    }
  }
  const stddevs = variances.map((v) => Math.sqrt(v / frames.length));

  return [...means, ...stddevs];
}

export function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) throw new Error("Need at least one vector to average");
  const length = vectors[0].length;
  const result = new Array(length).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < length; i++) result[i] += vec[i];
  }
  return result.map((v) => v / vectors.length);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("Vector length mismatch");
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
