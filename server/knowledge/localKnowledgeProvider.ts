import type { MemoryRepository } from '../memory/memoryRepository.js';
import type { KnowledgeProvider, KnowledgeRequest, KnowledgeResult } from './knowledgeProvider.js';

export class LocalKnowledgeProvider implements KnowledgeProvider {
  readonly id = 'local_sqlite';

  constructor(private readonly repository: MemoryRepository) {}

  async canHandle(): Promise<boolean> {
    return true;
  }

  async retrieve(request: KnowledgeRequest): Promise<KnowledgeResult> {
    const context = this.repository.retrieveContext(request.queries.join(' '), {
      characterBudget: request.budget.contextCharacterBudget,
      depth: request.budget.retrievalDepth,
      desiredTypes: request.memoryTypes,
      topic: request.topic,
      relationshipRelevant: request.frame.humanContext.relationshipRelevant,
    });
    return { providerId: this.id, context, retrievedAt: new Date().toISOString() };
  }
}
