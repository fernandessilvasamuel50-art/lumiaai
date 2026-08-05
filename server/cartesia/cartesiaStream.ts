import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import {
  OUTPUT_CONTAINER,
  OUTPUT_ENCODING,
  encodeAudioFrame,
  type AudioOutputFormat,
} from '../../shared/protocol/index.js';
import type { ServerConfig } from '../config/env.js';
import { assertCartesiaConfigured } from '../config/env.js';
import type { GeneratedSpeechSegment } from '../speech/generatedSpeechText.js';
import { assertSpeechSegmentForTurn } from '../speech/speechGateway.js';
import { cartesiaErrorToPortuguese, unknownErrorToPortuguese } from './errors.js';

type CartesiaEvent = {
  type: 'chunk' | 'done' | 'flush_done' | 'error' | 'timestamps' | 'phoneme_timestamps';
  data?: string;
  done?: boolean;
  title?: string;
  message?: string;
  error_code?: string;
  status_code?: number;
  context_id?: string;
};

export type CartesiaHandlers = {
  onStarted: () => void;
  onFirstAudio: (elapsedMs: number) => void;
  onAudio: (frame: Uint8Array) => void;
  onError: (error: Error) => void;
};

export class CartesiaSpeechStream {
  readonly contextId = randomUUID();
  readonly outputFormat: AudioOutputFormat;
  private socket?: WebSocket;
  private opened = false;
  private finishedInput = false;
  private cancelled = false;
  private firstAudio = false;
  private readonly startedAt = performance.now();
  private resolveDone!: () => void;
  private rejectDone!: (error: Error) => void;
  private readonly donePromise = new Promise<void>((resolve, reject) => {
    this.resolveDone = resolve;
    this.rejectDone = reject;
  });

  constructor(
    private readonly config: ServerConfig,
    private readonly turnId: string,
    sampleRate: number,
    private readonly handlers: CartesiaHandlers,
    private readonly isCurrent: () => boolean = () => true,
  ) {
    this.outputFormat = { container: OUTPUT_CONTAINER, encoding: OUTPUT_ENCODING, sampleRate };
    void this.donePromise.catch(() => undefined);
  }

  async open(signal: AbortSignal): Promise<void> {
    assertCartesiaConfigured(this.config);
    if (signal.aborted) throw signal.reason;
    const url = new URL('wss://api.cartesia.ai/tts/websocket');
    url.searchParams.set('cartesia_version', this.config.cartesiaApiVersion);
    const socket = new WebSocket(url, {
      headers: { 'Cartesia-Version': this.config.cartesiaApiVersion, 'X-API-Key': this.config.cartesiaApiKey },
      handshakeTimeout: 10000,
    });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        socket.close();
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      socket.once('open', () => {
        signal.removeEventListener('abort', abort);
        this.opened = true;
        this.handlers.onStarted();
        resolve();
      });
      socket.once('error', (error) => {
        signal.removeEventListener('abort', abort);
        reject(new Error(unknownErrorToPortuguese(error)));
      });
    });

    socket.on('message', (data) => this.handleMessage(data));
    socket.on('error', (error) => this.fail(new Error(unknownErrorToPortuguese(error))));
    socket.on('close', () => {
      if (!this.cancelled && !this.finishedInput) this.fail(new Error('A conexão com a Cartesia foi encerrada durante a fala.'));
    });
  }

  async sendSegment(segment: GeneratedSpeechSegment): Promise<void> {
    assertSpeechSegmentForTurn(segment, {
      turnId: this.turnId,
      model: this.config.ollamaModel,
      active: !this.cancelled && !this.finishedInput && this.isCurrent(),
    });
    if (!segment.text || this.cancelled || this.finishedInput) return;
    await this.send({ ...this.baseRequest(), transcript: segment.text, continue: true });
  }

  async finish(): Promise<void> {
    if (this.cancelled || this.finishedInput) return;
    this.finishedInput = true;
    await this.send({ ...this.baseRequest(), transcript: '', continue: false });
  }

  waitForDone(): Promise<void> {
    return this.donePromise;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ context_id: this.contextId, cancel: true }));
    }
    this.socket?.close();
    this.resolveDone();
  }

  private baseRequest() {
    return {
      model_id: this.config.cartesiaModelId,
      voice: { mode: 'id', id: this.config.cartesiaVoiceId },
      language: 'pt',
      context_id: this.contextId,
      output_format: {
        container: this.outputFormat.container,
        encoding: this.outputFormat.encoding,
        sample_rate: this.outputFormat.sampleRate,
      },
      max_buffer_delay_ms: 0,
    };
  }

  private send(payload: object): Promise<void> {
    if (!this.opened || this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Canal Cartesia não está aberto.'));
    }
    return new Promise((resolve, reject) => {
      this.socket!.send(JSON.stringify(payload), (error) => (error ? reject(error) : resolve()));
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    if (this.cancelled) return;
    let event: CartesiaEvent;
    try {
      event = JSON.parse(data.toString('utf8')) as CartesiaEvent;
    } catch {
      this.fail(new Error('A Cartesia enviou um evento inválido.'));
      return;
    }
    if (event.context_id && event.context_id !== this.contextId) return;
    if (event.type === 'chunk' && event.data) {
      const audio = Buffer.from(event.data, 'base64');
      if (!this.firstAudio) {
        this.firstAudio = true;
        this.handlers.onFirstAudio(performance.now() - this.startedAt);
      }
      this.handlers.onAudio(encodeAudioFrame(this.turnId, audio));
      return;
    }
    if (event.type === 'done') {
      this.resolveDone();
      this.socket?.close();
      return;
    }
    if (event.type === 'error') {
      this.fail(new Error(cartesiaErrorToPortuguese(event)));
    }
  }

  private fail(error: Error): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.handlers.onError(error);
    this.rejectDone(error);
    this.socket?.close();
  }
}
