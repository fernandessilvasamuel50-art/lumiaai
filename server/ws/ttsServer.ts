import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { MAX_SPEED, MIN_SPEED, type LumiaClientMessage } from '../../src/shared/protocol.js';
import type { ServerConfig } from '../config/env.js';
import { CartesiaStreamSession } from '../cartesia/CartesiaStreamSession.js';

function sendJson(socket: WebSocket, message: object): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function parseMessage(data: WebSocket.RawData): LumiaClientMessage | null {
  try {
    return JSON.parse(data.toString('utf8')) as LumiaClientMessage;
  } catch {
    return null;
  }
}

function validateStartMessage(message: LumiaClientMessage): string | null {
  if (message.type !== 'start') {
    return null;
  }

  if (!message.request.transcript.trim()) {
    return 'Digite um texto antes de iniciar a fala.';
  }

  if (message.request.speed < MIN_SPEED || message.request.speed > MAX_SPEED) {
    return `A velocidade precisa estar entre ${MIN_SPEED}x e ${MAX_SPEED}x.`;
  }

  if (!Number.isFinite(message.request.sampleRate) || message.request.sampleRate < 8000) {
    return 'A taxa de áudio informada pelo navegador não é válida.';
  }

  return null;
}

export function attachTtsWebSocketServer(httpServer: import('node:http').Server, config: ServerConfig): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);

    if (url.pathname !== '/ws/tts') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (socket: WebSocket) => {
    let currentSession: CartesiaStreamSession | null = null;

    sendJson(socket, {
      type: 'ready',
      backendTime: new Date().toISOString(),
    });

    socket.on('message', (data) => {
      const message = parseMessage(data);

      if (!message) {
        sendJson(socket, {
          type: 'error',
          message: 'O servidor local recebeu uma mensagem inválida.',
        });
        return;
      }

      if (message.type === 'stop') {
        currentSession?.stop();
        currentSession = null;
        return;
      }

      const validationError = validateStartMessage(message);
      if (validationError) {
        sendJson(socket, {
          type: 'error',
          message: validationError,
        });
        return;
      }

      currentSession?.stop();
      currentSession = new CartesiaStreamSession(config, socket, message.request);
      currentSession.start(message.request);
    });

    socket.on('close', () => {
      currentSession?.stop();
      currentSession = null;
    });
  });
}

