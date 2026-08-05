# Modelo de memória

## Categorias

- trabalho: contexto limitado ao turno, nunca persistido automaticamente;
- episódica: acontecimentos e conversas específicas;
- semântica pessoal: fatos, preferências, pessoas e projetos de Samuel;
- procedimental: como ajudar ou apresentar respostas em um escopo;
- relacionamento: contexto compartilhado sem falas ou reações prontas;
- autocontinuidade: decisões e mudanças da própria Lumia;
- opiniões: posições com razão, confiança e revisões próprias;
- assuntos pendentes: problemas, promessas e projetos ainda abertos;
- lições: feedback e resultados com escopo global, tópico, projeto ou relacionamento.

Cada memória tem IDs de mensagem, confiança, importância, datas, estado e histórico. Recuperação combina relevância textual, recência, importância, confiança, tipo e relação com o assunto. O banco inteiro nunca é enviado ao modelo.

Correções preservam o conteúdo anterior em `memory_revisions`. Ambiguidade marca a memória como incerta sem combinar versões. Exclusão pelo inspetor é lógica (`superseded`) e auditável, não uma perda silenciosa de histórico.

O self-model começa neutro. Uma atualização exige evidência explícita ou repetida, limita cada traço a uma mudança de 0,15 e registra valor anterior, novo, motivo, confiança e origem. Isso é adaptação persistente, não retreinamento.
