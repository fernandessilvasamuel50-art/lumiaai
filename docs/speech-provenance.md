# Proveniência da fala

O caminho autorizado é:

```text
OllamaClient NDJSON
→ OllamaStreamChunk nominal
→ GeneratedSpeechStream
→ GeneratedSpeechText nominal + SpeechProvenance
→ CartesiaSpeechStream
```

O símbolo nominal de `OllamaStreamChunk` é privado ao cliente. O segmentador verifica marca em runtime, modelo, `turnId`, sequência crescente, sinal de cancelamento e turno atual. Cada segmento registra:

- `source: ollama_stream`;
- modelo real;
- `turnId`;
- sequências de chunks usadas;
- conclusão do segmento.

O gateway rejeita literal, objeto forjado, origem diferente, turno vencido, modelo divergente, cancelamento ou proveniência incompleta. Erros são eventos visuais e permanecem silenciosos. O frontend não importa o gateway de voz nem recebe a chave da Cartesia.

Testes de arquitetura procuram chamadas literais ao TTS e testam as rejeições em runtime. Fixtures sintéticas existem apenas nos testes.
