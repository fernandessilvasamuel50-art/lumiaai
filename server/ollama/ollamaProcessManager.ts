import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ServerConfig } from '../config/env.js';
import { LumiaServerError } from '../errors.js';

export type OllamaProcessState =
  | { state: 'idle' }
  | { state: 'starting'; executablePath: string; startedAt: number }
  | { state: 'managed'; executablePath: string; pid?: number }
  | { state: 'failed'; executablePath?: string; technicalMessage: string };

type ProcessManagerDependencies = {
  fileExists?: (filePath: string) => boolean;
  spawnProcess?: (executablePath: string, args: string[]) => ChildProcess;
  hasRunningProcess?: () => Promise<boolean>;
  sleep?: (milliseconds: number) => Promise<void>;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

export class OllamaProcessManager {
  private managedProcess?: ChildProcess;
  private startPromise?: Promise<{ startedByLumia: boolean; elapsedMs: number }>;
  private processState: OllamaProcessState = { state: 'idle' };
  private readonly fileExists: (filePath: string) => boolean;
  private readonly spawnProcess: (executablePath: string, args: string[]) => ChildProcess;
  private readonly hasRunningProcess: () => Promise<boolean>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private lastTechnicalOutput = '';

  constructor(private readonly config: ServerConfig, dependencies: ProcessManagerDependencies = {}) {
    this.fileExists = dependencies.fileExists ?? fs.existsSync;
    this.spawnProcess = dependencies.spawnProcess ?? ((executablePath, args) => spawn(executablePath, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    this.hasRunningProcess = dependencies.hasRunningProcess ?? (() => detectRunningOllamaProcess(this.platform));
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.environment = dependencies.environment ?? process.env;
    this.platform = dependencies.platform ?? process.platform;
  }

  get state(): OllamaProcessState {
    return this.processState;
  }

  get technicalOutput(): string {
    return this.lastTechnicalOutput;
  }

  findExecutable(): string | null {
    return findOllamaExecutable(this.environment, this.fileExists, this.platform);
  }

  start(apiHealthy: () => Promise<boolean>): Promise<{ startedByLumia: boolean; elapsedMs: number }> {
    if (!this.startPromise) {
      this.startPromise = this.startInternal(apiHealthy).finally(() => {
        this.startPromise = undefined;
      });
    }
    return this.startPromise;
  }

  shutdown(): void {
    const child = this.managedProcess;
    if (!child || child.killed) return;
    child.kill();
    this.managedProcess = undefined;
    this.processState = { state: 'idle' };
  }

  private async startInternal(apiHealthy: () => Promise<boolean>): Promise<{ startedByLumia: boolean; elapsedMs: number }> {
    const startedAt = performance.now();
    if (await apiHealthy()) return { startedByLumia: false, elapsedMs: performance.now() - startedAt };
    const executablePath = this.findExecutable();
    if (!executablePath) {
      throw new LumiaServerError('OLLAMA_EXECUTABLE_NOT_FOUND', 'O executável do Ollama não foi encontrado no PATH nem nos locais oficiais.');
    }

    const alreadyRunning = await this.hasRunningProcess();
    this.processState = { state: 'starting', executablePath, startedAt: Date.now() };
    if (!alreadyRunning) this.launchManaged(executablePath);

    let delay = this.config.ollamaHealthRetryMs;
    while (performance.now() - startedAt < this.config.ollamaStartupTimeoutMs) {
      if (await apiHealthy()) {
        if (this.managedProcess) {
          this.processState = { state: 'managed', executablePath, pid: this.managedProcess.pid };
        } else {
          this.processState = { state: 'idle' };
        }
        return { startedByLumia: Boolean(this.managedProcess), elapsedMs: performance.now() - startedAt };
      }
      await this.sleep(delay);
      delay = Math.min(5000, Math.round(delay * 1.6));
    }

    const technicalMessage = alreadyRunning
      ? 'Já existe um processo Ollama, mas a API não ficou saudável dentro do limite. Nenhum processo duplicado foi iniciado.'
      : this.lastTechnicalOutput || 'A API do Ollama não ficou saudável dentro do limite.';
    this.processState = { state: 'failed', executablePath, technicalMessage };
    throw new LumiaServerError('OLLAMA_START_TIMEOUT', technicalMessage);
  }

  private launchManaged(executablePath: string): void {
    const child = this.spawnProcess(executablePath, ['serve']);
    this.managedProcess = child;
    const capture = (chunk: Buffer | string) => {
      this.lastTechnicalOutput = `${this.lastTechnicalOutput}${chunk.toString()}`.slice(-4000);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.once('error', (error) => {
      this.lastTechnicalOutput = error.message;
      this.processState = { state: 'failed', executablePath, technicalMessage: error.message };
    });
    child.once('exit', (code) => {
      if (this.managedProcess !== child) return;
      this.managedProcess = undefined;
      if (this.processState.state === 'managed' || this.processState.state === 'starting') {
        this.processState = { state: 'failed', executablePath, technicalMessage: `Processo Ollama encerrado com código ${code ?? 'desconhecido'}.` };
      }
    });
  }
}

export function findOllamaExecutable(
  environment: NodeJS.ProcessEnv,
  exists: (filePath: string) => boolean = fs.existsSync,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const executable = platform === 'win32' ? 'ollama.exe' : 'ollama';
  const pathEntries = (environment.PATH ?? '').split(path.delimiter).filter(Boolean);
  const official = platform === 'win32'
    ? [
        environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
        environment.ProgramFiles && path.join(environment.ProgramFiles, 'Ollama', 'ollama.exe'),
      ]
    : ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  const candidates = [...pathEntries.map((entry) => path.join(entry, executable)), ...official.filter((item): item is string => Boolean(item))];
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

async function detectRunningOllamaProcess(platform: NodeJS.Platform): Promise<boolean> {
  if (platform !== 'win32') return false;
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', 'IMAGENAME eq ollama.exe', '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
      resolve(!error && /ollama\.exe/i.test(stdout));
    });
  });
}
