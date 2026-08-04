export function getPcmF32DurationMs(byteLength: number, sampleRate: number): number {
  if (byteLength <= 0 || sampleRate <= 0) {
    return 0;
  }

  return (byteLength / Float32Array.BYTES_PER_ELEMENT / sampleRate) * 1000;
}

export function estimateRms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  const stride = Math.max(1, Math.floor(samples.length / 2048));

  for (let index = 0; index < samples.length; index += stride) {
    const sample = samples[index] ?? 0;
    sumSquares += sample * sample;
  }

  const measuredSamples = Math.ceil(samples.length / stride);
  return Math.sqrt(sumSquares / measuredSamples);
}

