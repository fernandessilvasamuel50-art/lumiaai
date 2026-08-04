import { describe, expect, it } from 'vitest';
import { SpeechSegmenter } from './speechSegmenter.js';

describe('SpeechSegmenter', () => {
  const turnId = crypto.randomUUID();

  it('libera frases naturais e preserva concatenação e espaços exatamente', () => {
    const input = 'Primeira frase.  Segunda frase! Terceira';
    const segmenter = new SpeechSegmenter(turnId);
    const segments = [...segmenter.push('Primeira fra'), ...segmenter.push('se.  Segunda frase! '), ...segmenter.push('Terceira'), ...segmenter.flush()];
    expect(segments.map((item) => item.text).join('')).toBe(input);
    expect(segments.map((item) => item.text)).toEqual(['Primeira frase.  ', 'Segunda frase! ', 'Terceira']);
    expect(segments.every((item) => item.source === 'ollama_stream')).toBe(true);
  });

  it('não separa decimal nem abreviação', () => {
    const segmenter = new SpeechSegmenter(turnId);
    const input = 'O valor é 3.14, segundo o Dr. Silva. Agora terminou. ';
    expect(segmenter.push(input).map((item) => item.text)).toEqual(['O valor é 3.14, segundo o Dr. Silva. ', 'Agora terminou. ']);
  });

  it('faz flush final sem inventar pontuação', () => {
    const segmenter = new SpeechSegmenter(turnId);
    expect(segmenter.push('fragmento final')).toEqual([]);
    expect(segmenter.flush()[0]?.text).toBe('fragmento final');
  });

  it('descarta buffer e chunks tardios após cancelamento', () => {
    const segmenter = new SpeechSegmenter(turnId);
    segmenter.push('texto parcial');
    segmenter.cancel();
    expect(segmenter.flush()).toEqual([]);
    expect(segmenter.push(' atrasado')).toEqual([]);
  });
});
