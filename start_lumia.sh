#!/data/data/com.termux/files/usr/bin/bash

PROJECT_DIR="$HOME/lumia_project"
SESSION_NAME="lumia"

mkdir -p "$PROJECT_DIR/logs"

termux-wake-lock >/dev/null 2>&1 || true

if ! command -v tmux >/dev/null 2>&1; then
  echo "[ERRO] tmux não está instalado. Rode: pkg install tmux"
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[LÚMIA] Sessão tmux já existe. Entrando nela..."
  tmux attach-session -t "$SESSION_NAME"
  exit 0
fi

echo "[LÚMIA] Criando sessão tmux persistente..."

tmux new-session -d -s "$SESSION_NAME" "
cd '$PROJECT_DIR'
while true; do
  termux-wake-lock >/dev/null 2>&1 || true
  echo '[LÚMIA] Iniciando client_body.py...'
  python client_body.py
  echo '[LÚMIA] client_body.py caiu. Reiniciando em 5 segundos...'
  sleep 5
done
"

tmux attach-session -t "$SESSION_NAME"