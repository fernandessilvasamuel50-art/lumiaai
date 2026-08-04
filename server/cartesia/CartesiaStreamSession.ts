import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import {
  MAX_SPEED,
  MIN_SPEED,
  OUTPUT_CONTAINER,
  OUTPUT_ENCODING,
  clampNumber,
  type AudioOutputFormat,
  type StartVoiceRequest,
} from '../../src/shared/protocol.js';
import type { ServerConfig } from '../config/env.js';
import { assertCartesiaConfigured } from '../config/env.js';
import { cartesiaErrorToPortuguese, unknownErrorToPortuguese } from './errors.js';

type CartesiaChunkEvent = {
  type: 'chunk';
  data?: string;
  done: false;
  status_code?: number;
  step_time?: number;
  context_id: string;
};

type CartesiaDoneEvent = {
  type: 'done' | 'flush_done';
  done: boolean;
  status_code?: number;
  context_id: string;
};

type CartesiaErrorEvent = {
  type: 'error';
  done?: boolean;
  title?: string;
  message?: string;
  error_code?: string;
  status_code: number;
  context_id?: string;
};

type CartesiaEvent =
  | CartesiaChunkEvent
  | CartesiaDoneEvent
  | CartesiaErrorEvent
  | { type: 'timestamps'; done?: boolean }
  | { type: 'phoneme_timestamps'; done?: boolean };

export class CartesiaStreamSession {
  readonly runId = randomUUID();
  readonly outputFormat: AudioOutputFormat;

  private readonly contextId = randomUUID();
  private cartesiaSocket?: WebSocket;
  private startedAt = 0;
  private audioBytes = 0;
  private sentFirstChunk = false;
  private closed = false;

  constructor(
    private readonly config: ServerConfig,
    private readonly clientSocket: WebSocket,
    request: StartVoiceRequest,
  ) {
    this.outputFormat = {
      container: OUTPUT_CONTAINER,
      encoding: OUTPUT_ENCODING,
      sampleRate: request.sampleRate,
    };
  }

  start(request: StartVoiceRequest): void {
    try {
      assertCartesiaConfigured(this.config);
    } catch (error) {
      this.sendError(error);
      return;
    }

    this.startedAt = performance.now();
    this.sendJson({
      type: 'started',
      runId: this.runId,
      modelId: this.config.cartesiaModelId,
      voiceId: this.config.cartesiaVoiceId,
      apiVersion: this.config.cartesiaApiVersion,
      outputFormat: this.outputFormat,
      serverStartedAt: new Date().toISOString(),
    });

    const cartesiaUrl = new URL('wss://api.cartesia.ai/tts/websocket');
    cartesiaUrl.searchParams.set('cartesia_version', this.config.cartesiaApiVersion);

    const cartesiaSocket = new WebSocket(cartesiaUrl, {
      headers: {
        'Cartesia-Version': this.config.cartesiaApiVersion,
        'X-API-Key': this.config.cartesiaApiKey,
      },
      handshakeTimeout: 10000,
    });

    this.cartesiaSocket = cartesiaSocket;

    cartesiaSocket.on('open', () => {
      this.sendJson({ type: 'cartesia_connected', runId: this.runId });
      cartesiaSocket.send(JSON.stringify(this.buildGenerationRequest(request)));
    });

    cartesiaSocket.on('message', (data) => {
      this.handleCartesiaMessage(data);
    });

    cartesiaSocket.on('error', (error) => {
      this.sendError(error);
    });

    cartesiaSocket.on('close', () => {
      if (!this.closed && !this.sentFirstChunk) {
        this.sendJson({
          type: 'error',
          runId: this.runId,
          message: 'A conexão com a Cartesia foi encerrada antes de enviar áudio.',
        });
      }
      this.closed = true;
    });
  }

  stop(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.cancelCartesiaContext();
    this.cartesiaSocket?.close();
    this.sendJson({ type: 'stopped', runId: this.runId });
  }

  private buildGenerationRequest(request: StartVoiceRequest) {
    return {
      model_id: this.config.cartesiaModelId,
      transcript: request.transcript,
      voice: {
        mode: 'id',
        id: this.config.cartesiaVoiceId,
      },
      language: 'pt',
      context_id: this.contextId,
      output_format: {
        container: OUTPUT_CONTAINER,
        encoding: OUTPUT_ENCODING,
        sample_rate: request.sampleRate,
      },
      continue: false,
      max_buffer_delay_ms: 0,
      generation_config: {
        speed: clampNumber(request.speed, MIN_SPEED, MAX_SPEED),
      },
    };
  }

  private handleCartesiaMessage(data: WebSocket.RawData): void {
    if (this.closed) {
      return;
    }

    let event: CartesiaEvent;
    try {
      event = JSON.parse(data.toString('utf8')) as CartesiaEvent;
    } catch {
      this.sendJson({
        type: 'error',
        runId: this.runId,
        message: 'A Cartesia enviou uma resposta que o servidor local não conseguiu interpretar.',
      });
      this.stop();
      return;
    }

    if (event.type === 'chunk') {
      this.forwardAudioChunk(event);
      return;
    }

    if (event.type === 'done') {
      this.sendJson({
        type: 'done',
        runId: this.runId,
        generationElapsedMs: performance.now() - this.startedAt,
        audioBytes: this.audioBytes,
      });
      this.closed = true;
      this.cartesiaSocket?.close();
      return;
    }

    if (event.type === 'error') {
      this.sendJson({
        type: 'error',
        runId: this.runId,
        code: event.error_code,
        message: cartesiaErrorToPortuguese(event),
      });
      this.closed = true;
      this.cartesiaSocket?.close();
    }
  }

  private forwardAudioChunk(event: CartesiaChunkEvent): void {
    if (!event.data) {
      return;
    }

    const audio = Buffer.from(event.data, 'base64');
    this.audioBytes += audio.byteLength;

    if (!this.sentFirstChunk) {
      this.sentFirstChunk = true;
      this.sendJson({
        type: 'first_audio_chunk',
        runId: this.runId,
        elapsedMs: performance.now() - this.startedAt,
        chunkBytes: audio.byteLength,
      });
    }

    if (this.clientSocket.readyState === WebSocket.OPEN) {
      this.clientSocket.send(audio, { binary: true });
    }
  }

  private cancelCartesiaContext(): void {
    if (this.cartesiaSocket?.readyState === WebSocket.OPEN) {
      this.cartesiaSocket.send(
        JSON.stringify({
          context_id: this.contextId,
          cancel: true,
        }),
      );
    }
  }

  private sendError(error: unknown): void {
    this.sendJson({
      type: 'error',
      runId: this.runId,
      message: unknownErrorToPortuguese(error),
    });
    this.closed = true;
    this.cartesiaSocket?.close();
  }

  private sendJson(message: object): void {
    if (this.clientSocket.readyState === WebSocket.OPEN) {
      this.clientSocket.send(JSON.stringify(message));
    }
  }
}

