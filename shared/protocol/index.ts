import { z } from 'zod';
import type {
  CognitiveDecision,
  CognitiveFrame,
  CognitiveMode,
  MemoryType,
  ResponseReview,
} from '../schemas/cognition.js';

export const CARTESIA_API_VERSION = '2026-03-01';
export const CARTESIA_MODEL_ID = 'sonic-3.5';
export const DEFAULT_CARTESIA_VOICE_ID = '5c5ad5e7-1020-476b-8b91-fdcbe9cc313c';
export const OUTPUT_CONTAINER = 'raw';
export const OUTPUT_ENCODING = 'pcm_f32le';
export const AUDIO_TURN_ID_BYTES = 36;
export const MIN_PLAYBACK_VOLUME = 0;
export const MAX_PLAYBACK_VOLUME = 1.5;

export type LumiaTechnicalErrorCode =
  | 'OLLAMA_EXECUTABLE_NOT_FOUND'
  | 'OLLAMA_SERVICE_OFFLINE'
  | 'OLLAMA_START_TIMEOUT'
  | 'OLLAMA_MODEL_MISSING'
  | 'OLLAMA_MODEL_LOAD_FAILED'
  | 'OLLAMA_STREAM_FAILED'
  | 'OLLAMA_ENDPOINT_INVALID'
  | 'COGNITIVE_SCHEMA_INVALID'
  | 'MEMORY_RETRIEVAL_FAILED'
  | 'CARTESIA_UNAVAILABLE'
  | 'CARTESIA_STREAM_FAILED'
  | 'TURN_CANCELLED'
  | 'TURN_STATE_INVALID'
  | 'TURN_FAILED';

export type OllamaModelInfo = {
  name: string;
  size: number;
  digest?: string;
  parameterSize?: string;
  quantizationLevel?: string;
};

type OllamaStatusBase = { endpoint: string; checkedAt: string };

export type OllamaStatus =
  | (OllamaStatusBase & { state: 'checking' })
  | (OllamaStatusBase & { state: 'endpoint_invalid'; technicalMessage: string })
  | (OllamaStatusBase & { state: 'executable_not_found' })
  | (OllamaStatusBase & { state: 'service_offline'; executablePath?: string; canStart: boolean; technicalMessage?: string })
  | (OllamaStatusBase & { state: 'starting'; executablePath: string; elapsedMs: number })
  | (OllamaStatusBase & { state: 'model_missing'; version: string; requiredModel: string; models: OllamaModelInfo[]; installCommand: string })
  | (OllamaStatusBase & { state: 'model_loading'; version: string; model: string; models: OllamaModelInfo[] })
  | (OllamaStatusBase & { state: 'model_error'; version?: string; model: string; technicalMessage: string })
  | (OllamaStatusBase & { state: 'ready'; version: string; model: string; models: OllamaModelInfo[] })
  | (OllamaStatusBase & { state: 'ready_cpu'; version: string; model: string; models: OllamaModelInfo[]; processor: '100% CPU' })
  | (OllamaStatusBase & { state: 'ready_gpu'; version: string; model: string; models: OllamaModelInfo[]; processor: '100% GPU'; gpu?: string })
  | (OllamaStatusBase & { state: 'ready_mixed'; version: string; model: string; models: OllamaModelInfo[]; processor: string });

export function isOllamaReady(status: OllamaStatus | undefined): boolean {
  return Boolean(status && ['ready', 'ready_cpu', 'ready_gpu', 'ready_mixed'].includes(status.state));
}

export const turnStartMessageSchema = z.object({
  type: z.literal('turn.start'),
  turnId: z.string().uuid(),
  message: z.string().trim().min(1).max(12000),
  sampleRate: z.number().int().min(8000).max(192000),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  turnStartMessageSchema,
  z.object({ type: z.literal('turn.cancel'), turnId: z.string().uuid() }),
  z.object({ type: z.literal('initiative.evaluate'), requestId: z.string().uuid(), sampleRate: z.number().int().min(8000).max(192000) }),
  z.object({ type: z.literal('memory.list'), query: z.string().max(500).optional(), memoryType: z.string().max(80).optional() }),
  z.object({ type: z.literal('memory.revise'), memoryId: z.string().uuid(), content: z.string().trim().min(1).max(2400), reason: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('memory.mark_uncertain'), memoryId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('memory.delete'), memoryId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('playback.started'), turnId: z.string().uuid(), elapsedMs: z.number().nonnegative() }),
  z.object({ type: z.literal('activity') }),
]);

