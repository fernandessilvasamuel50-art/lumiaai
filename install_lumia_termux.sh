cat > ~/install_lumia_termux.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[LÚMIA] Atualizando Termux..."
pkg update -y && pkg upgrade -y

echo "[LÚMIA] Instalando dependências..."
pkg install -y python python-pip python-numpy openssh curl wget ffmpeg mpv portaudio clang pulseaudio termux-api

echo "[LÚMIA] Instalando libs Python..."
python -m pip install --upgrade pip
pip install --no-cache-dir sounddevice requests

echo "[LÚMIA] Criando pastas..."
mkdir -p ~/lumia_project/vis
mkdir -p ~/lumia_project/audio
mkdir -p ~/lumia_project/logs

echo "[LÚMIA] Criando config.sh..."
cat > ~/lumia_project/config.sh <<'CONFIG'
#!/data/data/com.termux/files/usr/bin/bash

export LUMIA_PC_IP="192.168.1.100"
export LUMIA_PC_PORT="50505"
export LUMIA_SAMPLE_RATE="16000"
export LUMIA_RECORD_SECONDS="4"
export LUMIA_PROJECT_DIR="$HOME/lumia_project"
CONFIG

chmod +x ~/lumia_project/config.sh

echo "[LÚMIA] Gerando vídeos do orbe com ffmpeg..."
ffmpeg -y -f lavfi -i "color=c=black:s=720x1280:d=4" -vf "drawbox=x=0:y=0:w=720:h=1280:color=black@1:t=fill,drawtext=text='LÚMIA IDLE':fontcolor=cyan:fontsize=60:x=(w-text_w)/2:y=(h-text_h)/2" ~/lumia_project/vis/idle.mp4

ffmpeg -y -f lavfi -i "color=c=black:s=720x1280:d=4" -vf "drawbox=x=0:y=0:w=720:h=1280:color=black@1:t=fill,drawtext=text='OUVINDO':fontcolor=yellow:fontsize=70:x=(w-text_w)/2:y=(h-text_h)/2" ~/lumia_project/vis/listening.mp4

ffmpeg -y -f lavfi -i "color=c=black:s=720x1280:d=4" -vf "drawbox=x=0:y=0:w=720:h=1280:color=black@1:t=fill,drawtext=text='FALANDO':fontcolor=lime:fontsize=70:x=(w-text_w)/2:y=(h-text_h)/2" ~/lumia_project/vis/speaking.mp4

echo "[LÚMIA] Criando client_body.py..."
cat > ~/lumia_project/client_body.py <<'PY'
import os
import socket
import struct
import subprocess
import time
import wave
from pathlib import Path

import sounddevice as sd


PROJECT_DIR = Path.home() / "lumia_project"
VIS_DIR = PROJECT_DIR / "vis"
AUDIO_DIR = PROJECT_DIR / "audio"

PC_IP = os.environ.get("LUMIA_PC_IP", "192.168.1.100")
PC_PORT = int(os.environ.get("LUMIA_PC_PORT", "50505"))
SAMPLE_RATE = int(os.environ.get("LUMIA_SAMPLE_RATE", "16000"))
RECORD_SECONDS = float(os.environ.get("LUMIA_RECORD_SECONDS", "4"))

IDLE_VIDEO = str(VIS_DIR / "idle.mp4")
LISTENING_VIDEO = str(VIS_DIR / "listening.mp4")
SPEAKING_VIDEO = str(VIS_DIR / "speaking.mp4")


class OrbPlayer:
    def __init__(self):
        self.proc = None
        self.current = None

    def play(self, video_path: str):
        if self.current == video_path and self.proc and self.proc.poll() is None:
            return

        self.stop()
        self.current = video_path

        try:
            self.proc = subprocess.Popen(
                [
                    "mpv",
                    "--loop-file=inf",
                    "--no-terminal",
                    "--really-quiet",
                    "--fs",
                    video_path,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            print(f"[ORBE] Erro ao abrir mpv: {e}")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=2)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass
        self.proc = None


def send_packet(sock: socket.socket, data: bytes):
    sock.sendall(struct.pack(">I", len(data)))
    sock.sendall(data)


def recv_exact(sock: socket.socket, size: int) -> bytes:
    buffer = b""
    while len(buffer) < size:
        chunk = sock.recv(size - len(buffer))
        if not chunk:
            raise ConnectionError("Conexão encerrada pelo servidor")
        buffer += chunk
    return buffer


def recv_packet(sock: socket.socket) -> bytes:
    size_bytes = recv_exact(sock, 4)
    size = struct.unpack(">I", size_bytes)[0]
    return recv_exact(sock, size)


def record_audio_wav() -> bytes:
    print("[ÁUDIO] Gravando...")

    recording = sd.rec(
        int(RECORD_SECONDS * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="int16",
    )
    sd.wait()

    temp_path = AUDIO_DIR / "input.wav"

    with wave.open(str(temp_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(recording.tobytes())

    return temp_path.read_bytes()


def play_audio_bytes(audio_bytes: bytes):
    out_path = AUDIO_DIR / "response.wav"
    out_path.write_bytes(audio_bytes)

    subprocess.run(
        ["mpv", "--no-video", "--really-quiet", str(out_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def connect_loop():
    orb = OrbPlayer()
    orb.play(IDLE_VIDEO)

    while True:
        sock = None

        try:
            print(f"[REDE] Conectando ao PC {PC_IP}:{PC_PORT}...")
            sock = socket.create_connection((PC_IP, PC_PORT), timeout=10)
            sock.settimeout(60)

            print("[REDE] Conectado ao cérebro da LÚMIA.")

            while True:
                orb.play(LISTENING_VIDEO)
                audio = record_audio_wav()

                print("[REDE] Enviando áudio para o PC...")
                send_packet(sock, audio)

                print("[REDE] Aguardando resposta...")
                response_audio = recv_packet(sock)

                orb.play(SPEAKING_VIDEO)
                play_audio_bytes(response_audio)

                orb.play(IDLE_VIDEO)
                time.sleep(0.5)

        except KeyboardInterrupt:
            print("[LÚMIA] Encerrando.")
            orb.stop()
            break

        except Exception as e:
            print(f"[ERRO] {e}")
            print("[REDE] Tentando reconectar em 5 segundos...")
            orb.play(IDLE_VIDEO)

            try:
                if sock:
                    sock.close()
            except Exception:
                pass

            time.sleep(5)


if __name__ == "__main__":
    os.system("termux-wake-lock 2>/dev/null")
    os.system("pulseaudio --start --exit-idle-time=-1 2>/dev/null")
    connect_loop()
PY

chmod +x ~/lumia_project/client_body.py

echo "[LÚMIA] Criando start_lumia.sh..."
cat > ~/lumia_project/start_lumia.sh <<'START'
#!/data/data/com.termux/files/usr/bin/bash

source "$HOME/lumia_project/config.sh"
cd "$HOME/lumia_project"

pulseaudio --start --exit-idle-time=-1 2>/dev/null
python client_body.py
START

chmod +x ~/lumia_project/start_lumia.sh

echo ""
echo "=========================================="
echo " INSTALAÇÃO DA LÚMIA NO CELULAR FINALIZADA"
echo "=========================================="
echo ""
echo "Edite o IP do PC aqui:"
echo "nano ~/lumia_project/config.sh"
echo ""
echo "Para iniciar:"
echo "bash ~/lumia_project/start_lumia.sh"
echo ""

EOF

chmod +x ~/install_lumia_termux.sh
bash ~/install_lumia_termux.sh