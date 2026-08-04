import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('arquitetura de zero falas roteirizadas', () => {
  it('Cartesia recebe somente LlmSpeechSegment vindo do stream do Ollama', () => {
    const cartesia = read('server/cartesia/cartesiaStream.ts');
    const orchestrator = read('server/pipeline/turnOrchestrator.ts');
    expect(cartesia).toContain('sendSegment(segment: LlmSpeechSegment)');
    expect(cartesia).toContain("segment.source !== 'ollama_stream'");
    expect(orchestrator).toContain('active.segmenter.push(token)');
    expect(orchestrator).toContain('active.tts.sendSegment(segment)');
    expect(orchestrator).not.toMatch(/sendSegment\(\s*['"`]/);
  });

  it('frontend não envia transcrição nem recebe segredo Cartesia', () => {
    const frontend = allFiles('src').map(read).join('\n');
    expect(frontend).not.toContain('DEFAULT_TRANSCRIPT');
    expect(frontend).not.toContain('CARTESIA_API_KEY');
    expect(frontend).not.toContain('cartesiaApiKey');
    expect(frontend).not.toContain("type: 'start'");
  });

  it('não reintroduz coleções suspeitas de respostas prontas em produção', () => {
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
