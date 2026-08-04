import type { AudioOutputFormat } from '../../shared/protocol.js';

export type VoiceMetrics = {
  startedAtWallClock?: string;
  startedAtPerformanceMs?: number;
  firstAudioChunkMs?: number;
  playbackStartMs?: number;
  generationTotalMs?: number;
  estimatedAudioDurationMs?: number;
  modelId?: string;
  outputFormat?: AudioOutputFormat;
};

export function createInitialMetrics(startedAtPerformanceMs: number, startedAt = new Date()): VoiceMetrics {
  return {
    startedAtWallClock: startedAt.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    startedAtPerformanceMs,
  };
}

export function elapsedFromStart(startedAtPerformanceMs: number | undefined, markMs: number): number | undefined {
  if (startedAtPerformanceMs === undefined) {
    return undefined;
  }

  return Math.max(0, markMs - startedAtPerformanceMs);
}

export function formatMs(value: number | undefined): string {
  if (value === undefined) {
    return '—';
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  return `${(value / 1000).toFixed(2)} s`;
}

export function formatDuration(value: number | undefined): string {
  if (value === undefined) {
    return '—';
  }

  return `${(value / 1000).toFixed(2)} s`;
}

