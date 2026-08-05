import type { CognitiveBudget, RetrievedContext } from '../../shared/protocol/index.js';
import type { CognitiveFrame, MemoryType } from '../../shared/schemas/cognition.js';

export type KnowledgeRequest = {
  turnId: string;
  queries: string[];
  memoryTypes: MemoryType[];
  topic: string | null;
  frame: CognitiveFrame;
  budget: CognitiveBudget;
};

export type KnowledgeResult = {
  providerId: string;
  context: RetrievedContext;
  retrievedAt: string;
};

export interface KnowledgeProvider {
  readonly id: string;
  canHandle(request: KnowledgeRequest): Promise<boolean>;
  retrieve(request: KnowledgeRequest): Promise<KnowledgeResult>;
}
