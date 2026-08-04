import WebSocket from 'ws';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

const url = process.argv[2] || 'ws://127.0.0.1:8787/ws/conversation';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const sampleRate = Number(process.env.SMOKE_SAMPLE_RATE || 44100);
const message = process.env.SMOKE_MESSAGE || 'Responda de forma breve para validar o streaming.';
const turnId = randomUUID();

let firstAudioAt;
let doneAt;
let audioBytes = 0;
let receivedDone = false;
const startedAt = performance.now();

const socket = new WebSocket(url);
const timeout = setTimeout(() => {
  console.error('Smoke falhou: tempo limite aguardando streaming de áudio.');
  socket.close();
  process.exitCode = 1;
}, timeoutMs);

socket.on('open', () => {
  socket.send(
    JSON.stringify({
      type: 'turn.start',
      turnId,
      message,
      sampleRate,
    }),
  );
});

socket.on('message', (data, isBinary) => {
  if (isBinary) {
    audioBytes += data.byteLength;
    firstAudioAt ??= performance.now();
    return;
  }

  const message = JSON.parse(data.toString('utf8'));
  if (message.type === 'error') {
    clearTimeout(timeout);
    console.error(`Smoke falhou: ${message.message}`);
    socket.close();
    process.exitCode = 1;
  }

  if (message.type === 'turn.completed') {
    receivedDone = true;
    doneAt = performance.now();
    socket.close();
  }
});

socket.on('close', () => {
  clearTimeout(timeout);

  if (process.exitCode) {
    return;
  }

  if (!firstAudioAt || !receivedDone) {
    console.error('Smoke falhou: a geração terminou sem confirmar chunks de áudio em streaming.');
    process.exitCode = 1;
    return;
  }

  const firstAudioMs = Math.round(firstAudioAt - startedAt);
  const doneMs = Math.round((doneAt ?? performance.now()) - startedAt);
  console.log(`Streaming confirmado: primeiro áudio em ${firstAudioMs} ms; geração em ${doneMs} ms; ${audioBytes} bytes.`);
});

socket.on('error', (error) => {
  clearTimeout(timeout);
  console.error(`Smoke falhou: ${error.message}`);
  process.exitCode = 1;
});

