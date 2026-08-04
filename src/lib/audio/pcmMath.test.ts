import { describe, expect, it } from 'vitest';
import { estimateRms, getPcmF32DurationMs } from './pcmMath.js';

describe('pcmMath', () => {
  it('calcula duração de PCM f32 em milissegundos', () => {
    const oneSecondBytes = 44100 * Float32Array.BYTES_PER_ELEMENT;
    expect(getPcmF32DurationMs(oneSecondBytes, 44100)).toBe(1000);
  });

  it('retorna zero para entradas vazias', () => {
    expect(getPcmF32DurationMs(0, 44100)).toBe(0);
    expect(estimateRms(new Float32Array())).toBe(0);
  });

  it('estima RMS de um sinal simples', () => {
    const samples = new Float32Array([1, -1, 1, -1]);
    expect(estimateRms(samples)).toBeCloseTo(1);
  });
});

