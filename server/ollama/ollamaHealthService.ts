import type { OllamaModelInfo, OllamaStatus } from '../../shared/protocol/index.js';
import type { ServerConfig } from '../config/env.js';
import { isLocalOllamaUrl } from '../config/env.js';
import type { OllamaClient, OllamaGenerationMetrics } from './ollamaClient.js';
import type { OllamaProcessManager } from './ollamaProcessManager.js';

type TagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    digest?: string;
    details?: { parameter_size?: string; quantization_level?: string };
  }>;
};

type PsResponse = { models?: Array<{ name?: string; model?: string; size?: number; size_vram?: number }> };

export class OllamaHealthService {
  private loading = false;
  private modelError?: string;

  constructor(
    private readonly config: ServerConfig,
    private readonly processManager: OllamaProcessManager,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async check(): Promise<OllamaStatus> {
    const base = { endpoint: this.config.ollamaBaseUrl, checkedAt: new Date().toISOString() };
    if (!isLocalOllamaUrl(this.config.ollamaBaseUrl)) {
      return { ...base, state: 'endpoint_invalid', technicalMessage: 'OLLAMA_BASE_URL deve apontar para HTTP local.' };
    }
    if (this.processManager.state.state === 'starting') {
      return {
        ...base,
        state: 'starting',
        executablePath: this.processManager.state.executablePath,
        elapsedMs: Date.now() - this.processManager.state.startedAt,
      };
    }

    try {
      const [versionResponse, tagsResponse, psResponse] = await Promise.all([
        this.request('/api/version'),
        this.request('/api/tags'),
        this.request('/api/ps').catch(() => null),
      ]);
      if (!versionResponse.ok || !tagsResponse.ok) throw new Error(`HTTP ${versionResponse.status}/${tagsResponse.status}`);
      const version = String(((await versionResponse.json()) as { version?: string }).version ?? 'desconhecida');
      const tagsPayload = (await tagsResponse.json()) as TagsResponse;
      const models = normalizeModels(tagsPayload);
      const installed = models.some((model) => model.name === this.config.ollamaModel);
      if (!installed) {
        return {
          ...base,
          state: 'model_missing',
          version,
          requiredModel: this.config.ollamaModel,
          models,
          installCommand: `ollama pull ${this.config.ollamaModel}`,
        };
      }
      if (this.modelError) return { ...base, state: 'model_error', version, model: this.config.ollamaModel, technicalMessage: this.modelError };
      if (this.loading) return { ...base, state: 'model_loading', version, model: this.config.ollamaModel, models };

      const psPayload = psResponse?.ok ? ((await psResponse.json()) as PsResponse) : undefined;
      const running = psPayload?.models?.find((item) => (item.name ?? item.model) === this.config.ollamaModel);
      if (!running?.size) return { ...base, state: 'ready', version, model: this.config.ollamaModel, models };
      const vram = running.size_vram ?? 0;
      if (vram <= 0) return { ...base, state: 'ready_cpu', version, model: this.config.ollamaModel, models, processor: '100% CPU' };
      const gpuPercent = Math.min(100, Math.round((vram / running.size) * 100));
      if (gpuPercent >= 99) return { ...base, state: 'ready_gpu', version, model: this.config.ollamaModel, models, processor: '100% GPU' };
      return {
        ...base,
        state: 'ready_mixed',
        version,
        model: this.config.ollamaModel,
        models,
        processor: `${100 - gpuPercent}% CPU / ${gpuPercent}% GPU`,
      };
    } catch (error) {
      const executablePath = this.processManager.findExecutable();
      if (!executablePath) return { ...base, state: 'executable_not_found' };
      return {
        ...base,
        state: 'service_offline',
        executablePath,
        canStart: true,
        technicalMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async start(): Promise<{ status: OllamaStatus; startedByLumia: boolean; elapsedMs: number }> {
    const result = await this.processManager.start(() => this.apiHealthy());
    return { status: await this.check(), ...result };
  }

  async warmUp(client: OllamaClient, signal: AbortSignal): Promise<OllamaGenerationMetrics> {
    this.loading = true;
    this.modelError = undefined;
    try {
      return await client.warmUp(signal);
    } catch (error) {
      this.modelError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.loading = false;
    }
  }

  clearModelError(): void {
    this.modelError = undefined;
  }

  shutdown(): void {
    this.processManager.shutdown();
  }

  private async apiHealthy(): Promise<boolean> {
    try {
      const response = await this.request('/api/version');
      return response.ok;
    } catch {
      return false;
    }
  }

  private request(pathname: string): Promise<Response> {
    return this.fetcher(`${this.config.ollamaBaseUrl}${pathname}`, { signal: AbortSignal.timeout(2500) });
  }
}

function normalizeModels(payload: TagsResponse): OllamaModelInfo[] {
  return (payload.models ?? []).flatMap((item) => {
    const name = item.name ?? item.model;
    if (!name) return [];
    return [{
      name,
      size: item.size ?? 0,
      digest: item.digest,
      parameterSize: item.details?.parameter_size,
      quantizationLevel: item.details?.quantization_level,
    }];
  });
}
