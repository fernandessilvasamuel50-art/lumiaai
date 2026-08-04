import { describe, expect, it } from 'vitest';
import { elapsedFromStart, formatDuration, formatMs } from './voiceMetrics.js';

describe('voiceMetrics', () => {
  it('calcula latência a partir do início', () => {
    expect(elapsedFromStart(120, 245)).toBe(125);
  });

  it('nunca retorna latência negativa', () => {
    expect(elapsedFromStart(300, 250)).toBe(0);
  });

  it('formata milissegundos e duração', () => {
    expect(formatMs(undefined)).toBe('—');
    expect(formatMs(240)).toBe('240 ms');
    expect(formatMs(1250)).toBe('1.25 s');
    expect(formatDuration(2310)).toBe('2.31 s');
  });
});

