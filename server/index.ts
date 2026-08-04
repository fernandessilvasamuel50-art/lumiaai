import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CognitivePlanner } from './cognition/cognitivePlanner.js';
import { ResponseGenerator } from './cognition/responseGenerator.js';
import { TurnConsolidator } from './cognition/turnConsolidator.js';
import { loadServerConfig } from './config/env.js';
import { LumiaPromptBuilder } from './config/lumiaPromptBuilder.js';
import { InitiativeService } from './initiative/initiativeService.js';
import { MemoryRepository } from './memory/memoryRepository.js';
import { OllamaClient } from './ollama/ollamaClient.js';
import { attachConversationWebSocketServer } from './ws/conversationServer.js';

const config = loadServerConfig();
const repository = new MemoryRepository(config.databasePath);
const ollama = new OllamaClient(config);
const prompts = new LumiaPromptBuilder();
const planner = new CognitivePlanner(ollama, prompts);
const generator = new ResponseGenerator(ollama, prompts);
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
  const ollamaStatus = await ollama.health();
  response.json({
    ok: true,
    cartesiaConfigured: Boolean(config.cartesiaApiKey),
    databaseReady: true,
    ollama: ollamaStatus,
    voiceModel: config.cartesiaModelId,
    outputEncoding: config.outputEncoding,
  });
});

app.post('/api/ollama/warmup', async (_request, response) => {
  const controller = new AbortController();
  try {
    await ollama.warmUp(controller.signal);
    response.json({ ok: true, model: config.ollamaModel });
  } catch (error) {
    response.status(503).json({ ok: false, error: error instanceof Error ? error.message : 'Falha no warm-up.' });
  }
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => response.sendFile(path.join(distPath, 'index.html')));
}

attachConversationWebSocketServer(server, { config, repository, planner, generator, consolidator, initiative });

server.listen(config.port, config.host, () => {
  console.log(`Lumia Cognitive Core em http://${config.host}:${config.port}`);
  console.log(`Cartesia configurada: ${config.cartesiaApiKey ? 'sim' : 'não'}; banco local pronto.`);
});

function shutdown(): void {
  server.close(() => {
    repository.close();
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
