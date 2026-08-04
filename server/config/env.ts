import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import {
  CARTESIA_API_VERSION,
  CARTESIA_MODEL_ID,
  DEFAULT_CARTESIA_VOICE_ID,
  OUTPUT_ENCODING,
} from '../../shared/protocol/index.js';
import { LumiaServerError } from '../errors.js';

const PROJECT_ENV_PATH = path.resolve(process.cwd(), '.env');

export type ServerConfig = {
  envPath: string;
  host: string;
  port: number;
  cartesiaApiKey: string;
  cartesiaVoiceId: string;
  cartesiaApiVersion: string;
  cartesiaModelId: string;
  outputEncoding: typeof OUTPUT_ENCODING;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaNumCtx: number;
  ollamaKeepAlive: string;
  databasePath: string;
  initiativeEnabled: boolean;
  initiativeIdleMinutes: number;
};

type ConfigOptions = { env?: NodeJS.ProcessEnv; loadDotEnv?: boolean; cwd?: string };

export function loadServerConfig(options: ConfigOptions = {}): ServerConfig {
  const cwd = options.cwd ?? process.cwd();
  const envPath = path.resolve(cwd, '.env');
  if (options.loadDotEnv !== false) {
    dotenv.config({ path: fs.existsSync(envPath) ? envPath : PROJECT_ENV_PATH, quiet: true });
  }
  const env = options.env ?? process.env;
  const port = parseInteger(env.PORT, 8787, 'PORT', 1, 65535);
  const ollamaNumCtx = parseInteger(env.OLLAMA_NUM_CTX, 8192, 'OLLAMA_NUM_CTX', 1024, 131072);
  const initiativeIdleMinutes = parseNumber(
    env.LUMIA_INITIATIVE_IDLE_MINUTES,
    10,
    'LUMIA_INITIATIVE_IDLE_MINUTES',
    0.1,
    1440,
  );
  const ollamaBaseUrl = env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434';
  assertLocalOllamaUrl(ollamaBaseUrl);

  return {
    envPath,
    host: env.HOST?.trim() || '127.0.0.1',
    port,
    cartesiaApiKey: env.CARTESIA_API_KEY?.trim() || '',
    cartesiaVoiceId: env.CARTESIA_VOICE_ID?.trim() || DEFAULT_CARTESIA_VOICE_ID,
    cartesiaApiVersion: CARTESIA_API_VERSION,
    cartesiaModelId: CARTESIA_MODEL_ID,
    outputEncoding: OUTPUT_ENCODING,
    ollamaBaseUrl: ollamaBaseUrl.replace(/\/$/, ''),
    ollamaModel: env.OLLAMA_MODEL?.trim() || 'qwen3:8b',
    ollamaNumCtx,
    ollamaKeepAlive: env.OLLAMA_KEEP_ALIVE?.trim() || '15m',
    databasePath: path.resolve(cwd, env.LUMIA_DATABASE_PATH?.trim() || './data/lumia.db'),
    initiativeEnabled: parseBoolean(env.LUMIA_INITIATIVE_ENABLED, true, 'LUMIA_INITIATIVE_ENABLED'),
    initiativeIdleMinutes,
  };
}

export function assertCartesiaConfigured(config: ServerConfig): void {
  if (!config.cartesiaApiKey) {
    throw new LumiaServerError(
      'cartesia_api_key_missing',
      'A chave da Cartesia não está configurada. Preencha CARTESIA_API_KEY em C:\\lumia\\.env e reinicie o servidor.',
    );
  }
}

function parseInteger(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  const parsed = value === undefined || value.trim() === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new LumiaServerError('invalid_environment', `${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return parsed;
}

function parseNumber(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  const parsed = value === undefined || value.trim() === '' ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new LumiaServerError('invalid_environment', `${name} deve ser um número entre ${min} e ${max}.`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new LumiaServerError('invalid_environment', `${name} deve ser true ou false.`);
}

function assertLocalOllamaUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LumiaServerError('invalid_environment', 'OLLAMA_BASE_URL deve ser uma URL HTTP local válida.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new LumiaServerError('invalid_environment', 'OLLAMA_BASE_URL deve usar HTTP ou HTTPS.');
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new LumiaServerError('invalid_environment', 'OLLAMA_BASE_URL deve apontar para o serviço local (127.0.0.1 ou localhost).');
  }
}