export type LumiaClientMessage = z.infer<typeof clientMessageSchema>;

export type CognitiveTurnState =
  | 'RECEIVED'
  | 'PERCEIVING'
  | 'RETRIEVING'
  | 'DELIBERATING'
  | 'GENERATING'
  | 'SPEAKING'
  | 'CONSOLIDATING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'TECHNICAL_ERROR'
  | 'WAITING_FOR_CLARIFICATION';

export type TurnStatus = 'Pensando' | 'Recuperando contexto' | 'Formando resposta' | 'Revisando' | 'Falando' | 'Concluído' | 'Interrompido' | 'Erro';

export type AudioOutputFormat = {
  container: typeof OUTPUT_CONTAINER;
  encoding: typeof OUTPUT_ENCODING;
  sampleRate: number;
};

export type BackendStatusResponse = {
  ok: true;
  cartesiaConfigured: boolean;
  databaseReady: boolean;
  ollama: OllamaStatus;
  voiceModel: string;
  outputEncoding: typeof OUTPUT_ENCODING;
};

export type RetrievedKnowledge = {
  id: string;
  type: MemoryType;
  content: string;
  sourceMessageIds: string[];
  confidence: number;
  importance: number;
  createdAt: string;
  updatedAt: string;
  relevanceScore: number;
  status: 'active' | 'superseded' | 'uncertain';
};

export type RetrievedOpinion = {
  id: string;
  topic: string;
  position: string;
  reason: string;
  confidence: number;
  sourceMessageIds: string[];
  createdAt: string;
  updatedAt: string;
  relevanceScore: number;
};

export type RetrievedOpenLoop = {
  id: string;
  topic: string;
  description: string;
  importance: number;
  sourceMessageIds: string[];
  createdAt: string;
  updatedAt: string;
  relevanceScore: number;
};

export type InteractionLesson = {
  id: string;
  scope: 'global' | 'topic' | 'project' | 'relationship';
  scopeKey: string | null;
  lesson: string;
  evidenceMessageIds: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
  active: boolean;
  relevanceScore: number;
  revisionHistory: Array<Record<string, unknown>>;
};

export type CommunicationProfile = {
  preferredVerbosity: number;
  warmth: number;
  directness: number;
  humor: number;
  playfulness: number;
  willingnessToChallenge: number;
};

export type LumiaSelfModel = {
  communicationProfile: CommunicationProfile;
  learnedPreferenceIds: string[];
  stableOpinionIds: string[];
  interactionLessonIds: string[];
  relationshipContext: Record<string, unknown>;
  revision: number;
  updatedAt: string;
};

export type RetrievedContext = {
  recentMessages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>;
  memories: RetrievedKnowledge[];
  opinions: RetrievedOpinion[];
  openLoops: RetrievedOpenLoop[];
  lessons: InteractionLesson[];
};

export type CognitiveBudget = {
  contextTokenBudget: number;
  contextCharacterBudget: number;
  decisionTokenLimit: number;
  responseTokenLimit: number;
  retrievalDepth: 'minimal' | 'normal' | 'deep';
  criticalReview: boolean;
  responseTemperature: number;
  timeoutMs: number;
};

export type TurnPerformanceMetrics = {
  healthCheckMs?: number;
  ollamaStartupMs?: number;
  modelLoadMs?: number;
  perceptionMs?: number;
  memoryRetrievalMs?: number;
  deliberationMs?: number;
  reviewMs?: number;
  firstTokenMs?: number;
  firstSegmentMs?: number;
  firstAudioMs?: number;
  playbackStartMs?: number;
  consolidationMs?: number;
  tokensPerSecond?: number;
  totalMs?: number;
  evalCount?: number;
  processor?: string;
};

