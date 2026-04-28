import socket
import os
import time
import subprocess

CONFIG_PATH = os.path.expanduser("~/lumia_project/config.sh")

PC_IP = "192.168.28.119"
PC_PORT = 50505

AUDIO_FILE = os.path.expanduser("~/lumia_project/input.wav")
RESPONSE_FILE = os.path.expanduser("~/lumia_project/resposta.mp3")


def carregar_config():
    global PC_IP, PC_PORT

    if not os.path.exists(CONFIG_PATH):
        return

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()

            if linha.startswith("PC_IP="):
                PC_IP = linha.split("=")[1].replace('"', "").replace("'", "")

            elif linha.startswith("PC_PORT="):
                try:
                    PC_PORT = int(linha.split("=")[1].replace('"', "").replace("'", ""))
                except:
                    pass


def recv_exact(sock, size):
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("PC desconectou")
        data += chunk
    return data


def receber_bloco(sock):
    tamanho_raw = recv_exact(sock, 32).decode().strip()
    tamanho = int(tamanho_raw)

    if tamanho == 0:
        return b""

    return recv_exact(sock, tamanho)


def enviar_bloco(sock, data):
    sock.sendall(str(len(data)).encode().ljust(32))
    sock.sendall(data)


def gravar_audio(caminho=AUDIO_FILE, max_segundos=15):
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
    print("[REDE] Enviando áudio para o cérebro da LÚMIA...")

    with open(arquivo, "rb") as f:
        enviar_bloco(sock, f.read())

    print("[REDE] Áudio enviado com sucesso.")


def media_cmd(*args):
    subprocess.run(["cmd", "media_session", *args], check=False)


def executar_comando_android(comando):
    comando = comando.strip()

    if not comando:
        return

    print(f"[ANDROID] Executando comando: {comando}")

    if comando.startswith("CMD:DEEZER_SEARCH:"):
        busca = comando.replace("CMD:DEEZER_SEARCH:", "").strip()
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
        link = comando.replace("CMD:DEEZER_LINK:", "").strip()

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

    print("[ÁUDIO] Reproduzindo resposta da LÚMIA...")

    subprocess.run([
        "termux-media-player",
        "play",
        arquivo
    ], check=False)

    # Anti-eco: evita ela gravar a própria voz logo depois
    time.sleep(4)


def main():
    carregar_config()

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
            time.sleep(5)


if __name__ == "__main__":
    main()