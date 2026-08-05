# Lumia Cognitive OS V0.3

Lumia é uma aplicação local de conversa por voz ao redor do `qwen3:8b`. Cada mensagem passa por percepção estruturada, recuperação de memória, deliberação, resposta dinâmica, revisão adaptativa, fala com proveniência e consolidação versionada.

Não há respostas, saudações, reações ou fallbacks falados no código. A Cartesia sintetiza exclusivamente texto autenticado vindo do stream do Ollama. Erros e controles técnicos ficam visuais e silenciosos.

## Arquitetura

```text
React/Vite + player PCM
        ↕ WebSocket local tipado
Node/Express — TurnOrchestrator
  ├─ OllamaHealthService + OllamaProcessManager
  ├─ SituationInterpreter → CognitiveFrame
  ├─ CognitiveModeSelector + CognitiveBudgetController
  ├─ LocalKnowledgeProvider → SQLite
  ├─ DeliberationService → CognitiveDecision
  ├─ ResponseGenerator → revisão crítica opcional
  ├─ GeneratedSpeechStream → CartesiaSpeechStream
  └─ TurnConsolidator → memória, opiniões, lições e self-model
```

Estados de um turno:

```text
RECEIVED → PERCEIVING → RETRIEVING → DELIBERATING
→ GENERATING → SPEAKING → CONSOLIDATING → COMPLETED
```

Alternativas: `CANCELLED`, `TECHNICAL_ERROR` e `WAITING_FOR_CLARIFICATION`. Transições inválidas são rejeitadas.

## Requisitos

- Windows 11;
- Node.js 24 e npm 11 recomendados;
- Ollama nativo;
- modelo `qwen3:8b`;
- chave Cartesia com acesso ao `sonic-3.5`.

## Instalação

```powershell
Set-Location C:\lumia
npm install
ollama pull qwen3:8b
Copy-Item C:\lumia\.env.example C:\lumia\.env
notepad C:\lumia\.env
```

O download do modelo é sempre explícito. A Lumia nunca baixa vários gigabytes silenciosamente.

Configuração:

```env
CARTESIA_API_KEY=cole_sua_chave_aqui
CARTESIA_VOICE_ID=5c5ad5e7-1020-476b-8b91-fdcbe9cc313c
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_NUM_CTX=8192
OLLAMA_KEEP_ALIVE=15m
OLLAMA_AUTO_START=true
OLLAMA_STARTUP_TIMEOUT_MS=30000
OLLAMA_HEALTH_RETRY_MS=1000
OLLAMA_WARMUP=true
LUMIA_DATABASE_PATH=./data/lumia.db
LUMIA_INITIATIVE_ENABLED=true
LUMIA_INITIATIVE_IDLE_MINUTES=10
```

A API key permanece no backend e nunca integra o protocolo do navegador.

## Iniciar

Com início automático do Ollama habilitado:

```powershell
Set-Location C:\lumia
npm run dev
```

