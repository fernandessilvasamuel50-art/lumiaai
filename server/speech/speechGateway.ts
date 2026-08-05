import type { AudioOutputFormat } from '../../shared/protocol/index.js';
import { LumiaServerError } from '../errors.js';
import { isGeneratedSpeechSegment, type GeneratedSpeechSegment } from './generatedSpeechText.js';

export interface SpeechGateway {
  readonly outputFormat: AudioOutputFormat;
  open(signal: AbortSignal): Promise<void>;
  sendSegment(segment: GeneratedSpeechSegment): Promise<void>;
  finish(): Promise<void>;
  waitForDone(): Promise<void>;
  cancel(): void;
}

export function assertSpeechSegmentForTurn(
  segment: unknown,
  expected: { turnId: string; model: string; active: boolean },
): asserts segment is GeneratedSpeechSegment {
  if (!isGeneratedSpeechSegment(segment)) throw new LumiaServerError('CARTESIA_STREAM_FAILED', 'O TTS rejeitou texto sem marca nominal de geração.');
  if (!expected.active) throw new LumiaServerError('TURN_CANCELLED', 'O TTS rejeitou texto de um turno vencido ou cancelado.');
  if (segment.provenance.source !== 'ollama_stream') throw new LumiaServerError('CARTESIA_STREAM_FAILED', 'O TTS rejeitou origem de fala inválida.');
  if (segment.provenance.turnId !== expected.turnId || segment.provenance.model !== expected.model) {
    throw new LumiaServerError('TURN_CANCELLED', 'O TTS rejeitou fala de outro turno ou modelo.');
  }
  if (!segment.provenance.completed || segment.provenance.chunkSequence.length === 0 || !segment.text) {
    throw new LumiaServerError('CARTESIA_STREAM_FAILED', 'O TTS rejeitou proveniência incompleta.');
  }
}
