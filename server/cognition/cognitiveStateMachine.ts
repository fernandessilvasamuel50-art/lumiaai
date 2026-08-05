import type { CognitiveTurnState } from '../../shared/protocol/index.js';
import { LumiaServerError } from '../errors.js';

const TERMINAL_STATES = new Set<CognitiveTurnState>(['COMPLETED', 'CANCELLED', 'TECHNICAL_ERROR']);

const ALLOWED_TRANSITIONS: Readonly<Record<CognitiveTurnState, readonly CognitiveTurnState[]>> = {
  RECEIVED: ['PERCEIVING', 'CANCELLED', 'TECHNICAL_ERROR'],
  PERCEIVING: ['RETRIEVING', 'CANCELLED', 'TECHNICAL_ERROR'],
  RETRIEVING: ['DELIBERATING', 'CANCELLED', 'TECHNICAL_ERROR'],
  DELIBERATING: ['GENERATING', 'WAITING_FOR_CLARIFICATION', 'COMPLETED', 'CANCELLED', 'TECHNICAL_ERROR'],
  WAITING_FOR_CLARIFICATION: ['GENERATING', 'CANCELLED', 'TECHNICAL_ERROR'],
  GENERATING: ['SPEAKING', 'CANCELLED', 'TECHNICAL_ERROR'],
  SPEAKING: ['CONSOLIDATING', 'CANCELLED', 'TECHNICAL_ERROR'],
  CONSOLIDATING: ['COMPLETED', 'CANCELLED', 'TECHNICAL_ERROR'],
  COMPLETED: [],
  CANCELLED: [],
  TECHNICAL_ERROR: [],
};

export type StateTransition = {
  turnId: string;
  previousState: CognitiveTurnState | null;
  state: CognitiveTurnState;
  at: string;
};

export class CognitiveStateMachine {
  private currentState: CognitiveTurnState = 'RECEIVED';

  constructor(
    readonly turnId: string,
    private readonly origin: 'user' | 'initiative',
    private readonly onTransition?: (transition: StateTransition) => void,
  ) {}

  announce(): void {
    this.onTransition?.({ turnId: this.turnId, previousState: null, state: this.currentState, at: new Date().toISOString() });
  }

  get state(): CognitiveTurnState {
    return this.currentState;
  }

  get terminal(): boolean {
    return TERMINAL_STATES.has(this.currentState);
  }

  transition(next: CognitiveTurnState): void {
    if (!ALLOWED_TRANSITIONS[this.currentState].includes(next)) {
      throw new LumiaServerError(
        'TURN_STATE_INVALID',
        `Transição cognitiva inválida no turno ${this.turnId}: ${this.currentState} → ${next}.`,
      );
    }
    if (next === 'COMPLETED' && this.currentState === 'DELIBERATING' && this.origin !== 'initiative') {
      throw new LumiaServerError('TURN_STATE_INVALID', 'Somente iniciativa espontânea pode concluir um turno em silêncio.');
    }
    const previousState = this.currentState;
    this.currentState = next;
    this.onTransition?.({ turnId: this.turnId, previousState, state: next, at: new Date().toISOString() });
  }

  cancel(): void {
    if (!this.terminal) this.transition('CANCELLED');
  }

  fail(): void {
    if (!this.terminal) this.transition('TECHNICAL_ERROR');
  }
}

export function canTransition(from: CognitiveTurnState, to: CognitiveTurnState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
