import { describe, expect, it } from 'vitest';
import { shouldAcceptTurnEvent } from './localConnection.js';

describe('rejeição de evento obsoleto', () => {
  it('aceita apenas o turno atual', () => {
    expect(shouldAcceptTurnEvent('atual', 'atual')).toBe(true);
    expect(shouldAcceptTurnEvent('atual', 'antigo')).toBe(false);
    expect(shouldAcceptTurnEvent('atual', undefined)).toBe(true);
  });
});
