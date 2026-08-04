type CartesiaErrorLike = {
  title?: string;
  message?: string;
  error_code?: string;
  status_code?: number;
};

const PREFIXED_SECRET_PATTERNS = [
  /(X-API-Key["'\s:=]+)[A-Za-z0-9_-]+/gi,
  /(Authorization["'\s:=]+Bearer\s+)[A-Za-z0-9._-]+/gi,
];

export function redactSecrets(input: string): string {
  const withoutCartesiaKeys = input.replace(/sk_car_[A-Za-z0-9_-]+/g, '[redigido]');
  return PREFIXED_SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '$1[redigido]'),
    withoutCartesiaKeys,
  );
}

export function cartesiaErrorToPortuguese(error: CartesiaErrorLike): string {
  const code = error.error_code ? ` (${error.error_code})` : '';
  const detail = redactSecrets(error.message || error.title || 'Erro sem detalhes.');

  if (error.status_code === 401 || error.status_code === 403) {
    return `A Cartesia recusou a autenticação${code}. Verifique a chave em C:\\lumia\\.env.`;
  }

  if (error.status_code === 404 || error.error_code === 'voice_not_found') {
    return `A voz configurada não foi encontrada${code}. Confira CARTESIA_VOICE_ID em C:\\lumia\\.env.`;
  }

  if (error.status_code === 400) {
    return `A Cartesia recusou os parâmetros da geração${code}: ${detail}`;
  }

  return `A Cartesia retornou um erro${code}: ${detail}`;
}

export function unknownErrorToPortuguese(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return redactSecrets(error.message);
  }

  return 'Erro inesperado durante a geração de voz.';
}
