import {
  AUDIO_TURN_ID_BYTES,
  type LumiaClientMessage,
  type LumiaServerJsonMessage,
} from '../../shared/protocol/index.js';

export type LocalConnectionHandlers = {
  onOpen(): void;
  onClose(): void;
  onJson(message: LumiaServerJsonMessage): void;
  onAudio(turnId: string, audio: ArrayBuffer): void;
  onError(error: Error): void;
};

export function shouldAcceptTurnEvent(activeTurnId: string | null, eventTurnId: string | undefined): boolean {
  return eventTurnId === undefined || activeTurnId === eventTurnId;
}

export class LocalConnection {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private closedPermanently = false;

  constructor(private readonly handlers: LocalConnectionHandlers) {}

  connect(): void {
    this.closedPermanently = false;
    this.openSocket();
  }

  send(message: LumiaClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.closedPermanently = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
  }

  private openSocket(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    const socket = new WebSocket(getWebSocketUrl());
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.addEventListener('open', () => this.handlers.onOpen());
    socket.addEventListener('message', (event: MessageEvent<string | ArrayBuffer>) => {
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        if (bytes.byteLength <= AUDIO_TURN_ID_BYTES) return;
        const turnId = new TextDecoder('ascii').decode(bytes.subarray(0, AUDIO_TURN_ID_BYTES));
        this.handlers.onAudio(turnId, bytes.slice(AUDIO_TURN_ID_BYTES).buffer);
        return;
      }
      try {
        this.handlers.onJson(JSON.parse(event.data) as LumiaServerJsonMessage);
      } catch {
        this.handlers.onError(new Error('O backend enviou um evento local inválido.'));
      }
    });
    socket.addEventListener('error', () => this.handlers.onError(new Error('Falha na conexão com o backend local.')));
    socket.addEventListener('close', () => {
      this.handlers.onClose();
      if (!this.closedPermanently) {
        this.reconnectTimer = window.setTimeout(() => this.openSocket(), 1500);
      }
    });
  }
}

function getWebSocketUrl(): string {
  const configuredBase = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (configuredBase) {
    const url = new URL('/ws/conversation', configuredBase);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/conversation`;
}
