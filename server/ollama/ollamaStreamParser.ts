export class OllamaStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaStreamError';
  }
}

export class NdjsonStreamParser<T> {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private buffer = '';

  push(chunk: Uint8Array): T[] {
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true });
      return this.drain(false);
    } catch (error) {
      throw new OllamaStreamError(`NDJSON UTF-8 inválido: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    }
  }

  finish(): T[] {
    try {
      this.buffer += this.decoder.decode();
      return this.drain(true);
    } catch (error) {
      throw new OllamaStreamError(`NDJSON incompleto: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    }
  }

  private drain(final: boolean): T[] {
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = final ? '' : (lines.pop() ?? '');
    const output: T[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      output.push(this.parseLine(line));
    }

    if (final && this.buffer.trim()) {
      output.push(this.parseLine(this.buffer));
      this.buffer = '';
    }
    return output;
  }

  private parseLine(line: string): T {
    try {
      return JSON.parse(line) as T;
    } catch {
      throw new OllamaStreamError('Ollama enviou uma linha NDJSON inválida.');
    }
  }
}

export async function* parseNdjsonStream<T>(stream: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = stream.getReader();
  const parser = new NdjsonStreamParser<T>();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of parser.push(value)) yield item;
    }
    for (const item of parser.finish()) yield item;
  } finally {
    reader.releaseLock();
  }
}
