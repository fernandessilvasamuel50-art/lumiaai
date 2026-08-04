import { ChevronDown, Cpu, Database, Trash2 } from 'lucide-react';
import type {
  BackendStatusResponse,
  MemoryInspectorItem,
  RetrievedContext,
  TurnPerformanceMetrics,
} from '../../../shared/protocol/index.js';
import type { CognitiveDecision } from '../../../shared/schemas/cognition.js';

export type DeveloperTurnState = {
  transcript: string;
  decision?: CognitiveDecision;
  context?: RetrievedContext;
  metrics: TurnPerformanceMetrics;
  errors: string[];
  consolidation?: { createdMemoryIds: string[]; updatedOpinionId: string | null; openLoopIds: string[] };
};

type Props = {
  turn: DeveloperTurnState;
  backend: BackendStatusResponse | null;
  memories: MemoryInspectorItem[];
  volume: number;
  initiativeBusy: boolean;
  onVolume(value: number): void;
  onEvaluateInitiative(): void;
  onRefreshMemories(): void;
  onDeleteMemory(id: string): void;
};

export function DeveloperPanel(props: Props) {
  return (
    <details className="developer-panel">
      <summary><span><Cpu size={17} /> Modo de desenvolvimento</span><ChevronDown size={17} /></summary>
      <div className="developer-content">
        <div className="developer-controls">
          <label>Volume <strong>{Math.round(props.volume * 100)}%</strong>
            <input type="range" min="0" max="1.5" step="0.05" value={props.volume} onChange={(event) => props.onVolume(Number(event.target.value))} />
          </label>
          <button type="button" onClick={props.onEvaluateInitiative} disabled={props.initiativeBusy}>
            Permitir que Lumia avalie se quer puxar um assunto agora
          </button>
          <button type="button" onClick={props.onRefreshMemories}><Database size={15} /> Inspecionar memórias</button>
        </div>

        <DebugBlock title="Transcrição gerada" value={props.turn.transcript || '—'} />
        <DebugBlock title="Decisão cognitiva estruturada" value={props.turn.decision ? JSON.stringify(props.turn.decision, null, 2) : '—'} />
        <DebugBlock title="Contexto recuperado" value={props.turn.context ? JSON.stringify(props.turn.context, null, 2) : '—'} />
        <DebugBlock title="Consolidação" value={props.turn.consolidation ? JSON.stringify(props.turn.consolidation, null, 2) : '—'} />
        <DebugBlock title="Métricas" value={JSON.stringify({ model: props.backend?.ollama.model, processor: props.backend?.ollama.processor, ...props.turn.metrics }, null, 2)} />
        <DebugBlock title="Erros técnicos" value={props.turn.errors.join('\n') || '—'} />

        <section className="memory-inspector">
          <h3>Memórias persistentes</h3>
          {props.memories.length === 0 ? <p>Nenhuma memória carregada no inspetor.</p> : null}
          {props.memories.map((memory) => (
            <article key={memory.id}>
              <div><strong>{memory.type}</strong><span>{Math.round(memory.confidence * 100)}% confiança</span></div>
              <p>{memory.content}</p>
              <button type="button" onClick={() => props.onDeleteMemory(memory.id)} aria-label="Excluir memória"><Trash2 size={15} /></button>
            </article>
          ))}
        </section>
      </div>
    </details>
  );
}

function DebugBlock({ title, value }: { title: string; value: string }) {
  return <section className="debug-block"><h3>{title}</h3><pre>{value}</pre></section>;
}
