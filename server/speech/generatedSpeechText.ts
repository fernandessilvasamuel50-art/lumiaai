import type { SpeechProvenance } from '../../shared/protocol/index.js';
import { LumiaServerError } from '../errors.js';
import { isAuthenticOllamaStreamChunk, type OllamaStreamChunk } from '../ollama/ollamaClient.js';

declare const generatedSpeechTextBrand: unique symbol;
const generatedSpeechSegmentBrand: unique symbol = Symbol('GeneratedSpeechSegment');

export type GeneratedSpeechText = string & { readonly [generatedSpeechTextBrand]: 'GeneratedSpeechText' };

export type GeneratedSpeechSegment = Readonly<{
  text: GeneratedSpeechText;
  provenance: SpeechProvenance;
  [generatedSpeechSegmentBrand]: true;
}>;

type SequenceRange = { start: number; end: number; sequence: number };

const ABBREVIATIONS = new Set(['dr', 'dra', 'sr', 'sra', 'prof', 'profa', 'etc', 'ex', 'pág']);

export class GeneratedSpeechStream {
  private buffer = '';
  private ranges: SequenceRange[] = [];
  private cancelled = false;
  private lastSequence = 0;

  constructor(private readonly options: {
    turnId: string;
    model: string;
    signal: AbortSignal;
    isCurrent: () => boolean;
    preferredMaxLength?: number;
  }) {}

  push(chunk: OllamaStreamChunk): GeneratedSpeechSegment[] {
    this.assertActive();
    if (!isAuthenticOllamaStreamChunk(chunk)) throw new LumiaServerError('OLLAMA_STREAM_FAILED', 'Chunk sem autenticação do cliente Ollama.');
    if (chunk.turnId !== this.options.turnId || chunk.model !== this.options.model) {
      throw new LumiaServerError('TURN_CANCELLED', 'Chunk de outro turno ou modelo rejeitado.');
    }
    if (chunk.sequence <= this.lastSequence) throw new LumiaServerError('OLLAMA_STREAM_FAILED', 'Sequência de chunks inválida.');
    this.lastSequence = chunk.sequence;
    const start = this.buffer.length;
    this.buffer += chunk.text;
    this.ranges.push({ start, end: this.buffer.length, sequence: chunk.sequence });
    const segments: GeneratedSpeechSegment[] = [];
    while (true) {
      const boundary = this.findNaturalBoundary();
      if (boundary <= 0) break;
      segments.push(this.take(boundary));
    }
    return segments;
  }

  flush(): GeneratedSpeechSegment[] {
    this.assertActive();
    return this.buffer ? [this.take(this.buffer.length)] : [];
  }

  cancel(): void {
    this.cancelled = true;
    this.buffer = '';
    this.ranges = [];
  }

  get pendingText(): string {
    return this.buffer;
  }

  private assertActive(): void {
    if (this.cancelled || this.options.signal.aborted || !this.options.isCurrent()) {
      throw new LumiaServerError('TURN_CANCELLED', 'Texto de um turno cancelado ou vencido foi rejeitado.');
    }
  }

  private findNaturalBoundary(): number {
    const preferredMaxLength = this.options.preferredMaxLength ?? 360;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const char = this.buffer[index];
      if (!'.!?…'.includes(char ?? '')) continue;
      if (char === '.' && this.isNonTerminalPeriod(index)) continue;
      let end = index + 1;
      while (end < this.buffer.length && '.!?…'.includes(this.buffer[end] ?? '')) end += 1;
      while (end < this.buffer.length && `"'”’)]}`.includes(this.buffer[end] ?? '')) end += 1;
      if (end >= this.buffer.length || !/\s/.test(this.buffer[end] ?? '')) continue;
      while (end < this.buffer.length && /\s/.test(this.buffer[end] ?? '')) end += 1;
      return end;
    }
    if (this.buffer.length >= preferredMaxLength) {
      const floor = Math.floor(preferredMaxLength * 0.65);
      for (let index = Math.min(this.buffer.length - 1, preferredMaxLength); index >= floor; index -= 1) {
        if (/[,;:]|\s/.test(this.buffer[index] ?? '')) return index + 1;
      }
    }
    return -1;
  }

  private isNonTerminalPeriod(index: number): boolean {
    const previous = this.buffer[index - 1];
    const next = this.buffer[index + 1];
    if (/\d/.test(previous ?? '') && /\d/.test(next ?? '')) return true;
    const word = this.buffer.slice(0, index).match(/([\p{L}]+)$/u)?.[1]?.toLocaleLowerCase('pt-BR');
    return Boolean(word && ABBREVIATIONS.has(word));
  }

  private take(length: number): GeneratedSpeechSegment {
    const rawText = this.buffer.slice(0, length);
    const sequences = [...new Set(this.ranges.filter((range) => range.start < length && range.end > 0).map((range) => range.sequence))];
    this.buffer = this.buffer.slice(length);
    this.ranges = this.ranges
      .filter((range) => range.end > length)
      .map((range) => ({ ...range, start: Math.max(0, range.start - length), end: range.end - length }));
    return Object.freeze({
      text: rawText as GeneratedSpeechText,
      provenance: {
        turnId: this.options.turnId,
        source: 'ollama_stream',
        model: this.options.model,
        chunkSequence: sequences,
        completed: true,
      },
      [generatedSpeechSegmentBrand]: true,
    });
  }
}

export function isGeneratedSpeechSegment(value: unknown): value is GeneratedSpeechSegment {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Record<PropertyKey, unknown>)[generatedSpeechSegmentBrand] === true,
  );
}
