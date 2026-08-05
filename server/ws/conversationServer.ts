import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { clientMessageSchema, type LumiaServerJsonMessage } from '../../shared/protocol/index.js';
import type { CognitiveBudgetController } from '../cognition/cognitiveBudgetController.js';
import type { CognitiveModeSelector } from '../cognition/cognitiveModeSelector.js';
import type { DeliberationService } from '../cognition/deliberationService.js';
import type { ResponseGenerator } from '../cognition/responseGenerator.js';
import type { ResponseReviewer } from '../cognition/responseReviewer.js';
import type { SituationInterpreter } from '../cognition/situationInterpreter.js';
import type { TurnConsolidator } from '../cognition/turnConsolidator.js';
import type { ServerConfig } from '../config/env.js';
import type { InitiativeService } from '../initiative/initiativeService.js';
import type { KnowledgeProvider } from '../knowledge/knowledgeProvider.js';
import type { MemoryRepository } from '../memory/memoryRepository.js';
import { TurnOrchestrator } from '../pipeline/turnOrchestrator.js';

type Dependencies = {
  config: ServerConfig;
  repository: MemoryRepository;
  interpreter: SituationInterpreter;
  modeSelector: CognitiveModeSelector;
  budgetController: CognitiveBudgetController;
  knowledgeProvider: KnowledgeProvider;
  deliberator: DeliberationService;
  generator: ResponseGenerator;
  reviewer: ResponseReviewer;
  consolidator: TurnConsolidator;
  initiative: InitiativeService;
};

export function attachConversationWebSocketServer(httpServer: import('node:http').Server, dependencies: Dependencies): void {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    if (url.pathname !== '/ws/conversation') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (socket: WebSocket) => {
    let lastSampleRate = 44100;
    const sendJson = (message: LumiaServerJsonMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const orchestrator = new TurnOrchestrator(dependencies, {
      sendJson,
      sendAudio(frame) {
        if (socket.readyState === WebSocket.OPEN) socket.send(frame, { binary: true });
      },
    });
    sendJson({ type: 'connection.ready', at: new Date().toISOString(), history: dependencies.repository.getHistory() });

    const initiativeInterval = setInterval(() => {
      if (
        dependencies.config.initiativeEnabled &&
        !orchestrator.isActive &&
        orchestrator.millisecondsSinceActivity >= dependencies.config.initiativeIdleMinutes * 60_000
      ) {
        void orchestrator.evaluateInitiative(randomUUID(), lastSampleRate);
      }
    }, Math.min(60_000, dependencies.config.initiativeIdleMinutes * 30_000));

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        sendJson({ type: 'error', code: 'invalid_client_message', message: 'O backend não aceita áudio do navegador.', at: new Date().toISOString() });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch {
        sendJson({ type: 'error', code: 'invalid_client_message', message: 'Mensagem local não é JSON válido.', at: new Date().toISOString() });
        return;
      }
      const result = clientMessageSchema.safeParse(parsed);
      if (!result.success) {
        sendJson({ type: 'error', code: 'invalid_client_message', message: 'Mensagem local não corresponde ao protocolo.', details: result.error.message, at: new Date().toISOString() });
        return;
      }
      const message = result.data;
      if (message.type === 'turn.start') {
        lastSampleRate = message.sampleRate;
        orchestrator.startUserTurn(message);
      } else if (message.type === 'turn.cancel') {
        orchestrator.cancel(message.turnId);
      } else if (message.type === 'initiative.evaluate') {
        lastSampleRate = message.sampleRate;
        void orchestrator.evaluateInitiative(message.requestId, message.sampleRate);
      } else if (message.type === 'memory.list') {
        sendMemorySnapshot(sendJson, dependencies.repository, message.query, message.memoryType);
      } else if (message.type === 'memory.revise') {
        dependencies.repository.reviseMemoryManually(message.memoryId, message.content, message.reason);
        sendMemorySnapshot(sendJson, dependencies.repository);
      } else if (message.type === 'memory.mark_uncertain') {
        dependencies.repository.markMemoryUncertain(message.memoryId, message.reason);
        sendMemorySnapshot(sendJson, dependencies.repository);
      } else if (message.type === 'memory.delete') {
        dependencies.repository.deleteMemory(message.memoryId, message.reason);
        sendMemorySnapshot(sendJson, dependencies.repository);
      } else if (message.type === 'playback.started') {
        orchestrator.markPlaybackStarted(message.turnId, message.elapsedMs);
      } else if (message.type === 'activity') {
        orchestrator.touchActivity();
      }
    });

    socket.on('close', () => {
      clearInterval(initiativeInterval);
      orchestrator.cancel();
    });
  });
}

function sendMemorySnapshot(
  sendJson: (message: LumiaServerJsonMessage) => void,
  repository: MemoryRepository,
  query?: string,
  memoryType?: string,
): void {
  sendJson({ type: 'memory.snapshot', memories: repository.listMemories(query, memoryType), at: new Date().toISOString() });
}
