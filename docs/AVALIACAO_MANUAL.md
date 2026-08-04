# Roteiro manual de avaliação da Lumia v0.2

Este roteiro não é executado automaticamente e nenhum texto abaixo entra no bundle de produção. Antes de começar, confirme Ollama, `qwen3:8b`, Cartesia e banco nos três indicadores da interface.

1. Inicie uma conversa sobre uma decisão pessoal real, apresentando contexto e sua preferência.
2. Exponha um argumento discutível e observe se Lumia forma e manifesta uma posição própria, inclusive discordando quando fizer sentido.
3. Abra o modo de desenvolvimento e confirme que a decisão estruturada foi concluída antes da primeira frase pública.
4. Anote a opinião registrada e encerre completamente backend e navegador.
5. Inicie o projeto novamente e mencione o mesmo assunto sem repetir todos os detalhes.
6. Confirme no painel que a opinião anterior foi recuperada e que a fala mantém continuidade sem alegar memórias inexistentes.
7. Apresente um argumento novo e melhor fundamentado.
8. Verifique se Lumia mantém ou altera a posição de maneira coerente; se alterar, confirme a atualização e a revisão preservada no banco.
9. Conte algo que ficará pendente, como uma decisão ou tarefa a revisar posteriormente, e confirme a criação de um `open_loop`.
10. Quando não houver turno ativo, use “Permitir que Lumia avalie se quer puxar um assunto agora”. Confirme que a avaliação pode resultar em silêncio e, quando iniciar, gera toda a fala pelo mesmo pipeline Ollama → segmentador → Cartesia.
11. Durante uma resposta longa, pressione Parar. Confirme interrupção imediata, ausência de áudio atrasado ou sobreposto e falta de consolidação de uma resposta incompleta.
12. Envie outra mensagem durante uma fala e confirme que o novo `turnId` substitui o anterior em cérebro, voz e player.

Registre as métricas reais mostradas no painel: memória, deliberação, carga do modelo, primeiro token, primeira frase, primeiro áudio, início da reprodução, tokens por segundo e duração total.