export type HistoryItem =
  | { id: string; kind: 'user'; text: string; createdAt: string }
  | { id: string; kind: 'lumia'; createdAt: string; durationMs?: number; interrupted: boolean };

export type MemoryRevisionRecord = {
  id: string;
  action: string;
  previousContent: string | null;
  newContent: string | null;
  reason: string;
  evidenceMessageIds: string[];
  actor: 'cognitive_consolidation' | 'manual_inspector';
  createdAt: string;
};

export type MemoryInspectorItem = Omit<RetrievedKnowledge, 'relevanceScore'> & {
  source: string;
  history: MemoryRevisionRecord[];
};

export type SpeechProvenance = {
  turnId: string;
  source: 'ollama_stream';
  model: string;
  chunkSequence: number[];
  completed: boolean;
};

export type ConsolidationSummary = {
  createdMemoryIds: string[];
  revisedMemoryIds: string[];
  opinionIds: string[];
  lessonIds: string[];
  openLoopIds: string[];
  selfModelRevision: number | null;
};

type TurnEventBase = { turnId: string; at: string };

export type LumiaServerJsonMessage =
  | { type: 'connection.ready'; at: string; history: HistoryItem[] }
  | ({ type: 'turn.started'; origin: 'user' | 'initiative'; outputFormat: AudioOutputFormat } & TurnEventBase)
  | ({ type: 'turn.state'; state: CognitiveTurnState; previousState: CognitiveTurnState | null } & TurnEventBase)
  | ({ type: 'cognition.perceived'; frame: CognitiveFrame; perceptionMs: number } & TurnEventBase)
  | ({ type: 'cognition.completed'; decision: CognitiveDecision; frame: CognitiveFrame; context: RetrievedContext; selfModel: LumiaSelfModel; budget: CognitiveBudget; deliberationMs: number } & TurnEventBase)
  | ({ type: 'response.reviewed'; review: ResponseReview; reviewMs: number; revised: boolean } & TurnEventBase)
  | ({ type: 'llm.started'; model: string } & TurnEventBase)
  | ({ type: 'llm.first_token'; elapsedMs: number } & TurnEventBase)
  | ({ type: 'llm.segment'; text: string; elapsedMs: number } & TurnEventBase)
  | ({ type: 'speech.provenance'; provenance: SpeechProvenance } & TurnEventBase)
  | ({ type: 'tts.started' } & TurnEventBase)
  | ({ type: 'tts.first_audio'; elapsedMs: number } & TurnEventBase)
  | ({ type: 'playback.started'; elapsedMs: number } & TurnEventBase)
  | ({ type: 'turn.completed'; transcript: string; metrics: TurnPerformanceMetrics; durationMs: number } & TurnEventBase)
  | ({ type: 'turn.cancelled' } & TurnEventBase)
  | ({ type: 'memory.consolidated'; summary: ConsolidationSummary; consolidationMs: number } & TurnEventBase)
  | { type: 'initiative.evaluated'; requestId: string; initiate: boolean; reason: string; turnId?: string; at: string }
  | { type: 'memory.snapshot'; memories: MemoryInspectorItem[]; at: string }
  | ({ type: 'error'; code: LumiaTechnicalErrorCode | string; message: string; details?: string } & Partial<TurnEventBase>);

export function encodeAudioFrame(turnId: string, audio: Uint8Array): Uint8Array {
  if (turnId.length !== AUDIO_TURN_ID_BYTES) throw new Error('turnId de áudio inválido.');
  const header = new TextEncoder().encode(turnId);
  const frame = new Uint8Array(header.length + audio.length);
  frame.set(header, 0);
  frame.set(audio, header.length);
  return frame;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;
}

export function modeUsesRelationshipContext(mode: CognitiveMode): boolean {
  return mode === 'relationship_continuity' || mode === 'emotional_support' || mode === 'reflection';
}
