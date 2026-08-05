import { randomUUID } from 'node:crypto';
import { CognitiveBudgetController } from '../server/cognition/cognitiveBudgetController.js';
import { CognitiveModeSelector } from '../server/cognition/cognitiveModeSelector.js';
import { DeliberationService } from '../server/cognition/deliberationService.js';
import { SituationInterpreter } from '../server/cognition/situationInterpreter.js';
import { loadServerConfig } from '../server/config/env.js';
import { LumiaPromptBuilder } from '../server/config/lumiaPromptBuilder.js';
import { OllamaClient } from '../server/ollama/ollamaClient.js';
import type { LumiaSelfModel, RetrievedContext } from '../shared/protocol/index.js';

const config = loadServerConfig();
const ollama = new OllamaClient(config);
const prompts = new LumiaPromptBuilder();
const interpreter = new SituationInterpreter(ollama, prompts);
const deliberator = new DeliberationService(ollama, prompts);
const selector = new CognitiveModeSelector();
const budgetController = new CognitiveBudgetController();
const controller = new AbortController();
const turnId = randomUUID();
const currentMessage = 'Analise uma falha intermitente em um serviço local e indique a metodologia de diagnóstico.';
const context: RetrievedContext = { recentMessages: [], memories: [], opinions: [], openLoops: [], lessons: [] };
const selfModel: LumiaSelfModel = {
  communicationProfile: {
    preferredVerbosity: 0.5,
    warmth: 0.5,
    directness: 0.5,
    humor: 0.5,
    playfulness: 0.5,
    willingnessToChallenge: 0.5,
  },
  learnedPreferenceIds: [],
  stableOpinionIds: [],
  interactionLessonIds: [],
  relationshipContext: {},
  revision: 0,
  updatedAt: new Date(0).toISOString(),
};

const startedAt = performance.now();
const frame = await interpreter.interpret({ turnId, currentMessage, origin: 'user', recentMessages: [] }, controller.signal);
const perceptionMs = performance.now() - startedAt;
const profile = selector.select(frame);
const budget = budgetController.select(frame, profile);
const decision = await deliberator.deliberate({ currentMessage, frame, context, selfModel, profile, budget, origin: 'user' }, controller.signal);
const totalMs = performance.now() - startedAt;

console.log(JSON.stringify({
  ok: true,
  turnId,
  mode: frame.conversation.mode,
  expectedDepth: frame.conversation.expectedDepth,
  retrievalDepth: budget.retrievalDepth,
  criticalReview: budget.criticalReview,
  primaryAction: decision.responseStrategy.primaryAction,
  directSpeechRequired: decision.responseStrategy.primaryAction !== 'silence',
  perceptionMs: Math.round(perceptionMs),
  deliberationMs: Math.round(totalMs - perceptionMs),
  totalMs: Math.round(totalMs),
}, null, 2));
