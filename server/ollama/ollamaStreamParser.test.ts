import { describe, expect, it } from 'vitest';
import { NdjsonStreamParser, OllamaStreamError } from './ollamaStreamParser.js';

describe('NdjsonStreamParser', () => {
  it('processa várias linhas e flush final', () => {
    const parser = new NdjsonStreamParser<{ value: string }>();
    expect(parser.push(Buffer.from('{"value":"a"}\n{"value":"b"'))).toEqual([{ value: 'a' }]);
    expect(parser.push(Buffer.from('}\n'))).toEqual([{ value: 'b' }]);
    expect(parser.finish()).toEqual([]);
  });

  it('preserva caractere UTF-8 dividido entre chunks', () => {
    const bytes = Buffer.from('{"value":"ação"}\n');
    const split = bytes.indexOf(0xc3) + 1;
    const parser = new NdjsonStreamParser<{ value: string }>();
    expect(parser.push(bytes.subarray(0, split))).toEqual([]);
    expect(parser.push(bytes.subarray(split))).toEqual([{ value: 'ação' }]);
  });

  it('rejeita erro no meio do stream', () => {
    const parser = new NdjsonStreamParser();
    expect(() => parser.push(Buffer.from('{não-json}\n'))).toThrow(OllamaStreamError);
  });
});
