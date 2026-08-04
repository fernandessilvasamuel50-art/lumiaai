# Regra de zero falas roteirizadas

O caminho de voz aceita somente objetos `LlmSpeechSegment` marcados com a origem `ollama_stream`. Esses objetos são criados exclusivamente pelo segmentador alimentado pelos chunks incrementais de `/api/chat` do Ollama.

O backend não possui saudações, respostas alternativas, frases de espera ou mensagens de erro faladas. Erros interrompem o turno e viram eventos JSON visuais. O cliente Cartesia não expõe um método que aceite uma string arbitrária: ele exige o objeto de origem tipado e usa apenas seu texto dinâmico.

O teste de arquitetura em `tests/noScriptedSpeech.test.ts` verifica esse encadeamento e impede a reintrodução do antigo campo `transcript` vindo do frontend.
