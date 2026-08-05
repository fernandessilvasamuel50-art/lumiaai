import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSpeechSegmentForTurn } from '../server/speech/speechGateway.js';

describe('arquitetura de zero falas roteirizadas', () => {
  it('rejeita literal encaminhado ao gateway de fala', () => {
    expect(() => assertSpeechSegmentForTurn('literal técnico', { turnId: crypto.randomUUID(), model: 'qwen3:8b', active: true })).toThrow('marca nominal');
  });

  it('Cartesia exige segmento nominal e proveniência autenticada', () => {
    const cartesia = read('server/cartesia/cartesiaStream.ts');
    const generated = read('server/speech/generatedSpeechText.ts');
    const orchestrator = read('server/pipeline/turnOrchestrator.ts');
    expect(cartesia).toContain('sendSegment(segment: GeneratedSpeechSegment)');
    expect(cartesia).toContain('assertSpeechSegmentForTurn');
    expect(generated).toContain('isAuthenticOllamaStreamChunk');
    expect(orchestrator).toContain('active.speechText.push(chunk)');
    expect(orchestrator).toContain('active.tts.sendSegment(segment)');
    expect(orchestrator).not.toMatch(/sendSegment\(\s*['"`]/);
  });

  it('frontend não acessa TTS nem segredo Cartesia', () => {
    const frontend = allFiles('src').map(read).join('\n');
    expect(frontend).not.toContain('CARTESIA_API_KEY');
    expect(frontend).not.toContain('CartesiaSpeechStream');
    expect(frontend).not.toContain('/tts/websocket');
  });

  it('não mantém coleções de falas prontas no bundle de produção', () => {
    const production = [...allFiles('server'), ...allFiles('src')].map(read).join('\n');
    expect(production).not.toMatch(/fallbackResponses|greetings|waitingPhrases|randomReactions/);
  });
});

function allFiles(directory: string): string[] {
  const root = path.resolve(process.cwd(), directory);
  return fs.readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts'))
    .map((name) => path.join(root, name));
}

function read(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}
