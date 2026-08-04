import { describe, expect, it } from 'vitest';
import { cartesiaErrorToPortuguese, redactSecrets } from './errors.js';

describe('cartesia errors', () => {
  it('redige chaves Cartesia em mensagens', () => {
    expect(redactSecrets('falhou com sk_car_exemplo123')).toBe('falhou com [redigido]');
  });

  it('traduz erro de autenticação sem revelar segredo', () => {
    const message = cartesiaErrorToPortuguese({
      status_code: 401,
      error_code: 'unauthorized',
      message: 'Invalid key',
    });

    expect(message).toContain('recusou a autenticação');
    expect(message).not.toContain('Invalid key');
  });

  it('preserva detalhe útil em erro de parâmetro', () => {
    const message = cartesiaErrorToPortuguese({
      status_code: 400,
      error_code: 'model_not_found',
      message: 'The model is not valid.',
    });

    expect(message).toContain('parâmetros');
    expect(message).toContain('The model is not valid.');
  });
});
