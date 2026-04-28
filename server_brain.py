import socket
import asyncio
from pathlib import Path
import requests
import edge_tts
from faster_whisper import WhisperModel

HOST = "0.0.0.0"
PORT = 50505

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.1:8b"

VOICE_NAME = "pt-BR-FranciscaNeural"

BASE_DIR = Path(__file__).parent
TEMP_DIR = BASE_DIR / "temp"
TEMP_DIR.mkdir(exist_ok=True)

print("[LÚMIA] Carregando Faster-Whisper...")
whisper = WhisperModel("medium", device="cpu", compute_type="int8")


def recv_exact(sock, size):
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("Cliente desconectado")
        data += chunk
    return data


def receber_bloco(sock):
    tamanho_raw = recv_exact(sock, 32).decode().strip()
    tamanho = int(tamanho_raw)
    return recv_exact(sock, tamanho)


def enviar_bloco(sock, data):
    sock.sendall(str(len(data)).encode().ljust(32))
    if data:
        sock.sendall(data)


def transcrever(wav_path):
    segments, info = whisper.transcribe(
        str(wav_path),
        language="pt",
        beam_size=5,
        vad_filter=True,
    )
    return " ".join(seg.text.strip() for seg in segments).strip()


async def gerar_voz_async(texto, saida):
    communicate = edge_tts.Communicate(texto, VOICE_NAME)
    await communicate.save(str(saida))


def gerar_voz(texto, saida):
    asyncio.run(gerar_voz_async(texto, saida))


def limpar_texto_musica(texto):
    original = texto.strip()
    t = texto.lower().strip()

    remover = [
        "lúmia", "lumia",
        "por favor",
        "pra mim", "para mim",
        "aí", "ai",
        "no deezer",
        "deezer",
        "coloca", "coloque",
        "toca", "toque",
        "bota", "botar",
        "reproduz", "reproduzir",
        "abre", "abrir",
        "quero ouvir",
        "eu quero ouvir",
        "uma música", "uma musica",
        "música", "musica",
        "um som", "som",
        "playlist",
    ]

    busca = t
    for palavra in remover:
        busca = busca.replace(palavra, " ")

    busca = " ".join(busca.split())

    if not busca:
        busca = "músicas populares"

    return busca


def detectar_acao(texto_usuario):
    texto = texto_usuario.lower().strip()

    # volume
    if any(x in texto for x in ["aumenta o volume", "aumentar o volume", "sobe o volume", "volume mais alto"]):
        return "CMD:VOLUME_UP", "Aumentei o volume."

    if any(x in texto for x in ["abaixa o volume", "abaixar o volume", "diminui o volume", "volume mais baixo"]):
        return "CMD:VOLUME_DOWN", "Abaixei o volume."

    # mídia
    if any(x in texto for x in ["pausa", "pausar", "para a música", "parar a música"]):
        return "CMD:MEDIA_PLAY_PAUSE", "Pausei a música."

    if any(x in texto for x in ["continua", "continuar", "despausa", "volta a tocar"]):
        return "CMD:MEDIA_PLAY_PAUSE", "Continuando a música."

    if any(x in texto for x in ["próxima", "proxima", "pula essa", "passa essa", "próxima música", "proxima musica"]):
        return "CMD:MEDIA_NEXT", "Pulando para a próxima."

    if any(x in texto for x in ["volta música", "voltar música", "música anterior", "musica anterior", "volta essa"]):
        return "CMD:MEDIA_PREVIOUS", "Voltando para a música anterior."

    # música genérica
    gatilhos_musica = [
        "toca", "toque",
        "coloca", "coloque",
        "bota",
        "reproduz",
        "quero ouvir",
        "abre"
    ]

    termos_musica = [
        "música", "musica",
        "som",
        "playlist",
        "deezer",
        "álbum", "album"
    ]

    if any(g in texto for g in gatilhos_musica) and (
        any(m in texto for m in termos_musica) or len(texto.split()) >= 2
    ):
        busca = limpar_texto_musica(texto_usuario)
        return f"CMD:DEEZER_SEARCH:{busca}", f"Claro, vou procurar {busca} no Deezer."

    return None, None


def perguntar_ollama(texto):
    prompt_sistema = """
Você é LÚMIA, uma assistente virtual feminina local.

Responda em português do Brasil, de forma natural, direta e com personalidade.

Suas habilidades atuais:
- conversar com o usuário;
- ouvir áudio enviado pelo celular;
- responder com voz feminina;
- pedir para o celular abrir buscas no Deezer;
- controlar mídia do celular com play, pause, próxima e anterior;
- aumentar e abaixar o volume do celular.

Quando o usuário pedir algo que você ainda não consegue executar de verdade, não finja.
Diga que ainda não consegue fazer aquilo e explique de forma curta.
"""

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": f"{prompt_sistema}\n\nUsuário: {texto}\nLÚMIA:",
        "stream": False,
    }

    r = requests.post(OLLAMA_URL, json=payload, timeout=120)
    r.raise_for_status()

    return r.json().get("response", "").strip() or "Não consegui responder agora."


def handle_client(conn, addr):
    print(f"[REDE] Celular conectado: {addr}")

    while True:
        try:
            print("[REDE] Aguardando áudio do celular...")

            audio_bytes = receber_bloco(conn)

            input_wav = TEMP_DIR / "input_from_phone.wav"
            output_mp3 = TEMP_DIR / "lumia_response.mp3"

            input_wav.write_bytes(audio_bytes)
            print(f"[REDE] Áudio recebido: {len(audio_bytes)} bytes")

            print("[WHISPER] Transcrevendo...")
            texto_usuario = transcrever(input_wav)
            print(f"[USUÁRIO] {texto_usuario}")

            comando, resposta_acao = detectar_acao(texto_usuario)

            if not texto_usuario:
                resposta = "Eu não consegui ouvir direito. Pode repetir?"
                comando = ""
            elif resposta_acao:
                resposta = resposta_acao
            else:
                print("[OLLAMA] Pensando...")
                resposta = perguntar_ollama(texto_usuario)
                comando = ""

            print(f"[COMANDO] {comando}")
            print(f"[LÚMIA] {resposta}")

            print("[TTS] Gerando voz feminina...")
            gerar_voz(resposta, output_mp3)

            enviar_bloco(conn, comando.encode("utf-8"))
            enviar_bloco(conn, output_mp3.read_bytes())

            print("[REDE] Comando/resposta enviados ao celular.")

        except ConnectionError:
            print("[REDE] Celular desconectou.")
            break

        except Exception as e:
            print(f"[ERRO] {e}")

            fallback = TEMP_DIR / "fallback.mp3"
            gerar_voz("Tive um erro interno, mas continuo ativa.", fallback)

            try:
                enviar_bloco(conn, b"")
                enviar_bloco(conn, fallback.read_bytes())
            except Exception:
                break


def main():
    print(f"[LÚMIA] Servidor escutando em {HOST}:{PORT}")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((HOST, PORT))
        server.listen(1)

        while True:
            conn, addr = server.accept()
            with conn:
                handle_client(conn, addr)


if __name__ == "__main__":
    main()