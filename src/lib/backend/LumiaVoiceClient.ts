import type { LumiaClientMessage, LumiaServerJsonMessage, StartVoiceRequest } from '../../shared/protocol.js';

type LumiaVoiceClientHandlers = {
  onOpen?: () => void;
  onJson?: (message: LumiaServerJsonMessage) => void;
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
};

function getWebSocketUrl(): string {
  const configuredBase = import.meta.env.VITE_BACKEND_URL as string | undefined;

  if (configuredBase) {
    const url = new URL('/ws/tts', configuredBase);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/tts`;
}

export class LumiaVoiceClient {
  private socket?: WebSocket;

  start(request: StartVoiceRequest, handlers: LumiaVoiceClientHandlers): void {
    this.stop();

    const socket = new WebSocket(getWebSocketUrl());
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.addEventListener('open', () => {
      handlers.onOpen?.();
      this.send({ type: 'start', request });
    });

    socket.addEventListener('message', (event: MessageEvent<string | ArrayBuffer>) => {
      if (event.data instanceof ArrayBuffer) {
        handlers.onAudioChunk?.(event.data);
        return;
      }

      try {
        handlers.onJson?.(JSON.parse(event.data) as LumiaServerJsonMessage);
      } catch {
        handlers.onError?.(new Error('O servidor local enviou uma resposta inesperada.'));
      }
    });

    socket.addEventListener('error', () => {
      handlers.onError?.(new Error('Falha na conexão local de voz.'));
    });

    socket.addEventListener('close', () => {
      handlers.onClose?.();
    });
  }

  stop(): void {
    if (!this.socket) {
      return;
    }

    if (this.socket.readyState === WebSocket.OPEN) {
      this.send({ type: 'stop' });
    }

    this.socket.close();
    this.socket = undefined;
  }

  private send(message: LumiaClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

