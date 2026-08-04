import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import {
  CARTESIA_API_VERSION,
  CARTESIA_MODEL_ID,
  DEFAULT_CARTESIA_VOICE_ID,
  OUTPUT_ENCODING,
} from '../../src/shared/protocol.js';
import { LumiaServerError } from '../errors.js';

const DEFAULT_ENV_PATH = process.platform === 'win32' ? 'C:\\lumia.env' : path.resolve(process.cwd(), '../lumia.env');
const FALLBACK_ENV_PATH = path.resolve(process.cwd(), '.env');

export type ServerConfig = {
  envPath: string;
  host: string;
  port: number;
  cartesiaApiKey: string;
  cartesiaVoiceId: string;
  cartesiaApiVersion: string;
  cartesiaModelId: string;
  outputEncoding: typeof OUTPUT_ENCODING;
};

export function loadServerConfig(): ServerConfig {
  const envPath = process.env.LUMIA_ENV_PATH || (fs.existsSync(DEFAULT_ENV_PATH) ? DEFAULT_ENV_PATH : FALLBACK_ENV_PATH);
  dotenv.config({ path: envPath, quiet: true });

  return {
    envPath,
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 8787),
    cartesiaApiKey: process.env.CARTESIA_API_KEY?.trim() || '',
    cartesiaVoiceId: process.env.CARTESIA_VOICE_ID?.trim() || DEFAULT_CARTESIA_VOICE_ID,
    cartesiaApiVersion: CARTESIA_API_VERSION,
    cartesiaModelId: CARTESIA_MODEL_ID,
    outputEncoding: OUTPUT_ENCODING,
  };
}

export function assertCartesiaConfigured(config: ServerConfig): void {
  if (!config.cartesiaApiKey) {
    throw new LumiaServerError(
      'cartesia_api_key_missing',
      'A chave da Cartesia não está configurada. Preencha CARTESIA_API_KEY em C:\\lumia.env ou, se o Windows bloquear a raiz C:\\, em C:\\lumia\\.env. Depois reinicie o servidor local.',
    );
  }
}
