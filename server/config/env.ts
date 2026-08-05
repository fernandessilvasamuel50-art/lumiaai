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
  ollamaAutoStart: boolean;
  ollamaStartupTimeoutMs: number;
  ollamaHealthRetryMs: number;
  ollamaWarmup: boolean;
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
  const initiativeIdleMinutes = parseNumber(env.LUMIA_INITIATIVE_IDLE_MINUTES, 10, 'LUMIA_INITIATIVE_IDLE_MINUTES', 0.1, 1440);
  const ollamaBaseUrl = (env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434').replace(/\/$/, '');

  return {
    envPath,
    host: env.HOST?.trim() || '127.0.0.1',
    port,
    cartesiaApiKey: env.CARTESIA_API_KEY?.trim() || '',
    cartesiaVoiceId: env.CARTESIA_VOICE_ID?.trim() || DEFAULT_CARTESIA_VOICE_ID,
    cartesiaApiVersion: CARTESIA_API_VERSION,
    cartesiaModelId: CARTESIA_MODEL_ID,
    outputEncoding: OUTPUT_ENCODING,
    ollamaBaseUrl,
    ollamaModel: env.OLLAMA_MODEL?.trim() || 'qwen3:8b',
    ollamaNumCtx,
    ollamaKeepAlive: env.OLLAMA_KEEP_ALIVE?.trim() || '15m',
    ollamaAutoStart: parseBoolean(env.OLLAMA_AUTO_START, true, 'OLLAMA_AUTO_START'),
    ollamaStartupTimeoutMs: parseInteger(env.OLLAMA_STARTUP_TIMEOUT_MS, 30000, 'OLLAMA_STARTUP_TIMEOUT_MS', 1000, 300000),
    ollamaHealthRetryMs: parseInteger(env.OLLAMA_HEALTH_RETRY_MS, 1000, 'OLLAMA_HEALTH_RETRY_MS', 100, 30000),
    ollamaWarmup: parseBoolean(env.OLLAMA_WARMUP, true, 'OLLAMA_WARMUP'),
    databasePath: path.resolve(cwd, env.LUMIA_DATABASE_PATH?.trim() || './data/lumia.db'),
    initiativeEnabled: parseBoolean(env.LUMIA_INITIATIVE_ENABLED, true, 'LUMIA_INITIATIVE_ENABLED'),
    initiativeIdleMinutes,
  };
}

export function assertCartesiaConfigured(config: ServerConfig): void {
  if (!config.cartesiaApiKey) {
    throw new LumiaServerError(
      'CARTESIA_UNAVAILABLE',
      'A chave da Cartesia não está configurada. Preencha CARTESIA_API_KEY no arquivo .env e reinicie o servidor.',
    );
  }
}

export function isLocalOllamaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
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
