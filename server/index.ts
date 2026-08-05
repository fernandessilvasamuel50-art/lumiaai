import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CognitiveBudgetController } from './cognition/cognitiveBudgetController.js';
import { CognitiveModeSelector } from './cognition/cognitiveModeSelector.js';
import { DeliberationService } from './cognition/deliberationService.js';
import { ResponseGenerator } from './cognition/responseGenerator.js';
import { ResponseReviewer } from './cognition/responseReviewer.js';
import { SituationInterpreter } from './cognition/situationInterpreter.js';
import { TurnConsolidator } from './cognition/turnConsolidator.js';
import { loadServerConfig } from './config/env.js';
import { LumiaPromptBuilder } from './config/lumiaPromptBuilder.js';
import { InitiativeService } from './initiative/initiativeService.js';
import { LocalKnowledgeProvider } from './knowledge/localKnowledgeProvider.js';
import { MemoryRepository } from './memory/memoryRepository.js';
import { OllamaClient } from './ollama/ollamaClient.js';
import { OllamaHealthService } from './ollama/ollamaHealthService.js';
import { OllamaProcessManager } from './ollama/ollamaProcessManager.js';
import { attachConversationWebSocketServer } from './ws/conversationServer.js';

const config = loadServerConfig();
const repository = new MemoryRepository(config.databasePath);
const processManager = new OllamaProcessManager(config);
const ollama = new OllamaClient(config);
const ollamaHealth = new OllamaHealthService(config, processManager);
const prompts = new LumiaPromptBuilder();
const interpreter = new SituationInterpreter(ollama, prompts);
const modeSelector = new CognitiveModeSelector();
const budgetController = new CognitiveBudgetController();
const knowledgeProvider = new LocalKnowledgeProvider(repository);
const deliberator = new DeliberationService(ollama, prompts);
const generator = new ResponseGenerator(ollama, prompts);
const reviewer = new ResponseReviewer(ollama, prompts);
const consolidator = new TurnConsolidator(ollama, prompts);
const initiative = new InitiativeService(ollama, prompts);

const app = express();
const server = http.createServer(app);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..', '..');
const distPath = path.join(projectRoot, 'dist');

app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));

app.get('/api/status', async (_request, response) => {
  response.json({
    ok: true,
    cartesiaConfigured: Boolean(config.cartesiaApiKey),
    databaseReady: true,
    ollama: await ollamaHealth.check(),
    voiceModel: config.cartesiaModelId,
    outputEncoding: config.outputEncoding,
  });
});

app.post('/api/ollama/start', async (_request, response) => {
  try {
    const result = await ollamaHealth.start();
    response.json({ ok: true, ...result });
  } catch (error) {
    response.status(503).json({ ok: false, code: errorCode(error), error: errorMessage(error), status: await ollamaHealth.check() });
  }
});

app.post('/api/ollama/retry', async (_request, response) => {
  ollamaHealth.clearModelError();
  response.json({ ok: true, status: await ollamaHealth.check() });
});

app.post('/api/ollama/warmup', async (_request, response) => {
  const controller = new AbortController();
  try {
    const metrics = await ollamaHealth.warmUp(ollama, controller.signal);
    response.json({ ok: true, model: config.ollamaModel, metrics, status: await ollamaHealth.check() });
  } catch (error) {
    response.status(503).json({ ok: false, code: errorCode(error), error: errorMessage(error), status: await ollamaHealth.check() });
  }
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => response.sendFile(path.join(distPath, 'index.html')));
}

attachConversationWebSocketServer(server, {
  config,
  repository,
  interpreter,
  modeSelector,
  budgetController,
  knowledgeProvider,
  deliberator,
  generator,
  reviewer,
  consolidator,
  initiative,
});

server.listen(config.port, config.host, () => {
  console.log(`Lumia Cognitive OS em http://${config.host}:${config.port}`);
  console.log(`Cartesia configurada: ${config.cartesiaApiKey ? 'sim' : 'não'}; banco local pronto.`);
  void initializeOllama();
});

async function initializeOllama(): Promise<void> {
  try {
    let status = await ollamaHealth.check();
    if (status.state === 'service_offline' && config.ollamaAutoStart) {
      const started = await ollamaHealth.start();
      status = started.status;
      console.log(`Ollama verificado em ${Math.round(started.elapsedMs)} ms; iniciado pela Lumia: ${started.startedByLumia ? 'sim' : 'não'}.`);
    }
    if (config.ollamaWarmup && ['ready', 'ready_cpu', 'ready_gpu', 'ready_mixed'].includes(status.state)) {
      const controller = new AbortController();
      const startedAt = performance.now();
      await ollamaHealth.warmUp(ollama, controller.signal);
      console.log(`Modelo ${config.ollamaModel} aquecido em ${Math.round(performance.now() - startedAt)} ms.`);
    }
  } catch (error) {
    console.error(`Inicialização do Ollama não concluída: ${errorMessage(error)}`);
  }
}

function shutdown(): void {
  ollamaHealth.shutdown();
  server.close(() => {
    repository.close();
    process.exit(0);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'TURN_FAILED';
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
