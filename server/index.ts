import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from './config/env.js';
import { attachTtsWebSocketServer } from './ws/ttsServer.js';

const config = loadServerConfig();
const app = express();
const server = http.createServer(app);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..', '..');
const distPath = path.join(projectRoot, 'dist');

app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));

app.get('/api/status', (_request, response) => {
  response.json({
    ok: true,
    cartesiaConfigured: Boolean(config.cartesiaApiKey),
    modelId: config.cartesiaModelId,
    voiceId: config.cartesiaVoiceId,
    apiVersion: config.cartesiaApiVersion,
    outputEncoding: config.outputEncoding,
  });
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distPath, 'index.html'));
  });
}

attachTtsWebSocketServer(server, config);

server.listen(config.port, config.host, () => {
  console.log(`Lumia Voice Lab local em http://${config.host}:${config.port}`);
  console.log(`Configuração Cartesia: ${config.cartesiaApiKey ? 'presente' : 'ausente'} em ${config.envPath}`);
});

