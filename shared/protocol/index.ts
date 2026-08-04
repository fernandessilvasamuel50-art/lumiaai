import { z } from 'zod';
import type { CognitiveDecision } from '../schemas/cognition.js';

export const CARTESIA_API_VERSION = '2026-03-01';
export const CARTESIA_MODEL_ID = 'sonic-3.5';
export const DEFAULT_CARTESIA_VOICE_ID = '5c5ad5e7-1020-476b-8b91-fdcbe9cc313c';
export const OUTPUT_CONTAINER = 'raw';
export const OUTPUT_ENCODING = 'pcm_f32le';
export const AUDIO_TURN_ID_BYTES = 36;
export const MIN_PLAYBACK_VOLUME = 0;
export const MAX_PLAYBACK_VOLUME = 1.5;

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
  z.object({ type: z.literal('memory.list') }),
  z.object({ type: z.literal('memory.delete'), memoryId: z.string().uuid() }),
  z.object({ type: z.literal('playback.started'), turnId: z.string().uuid(), elapsedMs: z.number().nonnegative() }),
  z.object({ type: z.literal('activity') }),
]);

export type LumiaClientMessage = z.infer<typeof clientMessageSchema>;

export type TurnStatus = 'Pensando' | 'Formando resposta' | 'Falando' | 'Concluído' | 'Interrompido' | 'Erro';

export type AudioOutputFormat = {
  container: typeof OUTPUT_CONTAINER;
  encoding: typeof OUTPUT_ENCODING;
  sampleRate: number;
};

export type OllamaStatus = {
  available: boolean;
  modelInstalled: boolean;
  model: string;
  installCommand?: string;
  processor?: string;
  error?: string;
};

export type BackendStatusResponse = {
  ok: true;
  cartesiaConfigured: boolean;
  databaseReady: boolean;
  ollama: OllamaStatus;
  voiceModel: string;
  outputEncoding: typeof OUTPUT_ENCODING;
};

export type RetrievedMemory = {
  id: string;
  content: string;
  type: string;
  confidence: number;
  importance: number;
  updatedAt: string;
};

export type RetrievedOpinion = {
  id: string;
  topic: string;
  position: string;
  reason: string;
  confidence: number;
  updatedAt: string;
};

export type RetrievedOpenLoop = {
  id: string;
  topic: string;
  description: string;
  importance: number;
  updatedAt: string;
};

export type RetrievedContext = {
  recentMessages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>;
  memories: RetrievedMemory[];
  opinions: RetrievedOpinion[];
  openLoops: RetrievedOpenLoop[];
};

export type TurnPerformanceMetrics = {
  memoryRetrievalMs?: number;
  deliberationMs?: number;
  modelLoadMs?: number;
  firstTokenMs?: number;
  firstSegmentMs?: number;
  firstAudioMs?: number;
  playbackStartMs?: number;
  tokensPerSecond?: number;
  totalMs?: number;
  evalCount?: number;
  processor?: string;
};

export type HistoryItem =
  | { id: string; kind: 'user'; text: string; createdAt: string }
  | { id: string; kind: 'lumia'; createdAt: string; durationMs?: number; interrupted: boolean };

export type MemoryInspectorItem = RetrievedMemory & { sourceMessageIds: string[]; createdAt: string };

type TurnEventBase = { turnId: string; at: string };

export type LumiaServerJsonMessage =
  | { type: 'connection.ready'; at: string; history: HistoryItem[] }
  | ({ type: 'turn.started'; origin: 'user' | 'initiative'; outputFormat: AudioOutputFormat } & TurnEventBase)
  | ({ type: 'cognition.started' } & TurnEventBase)
  | ({ type: 'cognition.completed'; decision: CognitiveDecision; context: RetrievedContext; deliberationMs: number } & TurnEventBase)
  | ({ type: 'llm.started'; model: string } & TurnEventBase)
  | ({ type: 'llm.first_token'; elapsedMs: number } & TurnEventBase)
  | ({ type: 'llm.segment'; text: string; elapsedMs: number } & TurnEventBase)
  | ({ type: 'tts.started' } & TurnEventBase)
  | ({ type: 'tts.first_audio'; elapsedMs: number } & TurnEventBase)
  | ({ type: 'playback.started'; elapsedMs: number } & TurnEventBase)
  | ({ type: 'turn.completed'; transcript: string; metrics: TurnPerformanceMetrics; durationMs: number } & TurnEventBase)
  | ({ type: 'turn.cancelled' } & TurnEventBase)
  | ({ type: 'memory.consolidated'; createdMemoryIds: string[]; updatedOpinionId: string | null; openLoopIds: string[] } & TurnEventBase)
  | { type: 'initiative.evaluated'; requestId: string; initiate: boolean; reason: string; turnId?: string; at: string }
  | { type: 'memory.snapshot'; memories: MemoryInspectorItem[]; at: string }
  | ({ type: 'error'; code: string; message: string; details?: string } & Partial<TurnEventBase>);

export function encodeAudioFrame(turnId: string, audio: Uint8Array): Uint8Array {
  if (turnId.length !== AUDIO_TURN_ID_BYTES) {
    throw new Error('turnId de áudio inválido.');
  }
  const header = new TextEncoder().encode(turnId);
  const frame = new Uint8Array(header.length + audio.length);
  frame.set(header, 0);
  frame.set(audio, header.length);
  return frame;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;
}
