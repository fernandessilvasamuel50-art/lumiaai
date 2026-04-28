import socket
import os
import time
import subprocess

STATE_IDLE = "IDLE"
STATE_LISTENING = "LISTENING"
STATE_THINKING = "THINKING"
STATE_SPEAKING = "SPEAKING"

CONFIG_PATH = os.path.expanduser("~/lumia_project/config.sh")

PC_IP = "192.168.100.1"
PC_PORT = 50505

AUDIO_FILE = os.path.expanduser("~/lumia_project/input.wav")
RESPONSE_FILE = os.path.expanduser("~/lumia_project/resposta.mp3")

state = STATE_IDLE


def set_state(new_state):
    global state
    state = new_state
    print(f"[STATE] {state}")


def carregar_config():
    global PC_IP, PC_PORT

    if not os.path.exists(CONFIG_PATH):
        print("[CONFIG] config.sh não encontrado. Usando padrão.")
        return

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()

            if linha.startswith("PC_IP="):
                PC_IP = linha.split("=", 1)[1].replace('"', "").replace("'", "").strip()

            elif linha.startswith("PC_PORT="):
                PC_PORT = int(linha.split("=", 1)[1].replace('"', "").replace("'", "").strip())


def recv_exact(sock, size):
    data = b""

    while len(data) < size:
        chunk = sock.recv(size - len(data))

        if not chunk:
            raise ConnectionError("PC desconectou")

        data += chunk

    return data


def receber_bloco(sock):
    tamanho_raw = recv_exact(sock, 32).decode("utf-8", errors="ignore").strip()

    if not tamanho_raw:
        return b""

    tamanho = int(tamanho_raw)

    if tamanho <= 0:
        return b""

    return recv_exact(sock, tamanho)


def enviar_bloco(sock, data):
    sock.sendall(str(len(data)).encode("utf-8").ljust(32))

    if data:
        sock.sendall(data)


def media_cmd(*args):
    subprocess.run(["cmd", "media_session", *args], check=False)


def gravar_audio(caminho=AUDIO_FILE, max_segundos=12):
    set_state(STATE_LISTENING)
    print("[ÁUDIO] Aguardando sua fala...")

    if os.path.exists(caminho):
        os.remove(caminho)

    subprocess.Popen([
        "termux-microphone-record",
        "-f",
        caminho
    ])

    print("[ÁUDIO] Gravando... fale normalmente.")
    time.sleep(max_segundos)

    subprocess.run([
        "termux-microphone-record",
        "-q"
    ], check=False)

    time.sleep(1)

    if not os.path.exists(caminho):
        raise Exception("Arquivo de áudio não foi criado.")

    print("[ÁUDIO] Gravação finalizada.")
    return caminho


def enviar_audio(sock, arquivo):
    set_state(STATE_THINKING)
    print("[REDE] Enviando áudio para o cérebro da LÚMIA...")

    with open(arquivo, "rb") as f:
        enviar_bloco(sock, f.read())

    print("[REDE] Áudio enviado com sucesso.")


def executar_comando_android(comando):
    comando = comando.strip()

    if not comando:
        return

    print(f"[ANDROID] Executando comando: {comando}")

    if comando.startswith("CMD:DEEZER_SEARCH:"):
        busca = comando.replace("CMD:DEEZER_SEARCH:", "", 1).strip()
        busca_url = busca.replace(" ", "%20")

        subprocess.run([
            "am", "start",
            "-a", "android.intent.action.VIEW",
            "-d", f"https://www.deezer.com/search/{busca_url}"
        ], check=False)

        time.sleep(4)
        media_cmd("dispatch", "play")
        return

    if comando.startswith("CMD:DEEZER_LINK:"):
        link = comando.replace("CMD:DEEZER_LINK:", "", 1).strip()

        subprocess.run([
            "am", "start",
            "-a", "android.intent.action.VIEW",
            "-d", link
        ], check=False)

        time.sleep(4)
        media_cmd("dispatch", "play")
        return

    if comando == "CMD:MEDIA_PLAY":
        media_cmd("dispatch", "play")
        return

    if comando == "CMD:MEDIA_PAUSE":
        media_cmd("dispatch", "pause")
        return

    if comando == "CMD:MEDIA_PLAY_PAUSE":
        media_cmd("dispatch", "play-pause")
        return

    if comando == "CMD:MEDIA_NEXT":
        media_cmd("dispatch", "next")
        return

    if comando == "CMD:MEDIA_PREVIOUS":
        media_cmd("dispatch", "previous")
        return

    if comando == "CMD:VOLUME_UP":
        media_cmd("volume", "--stream", "3", "--adj", "raise")
        return

    if comando == "CMD:VOLUME_DOWN":
        media_cmd("volume", "--stream", "3", "--adj", "lower")
        return


def receber_resposta(sock, destino=RESPONSE_FILE):
    comando_bytes = receber_bloco(sock)
    comando = comando_bytes.decode("utf-8", errors="ignore").strip()

    if comando:
        executar_comando_android(comando)

    audio_bytes = receber_bloco(sock)

    if not audio_bytes:
        return None

    with open(destino, "wb") as f:
        f.write(audio_bytes)

    return destino


def tocar_audio(arquivo):
    if not arquivo:
        return

    set_state(STATE_SPEAKING)
    print("[ÁUDIO] Reproduzindo resposta da LÚMIA...")

    subprocess.run([
        "termux-media-player",
        "play",
        arquivo
    ], check=False)

    time.sleep(5)
    set_state(STATE_IDLE)


def main():
    carregar_config()
    set_state(STATE_IDLE)

    while True:
        try:
            print(f"[REDE] Conectando ao PC {PC_IP}:{PC_PORT}...")

            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.connect((PC_IP, PC_PORT))

                print("[REDE] Conectado ao cérebro da LÚMIA.")

                while True:
                    audio_path = gravar_audio()
                    enviar_audio(sock, audio_path)

                    resposta = receber_resposta(sock)
                    tocar_audio(resposta)

                    print("\n[LÚMIA] Pronta para ouvir novamente...\n")

        except Exception as e:
            print(f"[ERRO] {e}")
            print("[REDE] Tentando reconectar em 5 segundos...")
            set_state(STATE_IDLE)
            time.sleep(5)


if __name__ == "__main__":
    main()