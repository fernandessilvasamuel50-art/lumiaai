# Lumia Voice Lab v0.1

Protótipo local para testar a voz escolhida na Cartesia com TTS em streaming. A primeira versão roda no navegador, mas a integração foi separada para facilitar um futuro empacotamento desktop no Windows.

## Objetivo

Digitar um texto, clicar em **Falar** e ouvir a voz da Cartesia começar antes da geração completa terminar. A tela mede latência até o primeiro chunk de áudio, início de reprodução, duração da geração e duração aproximada do áudio.

## Arquitetura

Frontend React + Vite → WebSocket local → backend Node.js/Express → WebSocket Cartesia → chunks PCM de volta ao navegador → Web Audio API.

O frontend nunca recebe a API key. A chave é carregada somente pelo backend a partir de `C:\lumia.env`. Se o Windows bloquear escrita na raiz `C:\`, o backend também aceita o fallback local `C:\lumia\.env`, que está no `.gitignore`.

## Requisitos

- Windows.
- Node.js 24.x recomendado. Este protótipo foi criado com Node.js 24.11.0 e npm 11.6.1.
- Conta Cartesia com acesso ao modelo `sonic-3.5` e ao Voice ID configurado.

## Configuração da Cartesia

Crie ou edite o arquivo local:

```powershell
notepad C:\lumia.env
```

Conteúdo:

```env
CARTESIA_API_KEY=sua_chave_aqui
CARTESIA_VOICE_ID=5c5ad5e7-1020-476b-8b91-fdcbe9cc313c
```

Se o Windows negar permissão para criar `C:\lumia.env`, use o fallback:

```powershell
notepad C:\lumia\.env
```

Também existe `C:\lumia\.env.example` como referência local. O `.env` do projeto está no `.gitignore`.

## Instalação

```powershell
cd C:\lumia
npm install
```

## Desenvolvimento

```powershell
cd C:\lumia
npm run dev
```

Abra o endereço exibido pelo Vite, normalmente:

```text
http://127.0.0.1:5173/
```

## Comandos

```powershell
npm run dev          # backend local + frontend Vite
npm run lint         # ESLint
npm test             # testes unitários
npm run build        # TypeScript + build Vite + build backend
npm start            # serve o build final pelo backend
npm run smoke:stream # teste curto de streaming, requer backend rodando e chave configurada
```

## Trocar Voice ID

Edite `C:\lumia.env`:

```env
CARTESIA_VOICE_ID=novo_voice_id
```

Depois reinicie `npm run dev`.

## Diagnóstico

- **Backend offline**: confirme que `npm run dev` está rodando e que a porta `8787` está livre.
- **Cartesia aguardando configuração**: preencha `CARTESIA_API_KEY` em `C:\lumia.env` e reinicie o servidor.
- **Autenticação recusada**: verifique se a chave Cartesia está ativa.
- **Voz não encontrada**: confira `CARTESIA_VOICE_ID`.
- **Sem áudio**: verifique a saída de som do Windows e se o navegador não bloqueou reprodução após o clique.

## Limitações

- Ainda não há Electron, instalador ou empacotamento desktop.
- Ainda não há LLM; o texto é manual.
- O teste automatizado confirma chegada de chunks em streaming, mas não valida audição humana.
- A voz depende de permissões da conta Cartesia para o Voice ID informado.

## Próximos passos com LLM

- Adicionar um orquestrador de resposta que envie fragmentos do LLM para o backend.
- Usar continuações/contextos do WebSocket da Cartesia para falar frases parciais.
- Adicionar interrupção por fala do usuário e STT em streaming.
- Persistir preferências locais de voz, velocidade e volume.

## Referências oficiais

- Cartesia TTS WebSocket: https://docs.cartesia.ai/api-reference/tts/websocket
- Sonic 3.5: https://docs.cartesia.ai/build-with-cartesia/tts-models/latest
- Formato de áudio TTS: https://docs.cartesia.ai/build-with-cartesia/capability-guides/tts-output-audio-format
- Volume e velocidade: https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion
