import { Play, SlidersHorizontal, Square, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MetricsPanel } from './components/MetricsPanel.js';
import { ReactiveWave } from './components/ReactiveWave.js';
import { StatusPill } from './components/StatusPill.js';
import { PcmStreamPlayer } from './lib/audio/PcmStreamPlayer.js';
import { LumiaVoiceClient } from './lib/backend/LumiaVoiceClient.js';
import { getFriendlyClientError } from './lib/errors/userFacingErrors.js';
import {
  createInitialMetrics,
  elapsedFromStart,
  type VoiceMetrics,
} from './lib/metrics/voiceMetrics.js';
import {
  DEFAULT_SPEED,
  DEFAULT_TRANSCRIPT,
  MAX_PLAYBACK_VOLUME,
  MAX_SPEED,
  MIN_PLAYBACK_VOLUME,
  MIN_SPEED,
  clampNumber,
  type BackendStatusResponse,
  type LumiaServerJsonMessage,
  type VoiceStatus,
} from './shared/protocol.js';
import './styles.css';

const POLL_BACKEND_MS = 4000;

export default function App() {
  const [text, setText] = useState(DEFAULT_TRANSCRIPT);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [volume, setVolume] = useState(1);
  const [status, setStatus] = useState<VoiceStatus>('Pronta');
  const [backendStatus, setBackendStatus] = useState<BackendStatusResponse | null>(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [socketActive, setSocketActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [metrics, setMetrics] = useState<VoiceMetrics>({});
  const [level, setLevel] = useState(0);

  const clientRef = useRef(new LumiaVoiceClient());
  const playerRef = useRef<PcmStreamPlayer | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const generationDoneRef = useRef(false);

  const canSpeak = text.trim().length > 0;
  const isBusy = status === 'Conectando' || status === 'Gerando' || status === 'Falando';
  const isSpeaking = status === 'Falando';

  useEffect(() => {
    let cancelled = false;

    async function refreshStatus() {
      try {
        const response = await fetch('/api/status');
        const data = (await response.json()) as BackendStatusResponse;
        if (!cancelled) {
          setBackendStatus(data);
          setBackendOnline(true);
        }
      } catch {
        if (!cancelled) {
          setBackendOnline(false);
        }
      }
    }

    void refreshStatus();
    const interval = window.setInterval(refreshStatus, POLL_BACKEND_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    playerRef.current?.setVolume(volume);
  }, [volume]);

  const connectionLabel = useMemo(() => {
    if (!backendOnline) {
      return 'Servidor local indisponível';
    }

    if (!backendStatus?.cartesiaConfigured) {
      return 'Cartesia aguardando configuração';
    }

    return socketActive ? 'Canal de voz ativo' : 'Canal de voz pronto';
  }, [backendOnline, backendStatus?.cartesiaConfigured, socketActive]);

  async function stopCurrentRun(nextStatus: VoiceStatus = 'Pronta') {
    clientRef.current.stop();
    activeRunIdRef.current = null;
    generationDoneRef.current = false;
    setSocketActive(false);
    setLevel(0);

    if (playerRef.current) {
      await playerRef.current.stop();
      playerRef.current = null;
    }

    setStatus(nextStatus);
  }

  async function handleSpeak() {
    if (!canSpeak) {
      setErrorMessage('Digite um texto antes de iniciar a fala.');
      setStatus('Erro');
      return;
    }

    await stopCurrentRun('Conectando');

    const startedAt = performance.now();
    const nextMetrics = createInitialMetrics(startedAt);
    setMetrics(nextMetrics);
    setErrorMessage('');

    const player = new PcmStreamPlayer({
      volume,
      onPlaybackStart: (scheduledAtPerformanceMs) => {
        setMetrics((current) => ({
          ...current,
          playbackStartMs: elapsedFromStart(current.startedAtPerformanceMs, scheduledAtPerformanceMs),
        }));
        setStatus('Falando');
      },
      onPlaybackEnd: () => {
        setLevel(0);
        if (generationDoneRef.current) {
          setStatus('Concluído');
          activeRunIdRef.current = null;
        }
      },
      onLevel: (nextLevel) => {
        setLevel(nextLevel);
      },
    });

    playerRef.current = player;
    await player.resume();

    clientRef.current.start(
      {
        transcript: text.trim(),
        speed: clampNumber(speed, MIN_SPEED, MAX_SPEED),
        sampleRate: player.sampleRate,
        clientStartedAt: Date.now(),
      },
      {
        onOpen: () => {
          setSocketActive(true);
          setStatus('Gerando');
        },
        onJson: handleServerMessage,
        onAudioChunk: (chunk) => {
          player.enqueue(chunk);
          setMetrics((current) => ({
            ...current,
            estimatedAudioDurationMs: player.estimatedAudioMs,
          }));
        },
        onError: (error) => {
          handleError(error);
        },
        onClose: () => {
          setSocketActive(false);
        },
      },
    );
  }

  function handleServerMessage(message: LumiaServerJsonMessage) {
    if (message.type === 'started') {
      activeRunIdRef.current = message.runId;
      setMetrics((current) => ({
        ...current,
        modelId: message.modelId,
        outputFormat: message.outputFormat,
      }));
      return;
    }

    if (message.type === 'cartesia_connected') {
      setStatus((current) => (current === 'Falando' ? current : 'Gerando'));
      return;
    }

    if (message.type === 'first_audio_chunk') {
      setMetrics((current) => ({
        ...current,
        firstAudioChunkMs: elapsedFromStart(current.startedAtPerformanceMs, performance.now()),
      }));
      return;
    }

    if (message.type === 'done') {
      generationDoneRef.current = true;
      setMetrics((current) => ({
        ...current,
        generationTotalMs: elapsedFromStart(current.startedAtPerformanceMs, performance.now()),
      }));

      if (!playerRef.current || playerRef.current.estimatedAudioMs === 0 || playerRef.current.isIdle) {
        setStatus('Concluído');
      }
      return;
    }

    if (message.type === 'stopped') {
      void stopCurrentRun('Pronta');
      return;
    }

    if (message.type === 'error') {
      handleError(new Error(message.message));
    }
  }

  function handleError(error: unknown) {
    const friendlyMessage = getFriendlyClientError(error);
    setErrorMessage(friendlyMessage);
    void stopCurrentRun('Erro');
  }

  async function handleStop() {
    await stopCurrentRun('Pronta');
  }

  return (
    <main className="app-shell">
      <section className="voice-lab">
        <header className="hero">
          <div>
            <p className="eyebrow">Protótipo local</p>
            <h1>Lumia — Laboratório de Voz</h1>
          </div>
          <StatusPill status={status} backendOnline={backendOnline} socketActive={socketActive} />
        </header>

        <div className="connection-line">{connectionLabel}</div>

        <div className="workspace">
          <section className="composer" aria-label="Texto para fala">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck="true"
              aria-label="Texto"
            />

            <div className="controls">
              <button className="primary-button" type="button" onClick={handleSpeak} disabled={!canSpeak}>
                <Play size={18} aria-hidden="true" />
                Falar
              </button>
              <button className="secondary-button" type="button" onClick={handleStop} disabled={!isBusy}>
                <Square size={17} aria-hidden="true" />
                Parar
              </button>
            </div>

            <div className="sliders">
              <label>
                <span>
                  <SlidersHorizontal size={16} aria-hidden="true" />
                  Velocidade
                </span>
                <strong>{speed.toFixed(2)}x</strong>
                <input
                  type="range"
                  min={MIN_SPEED}
                  max={MAX_SPEED}
                  step="0.05"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                />
              </label>

              <label>
                <span>
                  <Volume2 size={16} aria-hidden="true" />
                  Volume
                </span>
                <strong>{Math.round(volume * 100)}%</strong>
                <input
                  type="range"
                  min={MIN_PLAYBACK_VOLUME}
                  max={MAX_PLAYBACK_VOLUME}
                  step="0.05"
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
              </label>
            </div>

            {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
          </section>

          <aside className="side-panel">
            <ReactiveWave active={isSpeaking} level={level} />
            <MetricsPanel metrics={metrics} />
          </aside>
        </div>
      </section>
    </main>
  );
}
