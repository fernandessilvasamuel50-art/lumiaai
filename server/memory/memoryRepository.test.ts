import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryRepository } from './memoryRepository.js';

describe('MemoryRepository', () => {
  let repository: MemoryRepository;

  beforeEach(() => {
    repository = new MemoryRepository(':memory:');
  });
  afterEach(() => repository.close());

  it('cria, recupera e deduplica memória com evidência', () => {
    const messageId = repository.addMessage({ turnId: crypto.randomUUID(), role: 'user', content: 'Samuel prefere café forte', source: 'typed' });
    const consolidation = {
      memoriesToCreate: [
        { content: 'Samuel prefere café forte.', type: 'preference' as const, confidence: 0.9, importance: 0.7, evidenceMessageIds: [messageId] },
      ],
      memoriesToUpdate: [],
      opinionUpdate: null,
      openLoopsToCreate: [],
      openLoopsToResolve: [],
    };
    repository.applyConsolidation(consolidation, [messageId]);
    repository.applyConsolidation(consolidation, [messageId]);
    expect(repository.retrieveContext('café forte').memories).toHaveLength(1);
  });

  it('versiona mudança de opinião e recupera a posição atual em nova conversa lógica', () => {
    const first = repository.addMessage({ turnId: crypto.randomUUID(), role: 'user', content: 'Tema de teste', source: 'typed' });
    const base = {
      memoriesToCreate: [], memoriesToUpdate: [], openLoopsToCreate: [], openLoopsToResolve: [],
      opinionUpdate: { topic: 'arquitetura', position: 'posição inicial', reason: 'evidência inicial', confidence: 0.7, evidenceMessageIds: [first], previousOpinionId: null },
    };
    const opinionId = repository.applyConsolidation(base, [first]).updatedOpinionId;
    repository.applyConsolidation(
      { ...base, opinionUpdate: { ...base.opinionUpdate, position: 'posição revista', reason: 'argumento melhor', previousOpinionId: opinionId } },
      [first],
    );
    expect(repository.retrieveContext('arquitetura').opinions[0]?.position).toBe('posição revista');
  });

  it('seleciona assuntos pendentes pela importância e tentativas', () => {
    const id = repository.addMessage({ turnId: crypto.randomUUID(), role: 'user', content: 'Há algo pendente', source: 'typed' });
    repository.applyConsolidation(
      {
        memoriesToCreate: [], memoriesToUpdate: [], opinionUpdate: null, openLoopsToResolve: [],
        openLoopsToCreate: [{ topic: 'pendência', description: 'acompanhar depois', importance: 0.9, evidenceMessageIds: [id] }],
      },
      [id],
    );
    expect(repository.getOpenLoops(1)[0]?.topic).toBe('pendência');
  });

  it('preserva memória depois de fechar e reabrir o banco', () => {
    repository.close();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumia-memory-test-'));
    const databasePath = path.join(directory, 'lumia.db');
    const first = new MemoryRepository(databasePath);
    const messageId = first.addMessage({ turnId: crypto.randomUUID(), role: 'user', content: 'evidência persistente', source: 'typed' });
    first.applyConsolidation(
      {
        memoriesToCreate: [{ content: 'Memória que sobrevive ao reinício.', type: 'fact', confidence: 0.9, importance: 0.8, evidenceMessageIds: [messageId] }],
        memoriesToUpdate: [], opinionUpdate: null, openLoopsToCreate: [], openLoopsToResolve: [],
      },
      [messageId],
    );
    first.close();
    const reopened = new MemoryRepository(databasePath);
    expect(reopened.retrieveContext('sobrevive reinício').memories[0]?.content).toContain('sobrevive');
    reopened.close();
    fs.rmSync(directory, { recursive: true, force: true });
    repository = new MemoryRepository(':memory:');
  });
});
