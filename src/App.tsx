import { useEffect, useRef, useState } from 'react';
import type {
  BackendStatusResponse,
  HistoryItem,
  LumiaServerJsonMessage,
  MemoryInspectorItem,
  TurnPerformanceMetrics,
  TurnStatus,
} from '../shared/protocol/index.js';
import { MAX_PLAYBACK_VOLUME, MIN_PLAYBACK_VOLUME } from '../shared/protocol/index.js';
import { Conversation } from './components/Conversation/Conversation.js';
import { DeveloperPanel, type DeveloperTurnState } from './components/DeveloperPanel/DeveloperPanel.js';
import { SystemIndicators } from './components/SystemIndicators.js';
import { PcmStreamPlayer } from './lib/audio/PcmStreamPlayer.js';
import { LocalConnection, shouldAcceptTurnEvent } from './services/localConnection.js';
import './styles.css';

const EMPTY_DEVELOPER_TURN: DeveloperTurnState = { transcript: '', metrics: {}, errors: [] };

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
  const [developerTurn, setDeveloperTurn] = useState<DeveloperTurnState>(EMPTY_DEVELOPER_TURN);
  const [memories, setMemories] = useState<MemoryInspectorItem[]>([]);
  const [initiativeBusy, setInitiativeBusy] = useState(false);

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
    // The connection intentionally owns the first-render handlers; live values are held in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshStatus() {
      try {
        const response = await fetch('/api/status');
        if (!response.ok) throw new Error('status indisponível');
        const data = (await response.json()) as BackendStatusResponse;
        if (!cancelled) {
          setBackend(data);
          setBackendOnline(true);
        }
      } catch {
        if (!cancelled) setBackendOnline(false);
      }
    }
    void refreshStatus();
    const interval = window.setInterval(refreshStatus, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

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
        setDeveloperTurn((current) => ({ ...current, metrics: { ...current.metrics, playbackStartMs: elapsedMs } }));
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
    setDeveloperTurn({ transcript: '', metrics: {}, errors: [] });
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
      if (manualInitiativeRequestIdRef.current === event.requestId) {
        manualInitiativeRequestIdRef.current = null;
        if (!event.initiate) {
          if (playerRef.current) void playerRef.current.stop();
          playerRef.current = null;
          playerTurnIdRef.current = null;
          setDeveloperTurn((current) => ({ ...current, errors: [...current.errors, `Iniciativa silenciosa: ${event.reason}`] }));
        }
      }
      return;
    }
    if (event.type === 'error') {
      if (event.turnId && !shouldAcceptTurnEvent(activeTurnIdRef.current, event.turnId)) return;
      recordError(`${event.code}: ${event.message}`);
      setStatus('Erro');
      if (event.code === 'initiative_failed') {
        setInitiativeBusy(false);
        if (playerRef.current) void playerRef.current.stop();
        playerRef.current = null;
        playerTurnIdRef.current = null;
      }
      if (event.turnId) void interruptPlayerAfterError(event.turnId);
      return;
    }
    if (!('turnId' in event) || !shouldAcceptTurnEvent(activeTurnIdRef.current, event.turnId)) return;

    if (event.type === 'turn.started') {
      activeTurnIdRef.current = event.turnId;
      activeStartedAtRef.current = performance.now();
      setStatus('Pensando');
      setDeveloperTurn({ transcript: '', metrics: {}, errors: [] });
      if (playerTurnIdRef.current !== event.turnId) void preparePlayer(event.turnId);
    } else if (event.type === 'cognition.started') {
      setStatus('Pensando');
    } else if (event.type === 'cognition.completed') {
      setStatus('Formando resposta');
      setDeveloperTurn((current) => ({
        ...current,
        decision: event.decision,
        context: event.context,
        metrics: { ...current.metrics, deliberationMs: event.deliberationMs },
      }));
    } else if (event.type === 'llm.first_token') {
      mergeMetrics({ firstTokenMs: event.elapsedMs });
    } else if (event.type === 'llm.segment') {
      setDeveloperTurn((current) => ({
        ...current,
        transcript: current.transcript + event.text,
        metrics: current.metrics.firstSegmentMs === undefined
          ? { ...current.metrics, firstSegmentMs: event.elapsedMs }
          : current.metrics,
      }));
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
      setDeveloperTurn((current) => ({ ...current, consolidation: event }));
    }
  }

  function mergeMetrics(metrics: Partial<TurnPerformanceMetrics>): void {
    setDeveloperTurn((current) => ({ ...current, metrics: { ...current.metrics, ...metrics } }));
  }

  function finishTurnMarker(turnId: string, interrupted: boolean, durationMs?: number): void {
    if (finalizedTurnsRef.current.has(turnId)) return;
    finalizedTurnsRef.current.add(turnId);
    setHistory((current) => [
      ...current,
      { id: `lumia-${turnId}`, kind: 'lumia', createdAt: new Date().toISOString(), durationMs, interrupted },
    ]);
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
      if (!connectionRef.current?.send({ type: 'initiative.evaluate', requestId, sampleRate: temporary.sampleRate })) {
        throw new Error('Backend local desconectado.');
      }
    } catch (error) {
      setInitiativeBusy(false);
      recordError(error instanceof Error ? error.message : 'Falha na avaliação de iniciativa.');
    }
  }

  const busy = ['Pensando', 'Formando resposta', 'Falando'].includes(status);
  return (
    <main className="app-shell">
      <header className="app-header">
        <div><span className="eyebrow">Cognitive Core · local</span><h1>Lumia</h1></div>
        <SystemIndicators backendOnline={backendOnline} status={backend} />
      </header>

      {backend?.ollama.available && !backend.ollama.modelInstalled ? (
        <div className="technical-banner">Modelo ausente. Execute <code>{backend.ollama.installCommand}</code></div>
      ) : null}
      {!backend?.ollama.available && backendOnline ? <div className="technical-banner">Ollama indisponível. Inicie o serviço e tente novamente.</div> : null}
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
        onRefreshMemories={() => connectionRef.current?.send({ type: 'memory.list' })}
        onDeleteMemory={(memoryId) => connectionRef.current?.send({ type: 'memory.delete', memoryId })}
      />
    </main>
  );
}
