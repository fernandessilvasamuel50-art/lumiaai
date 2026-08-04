import { Send, Square } from 'lucide-react';
import type { HistoryItem, TurnStatus } from '../../../shared/protocol/index.js';
import { ReactiveWave } from '../ReactiveWave.js';

type Props = {
  history: HistoryItem[];
  message: string;
  status: TurnStatus | 'Pronta';
  busy: boolean;
  level: number;
  onMessageChange(value: string): void;
  onSend(): void;
  onStop(): void;
};

export function Conversation({ history, message, status, busy, level, onMessageChange, onSend, onStop }: Props) {
  return (
    <section className="conversation-card" aria-label="Conversa com Lumia">
      <div className="conversation-stream">
        {history.length === 0 ? (
          <div className="empty-conversation">
            <span className="orb-small" />
            <p>O espaço está pronto para uma nova conversa.</p>
          </div>
        ) : null}
        {history.map((item) =>
          item.kind === 'user' ? (
            <article className="user-message" key={item.id}>
              <p>{item.text}</p>
              <time>{formatTime(item.createdAt)}</time>
            </article>
          ) : (
            <article className={`lumia-marker ${item.interrupted ? 'interrupted' : ''}`} key={item.id}>
              <span className="marker-dot" />
              <div>
                <strong>{item.interrupted ? 'Fala interrompida' : 'Lumia falou'}</strong>
                <time>{formatTime(item.createdAt)}{item.durationMs ? ` · ${formatDuration(item.durationMs)}` : ''}</time>
              </div>
            </article>
          ),
        )}
      </div>

      <div className={`voice-presence ${status === 'Falando' ? 'speaking' : ''}`}>
        <ReactiveWave active={status === 'Falando'} level={level} />
        <span>{status}</span>
      </div>

      <div className="composer-row">
        <textarea
          value={message}
          placeholder="Escreva para Lumia…"
          aria-label="Mensagem para Lumia"
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (message.trim()) onSend();
            }
          }}
        />
        <div className="composer-actions">
          <button className="send-button" type="button" onClick={onSend} disabled={!message.trim()} aria-label="Enviar mensagem">
            <Send size={19} />
          </button>
          <button className="stop-button" type="button" onClick={onStop} disabled={!busy} aria-label="Interromper Lumia">
            <Square size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(value: number): string {
  return `${(value / 1000).toFixed(1)} s`;
}
