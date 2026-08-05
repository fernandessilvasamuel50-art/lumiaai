# Arquitetura cognitiva V0.3

O núcleo combina quatro fontes distintas: capacidade geral do `qwen3:8b`, arquitetura cognitiva, memória recuperada e experiência persistida com Samuel. A aplicação não modifica os pesos do modelo.

## Fluxo

```text
RECEIVED → PERCEIVING → RETRIEVING → DELIBERATING
→ GENERATING → SPEAKING → CONSOLIDATING → COMPLETED
```

`CANCELLED`, `TECHNICAL_ERROR` e `WAITING_FOR_CLARIFICATION` são estados alternativos validados. Cada evento carrega `turnId`; o orquestrador e o navegador descartam turnos vencidos.

1. `SituationInterpreter` produz `CognitiveFrame` via Structured Outputs e Zod.
2. `CognitiveModeSelector` converte o modo semântico em metodologia, sem texto público.
3. `CognitiveBudgetController` escolhe contexto, recuperação, tokens, temperatura, timeout e revisão.
4. `LocalKnowledgeProvider` recupera somente contexto relevante do SQLite.
5. `DeliberationService` produz `CognitiveDecision`, valida IDs e proíbe silêncio em mensagem direta.
6. `ResponseGenerator` cria a fala dinamicamente. Caminhos simples fazem streaming imediato; caminhos críticos passam por uma revisão estrutural única.
7. `GeneratedSpeechStream` autentica, segmenta e marca proveniência antes da Cartesia.
8. `TurnConsolidator` trabalha em paralelo com a reprodução e persiste somente experiência com evidência.

O painel mostra frame, modo, orçamento, decisão e revisão observáveis. Cadeia de pensamento não é solicitada, persistida nem exibida.

## Conhecimento e incerteza

Conhecimento do modelo é o prior geral contido nos pesos. Recuperação é a seleção de experiência local. Memória é evidência persistida. Aprendizado por experiência atualiza registros e perfil; fine-tuning seria uma alteração real de pesos e não acontece nesta versão.
