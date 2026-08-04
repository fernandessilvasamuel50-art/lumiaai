export class LumiaServerError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, userMessage: string) {
    super(userMessage);
    this.name = 'LumiaServerError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

