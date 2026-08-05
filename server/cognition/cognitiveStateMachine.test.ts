import { describe, expect, it } from 'vitest';
import type { CognitiveTurnState } from '../../shared/protocol/index.js';
import { CognitiveStateMachine } from './cognitiveStateMachine.js';

describe('CognitiveStateMachine', () => {
  it('aceita o fluxo completo e rejeita transição inválida', () => {
    const states: CognitiveTurnState[] = [];
    const machine = new CognitiveStateMachine(crypto.randomUUID(), 'user', (event) => states.push(event.state));
    machine.announce();
    for (const state of ['PERCEIVING', 'RETRIEVING', 'DELIBERATING', 'GENERATING', 'SPEAKING', 'CONSOLIDATING', 'COMPLETED'] as const) machine.transition(state);
    expect(states.at(-1)).toBe('COMPLETED');
    expect(() => machine.transition('GENERATING')).toThrow('inválida');
  });

  it('permite cancelamento em qualquer fase não terminal', () => {
    const prefixes: CognitiveTurnState[][] = [
      [],
      ['PERCEIVING'],
      ['PERCEIVING', 'RETRIEVING'],
      ['PERCEIVING', 'RETRIEVING', 'DELIBERATING'],
      ['PERCEIVING', 'RETRIEVING', 'DELIBERATING', 'GENERATING'],
      ['PERCEIVING', 'RETRIEVING', 'DELIBERATING', 'GENERATING', 'SPEAKING'],
      ['PERCEIVING', 'RETRIEVING', 'DELIBERATING', 'GENERATING', 'SPEAKING', 'CONSOLIDATING'],
    ];
    for (const prefix of prefixes) {
      const machine = new CognitiveStateMachine(crypto.randomUUID(), 'user');
      for (const state of prefix) machine.transition(state);
      machine.cancel();
      expect(machine.state).toBe('CANCELLED');
    }
  });

  it('reserva silêncio terminal para iniciativa', () => {
    const direct = new CognitiveStateMachine(crypto.randomUUID(), 'user');
    direct.transition('PERCEIVING'); direct.transition('RETRIEVING'); direct.transition('DELIBERATING');
    expect(() => direct.transition('COMPLETED')).toThrow('iniciativa');
    const initiative = new CognitiveStateMachine(crypto.randomUUID(), 'initiative');
    initiative.transition('PERCEIVING'); initiative.transition('RETRIEVING'); initiative.transition('DELIBERATING'); initiative.transition('COMPLETED');
    expect(initiative.state).toBe('COMPLETED');
  });
});
