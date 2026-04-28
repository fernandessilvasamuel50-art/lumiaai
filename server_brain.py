import socket
import asyncio
import re
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


def transcrever(wav_path):
    segments, info = whisper.transcribe(
        str(wav_path),
        language="pt",
        beam_size=5,
        vad_filter=True,
    )

    return " ".join(seg.text.strip() for seg in segments).strip()


async def gerar_voz_async(texto, saida):
    communicate = edge_tts.Communicate(
        texto,
        VOICE_NAME,
        rate="-5%",
        volume="+0%"
    )

    await communicate.save(str(saida))


def gerar_voz(texto, saida):
    asyncio.run(gerar_voz_async(texto, saida))


def limpar_busca_musica(texto):
    texto = texto.lower().strip()

    texto = re.sub(r"^(oi|olá|ola|e aí|e ai)\s+(lúmia|lumia)[, ]*", "", texto)
    texto = re.sub(r"^(lúmia|lumia)[, ]*", "", texto)
    texto = re.sub(r"tudo bem( com você| contigo)?\??", "", texto)

    padroes = [
        r".*?\btoca\b",
        r".*?\btoque\b",
        r".*?\bcoloca\b",
        r".*?\bcoloque\b",
        r".*?\bbota\b",
        r".*?\breproduz\b",
        r".*?\bquero ouvir\b",
        r".*?\bprocura\b",
        r".*?\bbusca\b",
    ]

    busca = texto

    for padrao in padroes:
        novo = re.sub(padrao, "", busca).strip()

        if novo != busca:
            busca = novo
            break

    remover = [
        "uma música", "uma musica",
        "a música", "a musica",
        "música", "musica",
        "um som", "som",
        "no deezer",
        "deezer",
        "pra mim",
        "para mim",
        "por favor",
        "aí",
        "ai",
    ]

    for item in remover:
        busca = busca.replace(item, " ")

    busca = " ".join(busca.split()).strip(" ,.!?")

    if not busca:
        busca = "músicas populares"

    return busca


def detectar_acao(texto_usuario):
    texto = texto_usuario.lower().strip()

    # volume primeiro
    if any(frase in texto for frase in [
        "aumenta o volume",
        "aumentar o volume",
        "sobe o volume",
        "volume mais alto",
        "aumenta o som",
        "sobe o som",
    ]):
        return "CMD:VOLUME_UP", "Aumentei o volume."

    if any(frase in texto for frase in [
        "abaixa o volume",
        "abaixar o volume",
        "diminui o volume",
        "volume mais baixo",
        "abaixa o som",
        "diminui o som",
    ]):
        return "CMD:VOLUME_DOWN", "Abaixei o volume."

    # controle de mídia
    if any(frase in texto for frase in [
        "pausa",
        "pausar",
        "pause",
        "para a música",
        "parar a música",
        "para de tocar",
    ]):
        return "CMD:MEDIA_PAUSE", "Pausei."

    if any(frase in texto for frase in [
        "continua",
        "continuar",
        "despausa",
        "dá play",
        "dar play",
        "toca de novo",
        "volta a tocar",
    ]):
        return "CMD:MEDIA_PLAY", "Continuando."

    if any(frase in texto for frase in [
        "próxima",
        "proxima",
        "pula essa",
        "passa essa",
        "próxima música",
        "proxima musica",
    ]):
        return "CMD:MEDIA_NEXT", "Pulando para a próxima."

    if any(frase in texto for frase in [
        "música anterior",
        "musica anterior",
        "volta uma música",
        "volta uma musica",
        "anterior",
    ]):
        return "CMD:MEDIA_PREVIOUS", "Voltando para a anterior."

    # música genérica
    gatilhos_musica = [
        "toca",
        "toque",
        "coloca",
        "coloque",
        "bota",
        "reproduz",
        "quero ouvir",
        "procura",
        "busca",
    ]

    palavras_musica = [
        "música",
        "musica",
        "som",
        "playlist",
        "álbum",
        "album",
        "cantor",
        "cantora",
        "banda",
        "artista",
        "deezer",
    ]

    tem_gatilho = any(g in texto for g in gatilhos_musica)
    tem_musica = any(m in texto for m in palavras_musica)

    if tem_gatilho:
        busca = limpar_busca_musica(texto_usuario)

        if busca:
            return f"CMD:DEEZER_SEARCH:{busca}", f"Vou procurar {busca} no Deezer."

    if tem_musica and "deezer" in texto:
        busca = limpar_busca_musica(texto_usuario)
        return f"CMD:DEEZER_SEARCH:{busca}", f"Vou procurar {busca} no Deezer."

    return "", ""


def perguntar_ollama(texto):
    prompt_sistema = """
Você é LÚMIA, uma assistente virtual feminina local.

Responda em português do Brasil.
Seja natural, direta, útil e com personalidade.

Suas habilidades reais atuais:
- conversar com o usuário;
- ouvir áudio enviado pelo celular;
- responder com voz feminina;
- mandar o celular buscar músicas no Deezer;
- controlar mídia no celular com play, pause, próxima e anterior;
- aumentar e abaixar volume do celular.

Regras importantes:
- Não diga que executou algo se nenhum comando foi enviado.
- Não use ações falsas como "*tocando música*".
- Se só abriu uma busca no Deezer, diga que procurou no Deezer, não que a música já está tocando.
- Se o usuário pedir algo que você ainda não faz, diga: "Ainda não consigo fazer isso, mas posso tentar ajudar de outro jeito."
- Para comandos, responda curto.
"""

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": f"{prompt_sistema}\n\nUsuário: {texto}\nLÚMIA:",
        "stream": False,
    }

    resposta = requests.post(OLLAMA_URL, json=payload, timeout=120)
    resposta.raise_for_status()

    return resposta.json().get("response", "").strip() or "Não consegui responder agora."


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

            if not texto_usuario:
                comando = ""
                resposta = "Não consegui ouvir direito. Pode repetir?"
            else:
                comando, resposta_acao = detectar_acao(texto_usuario)

                if resposta_acao:
                    resposta = resposta_acao
                else:
                    print("[OLLAMA] Pensando...")
                    resposta = perguntar_ollama(texto_usuario)

            print(f"[COMANDO] {comando}")
            print(f"[LÚMIA] {resposta}")

            print("[TTS] Gerando voz feminina...")
            gerar_voz(resposta, output_mp3)

            enviar_bloco(conn, comando.encode("utf-8") if comando else b"")
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