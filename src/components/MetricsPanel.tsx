import { Clock3, Gauge } from 'lucide-react';
import { formatDuration, formatMs, type VoiceMetrics } from '../lib/metrics/voiceMetrics.js';

type MetricsPanelProps = {
  metrics: VoiceMetrics;
};

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  const format = metrics.outputFormat
    ? `${metrics.outputFormat.container}/${metrics.outputFormat.encoding} @ ${metrics.outputFormat.sampleRate} Hz`
    : '—';

  const items = [
    ['Horário de início', metrics.startedAtWallClock ?? '—'],
    ['Primeiro áudio recebido', formatMs(metrics.firstAudioChunkMs)],
    ['Início da reprodução', formatMs(metrics.playbackStartMs)],
    ['Duração da geração', formatMs(metrics.generationTotalMs)],
    ['Duração aprox. do áudio', formatDuration(metrics.estimatedAudioDurationMs)],
    ['Modelo', metrics.modelId ?? '—'],
    ['Formato e taxa', format],
  ];

  return (
    <section className="metrics-panel" aria-label="Métricas">
      <div className="panel-heading">
        <Gauge size={18} aria-hidden="true" />
        <h2>Métricas</h2>
      </div>
      <div className="metric-grid">
        {items.map(([label, value]) => (
          <div className="metric-item" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="metric-footer">
        <Clock3 size={15} aria-hidden="true" />
        <span>Medidas no navegador a partir do clique em Falar.</span>
      </div>
    </section>
  );
}

