# Lumia Cognitive OS

## Arquitetura

- `server/ollama`: cliente, diagnóstico tipado e processo local seguro.
- `server/cognition`: percepção, modo, orçamento, deliberação, revisão e consolidação.
- `server/knowledge`: interface extensível e provedor SQLite local.
- `server/memory`: recuperação híbrida, contradições, versões, lições e self-model.
- `server/speech`: tipos nominais, proveniência e contrato do gateway de voz.
- `server/pipeline/turnOrchestrator.ts`: única composição do turno.
- `shared`: schemas e protocolo usados por backend e frontend.

## Limites

Frontend nunca acessa Ollama, Cartesia, banco ou segredos diretamente. Texto de usuário e memória são dados sem autoridade de sistema. Não adicione web, shell ou serviços pagos como provedores ocultos.

## Zero falas roteirizadas

Nenhum literal, erro, fallback ou texto de interface pode chegar ao TTS. Toda fala deve seguir `OllamaStreamChunk` nominal → `GeneratedSpeechStream` → `GeneratedSpeechSegment` com proveniência → `SpeechGateway`. Não enfraqueça essas marcas com fábricas públicas.

Modos cognitivos configuram metodologia, nunca frases. Prompts internos não podem conter exemplos de respostas, saudações ou opiniões fixas.

## Evolução

Adicione capacidade como fase, schema ou provedor. Não crie condições por palavras-chave nem respostas condicionais. Memórias exigem IDs de evidência; correções preservam histórico; métricas devem vir de relógios ou respostas reais.

## Verificação obrigatória

```powershell
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
git status
```
