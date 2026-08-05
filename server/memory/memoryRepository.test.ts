import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TurnConsolidation } from '../../shared/schemas/cognition.js';
import { MemoryRepository } from './memoryRepository.js';

describe('MemoryRepository V0.3', () => {
  let repository: MemoryRepository;

  beforeEach(() => {
    repository = new MemoryRepository(':memory:');
  });
  afterEach(() => repository.close());

  it('cria, recupera e deduplica memória com evidência rastreável', () => {
    const messageId = addUser(repository, 'Preferência persistente');
    const consolidation = emptyConsolidation();
    consolidation.memoriesToCreate.push({
      content: 'Samuel prefere explicações diretas.', type: 'semantic_personal', confidence: 0.9, importance: 0.7, evidenceMessageIds: [messageId],
    });
    repository.applyConsolidation(consolidation, [messageId]);
    repository.applyConsolidation(consolidation, [messageId]);
    const retrieved = repository.retrieveContext('explicações diretas').memories;
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]?.sourceMessageIds).toContain(messageId);
  });

  it('preserva versão anterior ao aplicar correção direta', () => {
    const first = addUser(repository, 'Informação inicial');
    const create = emptyConsolidation();
    create.memoriesToCreate.push({ content: 'O projeto usa a versão dois.', type: 'episodic', confidence: 0.7, importance: 0.8, evidenceMessageIds: [first] });
    const memoryId = repository.applyConsolidation(create, [first]).createdMemoryIds[0]!;
    const correctionMessage = addUser(repository, 'Correção explícita');
    const correction = emptyConsolidation();
    correction.memoriesToRevise.push({
      id: memoryId, content: 'O projeto usa a versão três.', type: 'episodic', confidence: 0.9, importance: 0.9,
      evidenceMessageIds: [correctionMessage], contradictionKind: 'correction', reason: 'Correção direta registrada.',
    });
    repository.applyConsolidation(correction, [correctionMessage]);
    const inspected = repository.listMemories().find((item) => item.id === memoryId)!;
    expect(inspected.content).toContain('três');
    expect(inspected.history.some((revision) => revision.previousContent?.includes('dois'))).toBe(true);
  });

  it('versiona opinião e mantém somente a posição atual na recuperação', () => {
    const first = addUser(repository, 'Evidência inicial');
    const create = emptyConsolidation();
    create.opinionsToCreate.push({ topic: 'arquitetura', position: 'posição inicial', reason: 'evidência', confidence: 0.7, evidenceMessageIds: [first] });
    const opinionId = repository.applyConsolidation(create, [first]).opinionIds[0]!;
    const second = addUser(repository, 'Argumento posterior');
    const revise = emptyConsolidation();
    revise.opinionsToRevise.push({
      id: opinionId, topic: 'arquitetura', position: 'posição revista', reason: 'argumento melhor', confidence: 0.85,
      evidenceMessageIds: [second], relation: 'changed', changeReason: 'Nova evidência.',
    });
    repository.applyConsolidation(revise, [second]);
    expect(repository.retrieveContext('arquitetura').opinions[0]?.position).toBe('posição revista');
  });

  it('aplica lição no escopo e altera perfil gradualmente com evidência', () => {
    const id = addUser(repository, 'Feedback explícito');
    const consolidation = emptyConsolidation();
    consolidation.lessonsToCreate.push({
      scope: 'project', scopeKey: 'Lumia', lesson: 'Priorizar o diagnóstico antes da implementação.', evidenceMessageIds: [id], confidence: 0.9, evidenceStrength: 'explicit_feedback',
    });
    consolidation.selfModelUpdate = { traitUpdates: [{
      trait: 'directness', value: 0.9, reason: 'Feedback explícito', confidence: 0.95, evidenceMessageIds: [id], evidenceStrength: 'explicit_feedback',
    }] };
    const summary = repository.applyConsolidation(consolidation, [id]);
    expect(summary.lessonIds).toHaveLength(1);
    expect(repository.getSelfModel().communicationProfile.directness).toBe(0.65);
    expect(repository.retrieveContext('Lumia', { topic: 'Lumia' }).lessons[0]?.scope).toBe('project');
  });

  it('registra correção, incerteza e exclusão manual no histórico', () => {
    const id = addUser(repository, 'Fonte');
    const consolidation = emptyConsolidation();
    consolidation.memoriesToCreate.push({ content: 'Conteúdo inicial.', type: 'episodic', confidence: 0.8, importance: 0.6, evidenceMessageIds: [id] });
    const memoryId = repository.applyConsolidation(consolidation, [id]).createdMemoryIds[0]!;
    repository.reviseMemoryManually(memoryId, 'Conteúdo corrigido.', 'Auditoria manual');
    repository.markMemoryUncertain(memoryId, 'Necessita confirmação');
    repository.deleteMemory(memoryId, 'Exclusão consciente');
    const item = repository.listMemories().find((memory) => memory.id === memoryId)!;
    expect(item.status).toBe('superseded');
    expect(item.history.map((entry) => entry.action)).toEqual(expect.arrayContaining(['manual_correction', 'manual_uncertain', 'manual_delete']));
  });

  it('preserva continuidade após reabrir o banco', () => {
    repository.close();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumia-v03-memory-'));
    const databasePath = path.join(directory, 'lumia.db');
    const first = new MemoryRepository(databasePath);
    const id = addUser(first, 'Fonte persistente');
    const consolidation = emptyConsolidation();
    consolidation.memoriesToCreate.push({ content: 'Memória após reinício.', type: 'episodic', confidence: 0.9, importance: 0.8, evidenceMessageIds: [id] });
    first.applyConsolidation(consolidation, [id]);
    first.close();
    const reopened = new MemoryRepository(databasePath);
    expect(reopened.retrieveContext('reinício').memories[0]?.content).toContain('reinício');
    reopened.close();
    fs.rmSync(directory, { recursive: true, force: true });
    repository = new MemoryRepository(':memory:');
  });
});

function addUser(repository: MemoryRepository, content: string): string {
  return repository.addMessage({ turnId: crypto.randomUUID(), role: 'user', content, source: 'typed' });
}

function emptyConsolidation(): TurnConsolidation {
  return {
    memoriesToCreate: [], memoriesToRevise: [], opinionsToCreate: [], opinionsToRevise: [],
    lessonsToCreate: [], lessonsToRevise: [], openLoopsToCreate: [], openLoopsToResolve: [], selfModelUpdate: null,
  };
}
