import type { LumiaTechnicalErrorCode } from '../shared/protocol/index.js';

export class LumiaServerError extends Error {
  readonly code: LumiaTechnicalErrorCode | string;
  readonly userMessage: string;

  constructor(code: LumiaTechnicalErrorCode | string, userMessage: string) {
    super(userMessage);
    this.name = 'LumiaServerError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

