export type LlmSpeechSegment = Readonly<{
  source: 'ollama_stream';
  turnId: string;
  text: string;
}>;

const ABBREVIATIONS = new Set(['dr', 'dra', 'sr', 'sra', 'prof', 'profa', 'etc', 'ex', 'pág']);

export class SpeechSegmenter {
  private buffer = '';
  private cancelled = false;

  constructor(private readonly turnId: string, private readonly preferredMaxLength = 360) {}

  push(text: string): LlmSpeechSegment[] {
    if (this.cancelled || !text) return [];
    this.buffer += text;
    const segments: LlmSpeechSegment[] = [];
    while (true) {
      const boundary = this.findNaturalBoundary();
      if (boundary <= 0) break;
      segments.push(this.take(boundary));
    }
    return segments;
  }

  flush(): LlmSpeechSegment[] {
    if (this.cancelled || !this.buffer) return [];
    return [this.take(this.buffer.length)];
  }

  cancel(): void {
    this.cancelled = true;
    this.buffer = '';
  }

  get pendingText(): string {
    return this.buffer;
  }

  private findNaturalBoundary(): number {
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

    if (this.buffer.length >= this.preferredMaxLength) {
      const floor = Math.floor(this.preferredMaxLength * 0.65);
      for (let index = Math.min(this.buffer.length - 1, this.preferredMaxLength); index >= floor; index -= 1) {
        if (/[,;:]|\s/.test(this.buffer[index] ?? '')) return index + 1;
      }
    }
    return -1;
  }

  private isNonTerminalPeriod(index: number): boolean {
    const previous = this.buffer[index - 1];
    const next = this.buffer[index + 1];
    if (/\d/.test(previous ?? '') && /\d/.test(next ?? '')) return true;
    const before = this.buffer.slice(0, index);
    const word = before.match(/([\p{L}]+)$/u)?.[1]?.toLocaleLowerCase('pt-BR');
    return Boolean(word && ABBREVIATIONS.has(word));
  }

  private take(length: number): LlmSpeechSegment {
    const text = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return { source: 'ollama_stream', turnId: this.turnId, text };
  }
}
