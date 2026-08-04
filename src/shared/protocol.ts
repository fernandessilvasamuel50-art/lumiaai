export const CARTESIA_API_VERSION = '2026-03-01';
export const CARTESIA_MODEL_ID = 'sonic-3.5';
export const DEFAULT_CARTESIA_VOICE_ID = '5c5ad5e7-1020-476b-8b91-fdcbe9cc313c';
export const DEFAULT_TRANSCRIPT =
  'Samuel… eu pensei no que você falou, mas não. Dessa vez eu realmente não concordo com você.';

export const OUTPUT_CONTAINER = 'raw';
export const OUTPUT_ENCODING = 'pcm_f32le';
export const DEFAULT_SPEED = 1;
export const MIN_SPEED = 0.6;
export const MAX_SPEED = 1.5;
export const MIN_PLAYBACK_VOLUME = 0;
export const MAX_PLAYBACK_VOLUME = 1.5;

export type VoiceStatus =
  | 'Pronta'
  | 'Conectando'
  | 'Gerando'
  | 'Falando'
  | 'Concluído'
  | 'Erro';

export type AudioOutputFormat = {
  container: typeof OUTPUT_CONTAINER;
  encoding: typeof OUTPUT_ENCODING;
  sampleRate: number;
};

export type StartVoiceRequest = {
  transcript: string;
  speed: number;
  sampleRate: number;
  clientStartedAt: number;
};

export type LumiaClientMessage =
  | {
      type: 'start';
      request: StartVoiceRequest;
    }
  | {
      type: 'stop';
    };

export type BackendStatusResponse = {
  ok: true;
  cartesiaConfigured: boolean;
  modelId: string;
  voiceId: string;
  apiVersion: string;
  outputEncoding: typeof OUTPUT_ENCODING;
};

export type LumiaServerJsonMessage =
  | {
      type: 'ready';
      backendTime: string;
    }
  | {
      type: 'started';
      runId: string;
      modelId: string;
      voiceId: string;
      apiVersion: string;
      outputFormat: AudioOutputFormat;
      serverStartedAt: string;
    }
  | {
      type: 'cartesia_connected';
      runId: string;
    }
  | {
      type: 'first_audio_chunk';
      runId: string;
      elapsedMs: number;
      chunkBytes: number;
    }
  | {
      type: 'done';
      runId: string;
      generationElapsedMs: number;
      audioBytes: number;
    }
  | {
      type: 'stopped';
      runId?: string;
    }
  | {
      type: 'error';
      runId?: string;
      code?: string;
      message: string;
    };

export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

