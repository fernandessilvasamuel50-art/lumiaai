#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "[LÚMIA] Atualizando Termux..."
pkg update -y
pkg upgrade -y

echo "[LÚMIA] Instalando pacotes necessários..."
pkg install -y python python-pip openssh curl wget ffmpeg mpv pulseaudio termux-api tmux nano

echo "[LÚMIA] Criando pastas..."
mkdir -p "$HOME/lumia_project"
mkdir -p "$HOME/lumia_project/logs"
mkdir -p "$HOME/lumia_project/audio"
mkdir -p "$HOME/lumia_project/vis"

echo "[LÚMIA] Aplicando permissões..."
chmod +x "$HOME/lumia_project/start_lumia.sh" 2>/dev/null || true

echo "[LÚMIA] Ativando wake lock..."
termux-wake-lock >/dev/null 2>&1 || true

echo ""
echo "======================================"
echo " SETUP BASE DA LÚMIA FINALIZADO"
echo "======================================"
echo ""
echo "Agora envie estes arquivos do PC para o celular:"
echo "- client_body.py"
echo "- config.sh"
echo "- start_lumia.sh"
echo ""
echo "Depois rode:"
echo "bash ~/lumia_project/start_lumia.sh"