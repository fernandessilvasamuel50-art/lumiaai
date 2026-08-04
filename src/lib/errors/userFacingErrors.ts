export function getFriendlyClientError(error: unknown): string {
  if (error instanceof CloseEvent) {
    return 'A conexão local de voz foi encerrada antes da conclusão.';
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Não foi possível iniciar a fala. Verifique se o servidor local está rodando.';
}

