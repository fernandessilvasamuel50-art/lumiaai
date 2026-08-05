# Diagnóstico do Ollama

## Estados observáveis

`endpoint_invalid`, `executable_not_found`, `service_offline`, `starting`, `model_missing`, `model_loading`, `model_error`, `ready`, `ready_cpu`, `ready_gpu` e `ready_mixed` são distintos.

O gerenciador procura `ollama.exe` no PATH e nos diretórios oficiais do Windows. Ele executa somente o caminho encontrado com argumento fixo `serve`, `shell: false`, janela oculta e sem elevação. Antes de iniciar, consulta a API e procura processo existente; nunca cria duplicata nem encerra instância que não tenha criado.

```powershell
Get-Command ollama
ollama --version
ollama list
Get-Process ollama
Invoke-RestMethod http://127.0.0.1:11434/api/version
Invoke-RestMethod http://127.0.0.1:11434/api/tags
Invoke-RestMethod http://127.0.0.1:11434/api/ps
```

Se o modelo estiver ausente, execute conscientemente:

```powershell
ollama pull qwen3:8b
```

O aplicativo não baixa o modelo. A interface oferece `Iniciar Ollama` e `Tentar novamente`. O warm-up não produz fala e preserva `keep_alive`.

O erro observado na V0.2 ocorreu porque o backend cancelava `/api/chat` após 10 segundos enquanto o Qwen ainda carregava; o log real mostrou HTTP 499 aos 10,475 s. A carga validada levou 16,39 s. A V0.3 usa timeout adaptativo de 120–240 s e códigos distintos para serviço, modelo, carga e stream.

CPU/GPU só é mostrado quando `/api/ps` informa `size` e `size_vram`. Sem modelo carregado, o estado é `ready` e não há alegação de processador.
