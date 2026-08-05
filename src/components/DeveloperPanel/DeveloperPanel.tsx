import { useState } from 'react';
import { ChevronDown, Cpu, Database, Pencil, Search, ShieldAlert, Trash2 } from 'lucide-react';
import type {
  BackendStatusResponse,
  CognitiveBudget,
  CognitiveTurnState,
  ConsolidationSummary,
  LumiaSelfModel,
  MemoryInspectorItem,
  RetrievedContext,
  SpeechProvenance,
  TurnPerformanceMetrics,
} from '../../../shared/protocol/index.js';
import type { CognitiveDecision, CognitiveFrame, ResponseReview } from '../../../shared/schemas/cognition.js';

export type DeveloperTurnState = {
  transcript: string;
  state?: CognitiveTurnState;
  frame?: CognitiveFrame;
  decision?: CognitiveDecision;
  context?: RetrievedContext;
  budget?: CognitiveBudget;
  selfModel?: LumiaSelfModel;
  review?: ResponseReview;
  provenance: SpeechProvenance[];
  metrics: TurnPerformanceMetrics;
  errors: string[];
  consolidation?: ConsolidationSummary;
};

type Props = {
  turn: DeveloperTurnState;
  backend: BackendStatusResponse | null;
  memories: MemoryInspectorItem[];
  volume: number;
  initiativeBusy: boolean;
  onVolume(value: number): void;
  onEvaluateInitiative(): void;
  onSearchMemories(query: string, memoryType?: string): void;
  onReviseMemory(id: string, content: string, reason: string): void;
  onMarkMemoryUncertain(id: string, reason: string): void;
  onDeleteMemory(id: string, reason: string): void;
};

export function DeveloperPanel(props: Props) {
  const [query, setQuery] = useState('');
  const [memoryType, setMemoryType] = useState('');
  const runSearch = (nextQuery = query, nextType = memoryType) => props.onSearchMemories(nextQuery, nextType || undefined);

  return (
    <details className="developer-panel">
      <summary><span><Cpu size={17} /> Modo de desenvolvimento</span><ChevronDown size={17} /></summary>
      <div className="developer-content">
        <div className="developer-controls">
          <label>Volume <strong>{Math.round(props.volume * 100)}%</strong>
            <input type="range" min="0" max="1.5" step="0.05" value={props.volume} onChange={(event) => props.onVolume(Number(event.target.value))} />
          </label>
          <button type="button" onClick={props.onEvaluateInitiative} disabled={props.initiativeBusy}>
            Avaliar iniciativa espontânea
          </button>
        </div>

        <DebugBlock title="Estado cognitivo" value={props.turn.state ?? '—'} />
        <DebugBlock title="Estado do Ollama" value={props.backend ? JSON.stringify(props.backend.ollama, null, 2) : '—'} />
        <DebugBlock title="Frame cognitivo" value={props.turn.frame ? JSON.stringify(props.turn.frame, null, 2) : '—'} />
        <DebugBlock title="Decisão estruturada" value={props.turn.decision ? JSON.stringify(props.turn.decision, null, 2) : '—'} />
        <DebugBlock title="Memória e conhecimento recuperados" value={props.turn.context ? JSON.stringify(props.turn.context, null, 2) : '—'} />
        <DebugBlock title="Orçamento adaptativo" value={props.turn.budget ? JSON.stringify(props.turn.budget, null, 2) : '—'} />
        <DebugBlock title="Perfil de interação aplicado" value={props.turn.selfModel ? JSON.stringify(props.turn.selfModel, null, 2) : '—'} />
        <DebugBlock title="Revisão crítica" value={props.turn.review ? JSON.stringify(props.turn.review, null, 2) : '—'} />
        <DebugBlock title="Transcrição gerada" value={props.turn.transcript || '—'} />
        <DebugBlock title="Proveniência da fala" value={props.turn.provenance.length ? JSON.stringify(props.turn.provenance, null, 2) : '—'} />
        <DebugBlock title="Consolidação" value={props.turn.consolidation ? JSON.stringify(props.turn.consolidation, null, 2) : '—'} />
        <DebugBlock title="Métricas reais" value={JSON.stringify(props.turn.metrics, null, 2)} />
        <DebugBlock title="Erros técnicos" value={props.turn.errors.join('\n') || '—'} />

        <section className="memory-inspector">
          <h3>Inspetor de memória persistente</h3>
          <div className="memory-search">
            <Search size={15} />
            <input
              value={query}
              placeholder="Pesquisar conteúdo"
              onChange={(event) => {
                setQuery(event.target.value);
                runSearch(event.target.value, memoryType);
              }}
            />
            <select
              value={memoryType}
              onChange={(event) => {
                setMemoryType(event.target.value);
                runSearch(query, event.target.value);
              }}
            >
              <option value="">Todos os tipos</option>
              <option value="episodic">Episódica</option>
              <option value="semantic_personal">Semântica pessoal</option>
              <option value="procedural">Procedimental</option>
              <option value="relationship">Relacionamento</option>
              <option value="self_continuity">Autocontinuidade</option>
            </select>
            <button type="button" onClick={() => runSearch()}><Database size={15} /> Atualizar</button>
          </div>
          {props.memories.length === 0 ? <p>Nenhuma memória corresponde ao filtro.</p> : null}
          {props.memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              onRevise={props.onReviseMemory}
              onUncertain={props.onMarkMemoryUncertain}
              onDelete={props.onDeleteMemory}
            />
          ))}
        </section>
      </div>
    </details>
  );
}

function MemoryCard(props: {
  memory: MemoryInspectorItem;
  onRevise(id: string, content: string, reason: string): void;
  onUncertain(id: string, reason: string): void;
  onDelete(id: string, reason: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(props.memory.content);
  const [reason, setReason] = useState('');
  const validReason = reason.trim().length > 0;
  return (
    <article>
      <div className="memory-meta">
        <strong>{props.memory.type}</strong>
        <span>{props.memory.status}</span>
        <span>{Math.round(props.memory.confidence * 100)}% confiança</span>
      </div>
      {editing ? (
        <div className="memory-editor">
          <textarea value={content} onChange={(event) => setContent(event.target.value)} />
          <input value={reason} placeholder="Motivo obrigatório da alteração" onChange={(event) => setReason(event.target.value)} />
          <button type="button" disabled={!content.trim() || !validReason} onClick={() => {
            props.onRevise(props.memory.id, content.trim(), reason.trim());
            setEditing(false);
            setReason('');
          }}>Salvar correção</button>
        </div>
      ) : <p>{props.memory.content}</p>}
      <details className="memory-history">
        <summary>Fontes e histórico</summary>
        <pre>{JSON.stringify({ source: props.memory.source, sourceMessageIds: props.memory.sourceMessageIds, history: props.memory.history }, null, 2)}</pre>
      </details>
      <div className="memory-actions">
        <button type="button" onClick={() => setEditing((value) => !value)}><Pencil size={14} /> Corrigir</button>
        <button type="button" disabled={!validReason} onClick={() => props.onUncertain(props.memory.id, reason.trim())}><ShieldAlert size={14} /> Incerta</button>
        <button type="button" disabled={!validReason} onClick={() => props.onDelete(props.memory.id, reason.trim())}><Trash2 size={14} /> Excluir</button>
      </div>
      {!editing ? <input className="memory-reason" value={reason} placeholder="Motivo para marcar ou excluir" onChange={(event) => setReason(event.target.value)} /> : null}
    </article>
  );
}

function DebugBlock({ title, value }: { title: string; value: string }) {
  return <section className="debug-block"><h3>{title}</h3><pre>{value}</pre></section>;
}
