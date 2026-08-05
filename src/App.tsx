import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BackendStatusResponse,
  CognitiveTurnState,
  HistoryItem,
  LumiaServerJsonMessage,
  MemoryInspectorItem,
  TurnPerformanceMetrics,
  TurnStatus,
} from '../shared/protocol/index.js';
import { isOllamaReady, MAX_PLAYBACK_VOLUME, MIN_PLAYBACK_VOLUME } from '../shared/protocol/index.js';
import { Conversation } from './components/Conversation/Conversation.js';
import { DeveloperPanel, type DeveloperTurnState } from './components/DeveloperPanel/DeveloperPanel.js';
import { SystemIndicators } from './components/SystemIndicators.js';
import { PcmStreamPlayer } from './lib/audio/PcmStreamPlayer.js';
import { LocalConnection, shouldAcceptTurnEvent } from './services/localConnection.js';
import './styles.css';

function emptyDeveloperTurn(): DeveloperTurnState {
  return { transcript: '', provenance: [], metrics: {}, errors: [] };
}

export default function App() {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [status, setStatus] = useState<TurnStatus | 'Pronta'>('Pronta');
  const [backend, setBackend] = useState<BackendStatusResponse | null>(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [localConnected, setLocalConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [volume, setVolume] = useState(1);
  const [level, setLevel] = useState(0);
  const [developerTurn, setDeveloperTurn] = useState<DeveloperTurnState>(emptyDeveloperTurn);
  const [memories, setMemories] = useState<MemoryInspectorItem[]>([]);
  const [initiativeBusy, setInitiativeBusy] = useState(false);
  const [ollamaBusy, setOllamaBusy] = useState(false);

  const connectionRef = useRef<LocalConnection | null>(null);
  const playerRef = useRef<PcmStreamPlayer | null>(null);
  const playerTurnIdRef = useRef<string | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const activeStartedAtRef = useRef(0);
  const serverCompletedRef = useRef(false);
  const serverDurationRef = useRef<number | undefined>(undefined);
  const finalizedTurnsRef = useRef(new Set<string>());
  const manualInitiativeRequestIdRef = useRef<string | null>(null);
  const volumeRef = useRef(volume);

  useEffect(() => {
    volumeRef.current = volume;
    playerRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const connection = new LocalConnection({
      onOpen: () => {
        setLocalConnected(true);
        setErrorMessage('');
        setDeveloperTurn((current) => ({
          ...current,
          errors: current.errors.filter((item) => !item.includes('conexão com o backend local')),
        }));
      },
      onClose: () => setLocalConnected(false),
      onJson: handleServerMessage,
      onAudio: (turnId, audio) => {
        if (shouldAcceptTurnEvent(activeTurnIdRef.current, turnId)) playerRef.current?.enqueue(audio);
      },
      onError: (error) => recordError(error.message),
    });
    connectionRef.current = connection;
    connection.connect();
    return () => connection.close();
    // Handlers read live mutable values from refs and intentionally belong to the initial connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error('status indisponível');
      setBackend((await response.json()) as BackendStatusResponse);
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshStatus(), 0);
    const interval = window.setInterval(() => void refreshStatus(), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refreshStatus]);

  async function preparePlayer(turnId: string): Promise<PcmStreamPlayer> {
    if (playerRef.current) await playerRef.current.stop();
    serverCompletedRef.current = false;
    serverDurationRef.current = undefined;
    const player = new PcmStreamPlayer({
      volume: volumeRef.current,
      onPlaybackStart: (scheduledAt) => {
        if (activeTurnIdRef.current !== turnId) return;
        const elapsedMs = Math.max(0, scheduledAt - activeStartedAtRef.current);
        setStatus('Falando');
        mergeMetrics({ playbackStartMs: elapsedMs });
        connectionRef.current?.send({ type: 'playback.started', turnId, elapsedMs });
      },
      onPlaybackEnd: () => {
        setLevel(0);
        if (activeTurnIdRef.current === turnId && serverCompletedRef.current) finishTurnMarker(turnId, false, serverDurationRef.current);
      },
      onLevel: setLevel,
    });
    playerRef.current = player;
    playerTurnIdRef.current = turnId;
    await player.resume();
    return player;
  }

  async function handleSend(): Promise<void> {
    const content = message.trim();
    if (!content) return;
    if (!localConnected) {
      recordError('Backend local desconectado.');
      setStatus('Erro');
      return;
    }
    if (activeTurnIdRef.current) await interruptLocalTurn(activeTurnIdRef.current);
    const turnId = crypto.randomUUID();
    activeTurnIdRef.current = turnId;
    activeStartedAtRef.current = performance.now();
    setStatus('Pensando');
    setErrorMessage('');
    setDeveloperTurn(emptyDeveloperTurn());
    setHistory((current) => [...current, { id: `local-${turnId}`, kind: 'user', text: content, createdAt: new Date().toISOString() }]);
    setMessage('');
    try {
      const player = await preparePlayer(turnId);
      if (!connectionRef.current?.send({ type: 'turn.start', turnId, message: content, sampleRate: player.sampleRate })) {
        throw new Error('Não foi possível enviar a mensagem ao backend local.');
      }
    } catch (error) {
      recordError(error instanceof Error ? error.message : 'Falha ao preparar áudio.');
      setStatus('Erro');
      activeTurnIdRef.current = null;
    }
  }

  async function handleStop(): Promise<void> {
    const turnId = activeTurnIdRef.current;
    if (!turnId) return;
    connectionRef.current?.send({ type: 'turn.cancel', turnId });
    await interruptLocalTurn(turnId);
  }

  async function interruptLocalTurn(turnId: string): Promise<void> {
    if (playerRef.current) {
      await playerRef.current.stop();
      playerRef.current = null;
      playerTurnIdRef.current = null;
    }
    setLevel(0);
    setStatus('Interrompido');
    finishTurnMarker(turnId, true);
  }

  function handleServerMessage(event: LumiaServerJsonMessage): void {
    if (event.type === 'connection.ready') {
      if (!activeTurnIdRef.current) setHistory(event.history);
      return;
    }
    if (event.type === 'memory.snapshot') {
      setMemories(event.memories);
      return;
    }
    if (event.type === 'initiative.evaluated') {
      setInitiativeBusy(false);
      if (manualInitiativeRequestIdRef.current === event.requestId) manualInitiativeRequestIdRef.current = null;
      if (event.initiate && event.turnId) {
        activeTurnIdRef.current = event.turnId;
        activeStartedAtRef.current = performance.now();
        void preparePlayer(event.turnId);
      } else if (playerRef.current) {
        void playerRef.current.stop();
        playerRef.current = null;
        playerTurnIdRef.current = null;
        setDeveloperTurn((current) => ({ ...current, errors: [...current.errors, `Iniciativa silenciosa: ${event.reason}`] }));
      }
      return;
    }
    if (event.type === 'error') {
      if (event.turnId && !shouldAcceptTurnEvent(activeTurnIdRef.current, event.turnId)) return;
      recordError(`${event.code}: ${event.message}${event.details ? ` (${event.details})` : ''}`);
      setStatus('Erro');
      if (event.turnId) void interruptPlayerAfterError(event.turnId);
      if (event.code.startsWith('OLLAMA_')) void refreshStatus();
      return;
    }
    if (!('turnId' in event)) return;
    if (event.type === 'turn.started' && !activeTurnIdRef.current) activeTurnIdRef.current = event.turnId;
    if (!shouldAcceptTurnEvent(activeTurnIdRef.current, event.turnId)) return;

    if (event.type === 'turn.started') {
      activeTurnIdRef.current = event.turnId;
      activeStartedAtRef.current = performance.now();
      setStatus('Pensando');
      setDeveloperTurn(emptyDeveloperTurn());
      if (playerTurnIdRef.current !== event.turnId) void preparePlayer(event.turnId);
    } else if (event.type === 'turn.state') {
      setDeveloperTurn((current) => ({ ...current, state: event.state }));
      setStatus(statusForState(event.state));
    } else if (event.type === 'cognition.perceived') {
      setDeveloperTurn((current) => ({ ...current, frame: event.frame, metrics: { ...current.metrics, perceptionMs: event.perceptionMs } }));
    } else if (event.type === 'cognition.completed') {
      setDeveloperTurn((current) => ({
        ...current,
        frame: event.frame,
        decision: event.decision,
        context: event.context,
        selfModel: event.selfModel,
        budget: event.budget,
        metrics: { ...current.metrics, deliberationMs: event.deliberationMs },
      }));
    } else if (event.type === 'response.reviewed') {
      setStatus('Revisando');
      setDeveloperTurn((current) => ({ ...current, review: event.review, metrics: { ...current.metrics, reviewMs: event.reviewMs } }));
    } else if (event.type === 'llm.first_token') {
      mergeMetrics({ firstTokenMs: event.elapsedMs });
    } else if (event.type === 'llm.segment') {
      setDeveloperTurn((current) => ({
        ...current,
        transcript: current.transcript + event.text,
        metrics: current.metrics.firstSegmentMs === undefined ? { ...current.metrics, firstSegmentMs: event.elapsedMs } : current.metrics,
      }));
    } else if (event.type === 'speech.provenance') {
      setDeveloperTurn((current) => ({ ...current, provenance: [...current.provenance, event.provenance] }));
    } else if (event.type === 'tts.first_audio') {
      mergeMetrics({ firstAudioMs: event.elapsedMs });
    } else if (event.type === 'playback.started') {
      setStatus('Falando');
      mergeMetrics({ playbackStartMs: event.elapsedMs });
    } else if (event.type === 'turn.completed') {
      serverCompletedRef.current = true;
      serverDurationRef.current = event.durationMs;
      setDeveloperTurn((current) => ({ ...current, transcript: event.transcript, metrics: event.metrics }));
      playerRef.current?.markStreamComplete();
      if (!playerRef.current || playerRef.current.estimatedAudioMs === 0 || playerRef.current.isIdle) finishTurnMarker(event.turnId, false, event.durationMs);
    } else if (event.type === 'turn.cancelled') {
      void interruptLocalTurn(event.turnId);
    } else if (event.type === 'memory.consolidated') {
      setDeveloperTurn((current) => ({
        ...current,
        consolidation: event.summary,
        metrics: { ...current.metrics, consolidationMs: event.consolidationMs },
      }));
    }
  }

  function mergeMetrics(metrics: Partial<TurnPerformanceMetrics>): void {
    setDeveloperTurn((current) => ({ ...current, metrics: { ...current.metrics, ...metrics } }));
  }

  function finishTurnMarker(turnId: string, interrupted: boolean, durationMs?: number): void {
    if (finalizedTurnsRef.current.has(turnId)) return;
    finalizedTurnsRef.current.add(turnId);
    setHistory((current) => [...current, { id: `lumia-${turnId}`, kind: 'lumia', createdAt: new Date().toISOString(), durationMs, interrupted }]);
    if (activeTurnIdRef.current === turnId) activeTurnIdRef.current = null;
    setStatus(interrupted ? 'Interrompido' : 'Concluído');
  }

  async function interruptPlayerAfterError(turnId: string): Promise<void> {
    if (playerRef.current) await playerRef.current.stop();
    playerRef.current = null;
    playerTurnIdRef.current = null;
    setLevel(0);
    if (activeTurnIdRef.current === turnId) activeTurnIdRef.current = null;
  }

  function recordError(text: string): void {
    setErrorMessage(text);
    setDeveloperTurn((current) => ({ ...current, errors: [...current.errors, text] }));
  }

  async function evaluateInitiative(): Promise<void> {
    setInitiativeBusy(true);
    const requestId = crypto.randomUUID();
    manualInitiativeRequestIdRef.current = requestId;
    try {
      const temporary = await preparePlayer(requestId);
      if (!connectionRef.current?.send({ type: 'initiative.evaluate', requestId, sampleRate: temporary.sampleRate })) throw new Error('Backend local desconectado.');
    } catch (error) {
      setInitiativeBusy(false);
      recordError(error instanceof Error ? error.message : 'Falha na avaliação de iniciativa.');
    }
  }

  async function runOllamaAction(action: 'start' | 'retry'): Promise<void> {
    setOllamaBusy(true);
    setErrorMessage('');
    try {
      const response = await fetch(`/api/ollama/${action}`, { method: 'POST' });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'A operação do Ollama falhou.');
      await refreshStatus();
    } catch (error) {
      recordError(error instanceof Error ? error.message : 'Falha técnica ao gerenciar o Ollama.');
    } finally {
      setOllamaBusy(false);
    }
  }

  const busy = ['Pensando', 'Recuperando contexto', 'Formando resposta', 'Revisando', 'Falando'].includes(status);
  const ollama = backend?.ollama;
  return (
    <main className="app-shell">
      <header className="app-header">
        <div><span className="eyebrow">Cognitive OS · local</span><h1>Lumia</h1></div>
        <SystemIndicators backendOnline={backendOnline} status={backend} />
      </header>

      {ollama?.state === 'model_missing' ? (
        <div className="technical-banner">Modelo ausente. Execute <code>{ollama.installCommand}</code><button type="button" onClick={() => void runOllamaAction('retry')}>Tentar novamente</button></div>
      ) : null}
      {ollama?.state === 'service_offline' || ollama?.state === 'executable_not_found' ? (
        <div className="technical-banner">
          <span>{ollama.state === 'executable_not_found' ? 'Executável do Ollama não encontrado.' : 'Serviço Ollama desligado.'}</span>
          {ollama.state === 'service_offline' && ollama.canStart ? <button type="button" disabled={ollamaBusy} onClick={() => void runOllamaAction('start')}>Iniciar Ollama</button> : null}
          <button type="button" disabled={ollamaBusy} onClick={() => void runOllamaAction('retry')}>Tentar novamente</button>
        </div>
      ) : null}
      {ollama?.state === 'starting' || ollama?.state === 'model_loading' ? <div className="technical-banner">{ollama.state === 'starting' ? 'Ollama iniciando…' : `Carregando ${ollama.model}…`}</div> : null}
      {ollama?.state === 'endpoint_invalid' || ollama?.state === 'model_error' ? (
        <div className="error-banner">{ollama.state === 'endpoint_invalid' ? ollama.technicalMessage : ollama.technicalMessage}<button type="button" onClick={() => void runOllamaAction('retry')}>Tentar novamente</button></div>
      ) : null}
      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      <Conversation
        history={history}
        message={message}
        status={status}
        busy={busy}
        level={level}
        onMessageChange={(value) => {
          setMessage(value);
          connectionRef.current?.send({ type: 'activity' });
        }}
        onSend={() => void handleSend()}
        onStop={() => void handleStop()}
      />

      <DeveloperPanel
        turn={developerTurn}
        backend={backend}
        memories={memories}
        volume={Math.min(MAX_PLAYBACK_VOLUME, Math.max(MIN_PLAYBACK_VOLUME, volume))}
        initiativeBusy={initiativeBusy}
        onVolume={setVolume}
        onEvaluateInitiative={() => void evaluateInitiative()}
        onSearchMemories={(query, memoryType) => connectionRef.current?.send({ type: 'memory.list', query, memoryType })}
        onReviseMemory={(memoryId, content, reason) => connectionRef.current?.send({ type: 'memory.revise', memoryId, content, reason })}
        onMarkMemoryUncertain={(memoryId, reason) => connectionRef.current?.send({ type: 'memory.mark_uncertain', memoryId, reason })}
        onDeleteMemory={(memoryId, reason) => connectionRef.current?.send({ type: 'memory.delete', memoryId, reason })}
      />
      {!isOllamaReady(ollama) && backendOnline ? <span className="sr-only">Ollama ainda não está pronto.</span> : null}
    </main>
  );
}

function statusForState(state: CognitiveTurnState): TurnStatus {
  if (state === 'RETRIEVING') return 'Recuperando contexto';
  if (state === 'DELIBERATING' || state === 'PERCEIVING' || state === 'RECEIVED') return 'Pensando';
  if (state === 'GENERATING' || state === 'WAITING_FOR_CLARIFICATION') return 'Formando resposta';
  if (state === 'SPEAKING' || state === 'CONSOLIDATING') return 'Falando';
  if (state === 'COMPLETED') return 'Concluído';
  if (state === 'CANCELLED') return 'Interrompido';
  return 'Erro';
}