Abra [http://127.0.0.1:5173](http://127.0.0.1:5173). O backend usa `http://127.0.0.1:8787`.

Também é possível controlar manualmente em dois terminais:

```powershell
# Terminal 1
ollama serve
```

```powershell
# Terminal 2
Set-Location C:\lumia
npm run dev
```

Produção:

```powershell
Set-Location C:\lumia
npm run build
npm start
```

## Diagnóstico e gerenciamento do Ollama

A API distingue serviço desligado, executável ausente, inicialização, endpoint inválido, modelo ausente, carga, erro do modelo e falha de stream. A interface oferece **Iniciar Ollama** e **Tentar novamente** quando aplicável.

O processo é iniciado somente por caminho conhecido, argumento fixo `serve`, sem shell e sem administrador. Um processo existente não é duplicado. No encerramento, a Lumia só encerra o processo que ela própria criou.

```powershell
Get-Command ollama -ErrorAction SilentlyContinue
ollama --version
ollama list
Get-Process ollama -ErrorAction SilentlyContinue
Invoke-RestMethod http://127.0.0.1:11434/api/version
Invoke-RestMethod http://127.0.0.1:11434/api/tags
Invoke-RestMethod http://127.0.0.1:11434/api/ps
```

O erro `ollama_unavailable` da V0.2 não era serviço offline: a primeira carga do modelo levou 16,39 s e o backend cancelava em 10 s, produzindo HTTP 499. A V0.3 usa timeout adaptativo de 120 a 240 s e classificação específica.

## Cognição generalista

O modo cognitivo é escolhido semanticamente pelo modelo em `CognitiveFrame`; não existe whitelist de assuntos ou detecção por palavras-chave. Modos configuram somente metodologia: profundidade, memória, hipóteses, passos, revisão, temperatura e orçamento.

O orçamento usa três caminhos:

- mínimo: 1.800 tokens de contexto, recuperação curta e resposta até 350 tokens;
- normal: 3.600 tokens de contexto e resposta até 900 tokens;
- profundo: 5.600 tokens de contexto, recuperação ampliada, revisão crítica e resposta até 1.200 tokens.

Esses limites controlam latência e contexto, não assuntos permitidos.

## Memória e aprendizado

O SQLite armazena experiência, não conhecimento geral já presente no Qwen:

- memória episódica;
- semântica pessoal;
- procedimental;
- relacionamento;
- autocontinuidade;
- opiniões versionadas;
- assuntos pendentes;
- lições de interação com escopo;
- self-model neutro e evolutivo.

Toda memória exige ID de mensagem. Correções e mudanças preservam a versão anterior. Ambiguidade marca incerteza. Alterações manuais no inspetor exigem motivo e entram no histórico. Exclusão é lógica e auditável.

Mudanças do perfil são graduais e exigem feedback explícito ou padrão repetido. Elas não alteram pesos do Qwen e não constituem fine-tuning.

## Zero falas roteirizadas

```text
Qwen NDJSON
→ OllamaStreamChunk nominal
→ GeneratedSpeechText nominal
→ SpeechProvenance
→ Cartesia
→ player PCM
```

O TTS rejeita literal, objeto forjado, origem diferente, `turnId` vencido, stream cancelado, modelo divergente ou proveniência incompleta. A revisão crítica, quando necessária, ocorre antes de liberar o candidato; há no máximo uma regeneração.

## Painel de desenvolvimento

O painel recolhível mostra:

- estado, versão, modelo e processador do Ollama quando evidenciado;
- máquina de estados;
- frame, modo, memória, decisão e orçamento;
- revisão crítica;
- perfil aplicado e consolidação;
- transcrição e proveniência;
- métricas reais por fase;
- erros técnicos;
- inspetor de memória com busca, tipo, fontes, histórico, correção, incerteza e exclusão.

Nenhuma cadeia de pensamento é exibida.

## Métricas

O protocolo suporta percepção, recuperação, deliberação, revisão, carga do modelo, primeiro token público, primeiro segmento, primeiro áudio, reprodução, tokens por segundo, consolidação e total. Valores vêm de `performance.now()` ou das métricas reais do Ollama; campos sem evidência ficam ausentes.

CPU/GPU só aparece quando `/api/ps` fornece `size` e `size_vram`. Sem modelo carregado, o status é apenas `ready`.

## Verificação

```powershell
Set-Location C:\lumia
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
git status
```

O smoke test opcional usa Ollama e Cartesia reais, portanto só deve ser executado conscientemente:

```powershell
npm run smoke:cognition
npm run smoke:stream
```

`smoke:cognition` valida percepção e deliberação locais sem chamar a Cartesia. `smoke:stream` percorre a voz real e pode consumir serviço pago.

O roteiro sem chamadas automáticas pagas está em [docs/manual-cognitive-evaluation.md](docs/manual-cognitive-evaluation.md).

## Documentação

- [Arquitetura cognitiva](docs/cognitive-architecture.md)
- [Proveniência da fala](docs/speech-provenance.md)
- [Modelo de memória](docs/memory-model.md)
- [Diagnóstico do Ollama](docs/ollama-troubleshooting.md)
- [Avaliação manual](docs/manual-cognitive-evaluation.md)

## Limitações reais

- Não há pesquisa web nem verificação de fatos atuais.
- Recuperação usa FTS5/LIKE e ranking local; não há embeddings nesta versão.
- A qualidade semântica depende do `qwen3:8b` e do hardware local.
- A voz depende da Cartesia e da internet; erros ficam silenciosos.
- Não há microfone, STT, câmera, visão, Android ou controle autônomo do Windows.
- O driver AMD antigo pode impedir caminhos de GPU; a aplicação não instala drivers nem inventa aceleração.
