# Motor do Direct pelo login do Instagram (instagrapi, não oficial).
#
# Processo separado, ligado pelo CRM (privado.js). Conversa por linhas JSON:
#   entrada (stdin):  {"id": 1, "cmd": "inbox", "perfil": 3, ...}
#   saída  (stdout):  {"id": 1, "ok": true, ...}  ou  {"id": 1, "erro": "texto", "tipo": "login|desafio|limite|..."}
# Um pedido por vez, na ordem em que chegam (assim um envio nunca se cruza com uma busca do mesmo perfil).
#
# Leitura: pedidos crus à API privada (direct_v2/inbox, pending_inbox, threads) e conversão própria das mensagens,
# para uma mudança de formato do Instagram não derrubar a caixa inteira. Envio: funções da biblioteca.
import json
import os
import sys
import time
import traceback
from pathlib import Path

try:
    from instagrapi import Client
    from instagrapi import exceptions as ex
except Exception as erro:  # biblioteca não instalada ou quebrada
    sys.stdout.write(json.dumps({"evento": "falha", "erro": f"instagrapi não carregou: {erro}"}) + "\n")
    sys.stdout.flush()
    sys.exit(3)

PASTA_SESSOES = Path(os.environ.get("IG_PRIVADO_SESSOES", "."))
clientes = {}  # perfil -> Client


def responder(dados):
    sys.stdout.write(json.dumps(dados, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()


# ------------------------------------------------------------------ erros → tipo (o CRM decide o que fazer)

def tipo_do_erro(e):
    nome = type(e).__name__
    if isinstance(e, (ex.ChallengeError,)) or "Challenge" in nome or "Captcha" in nome:
        return "desafio"
    if isinstance(e, ex.AccountSuspended):
        return "suspensa"
    if isinstance(e, (ex.LoginRequired, ex.ClientUnauthorizedError, ex.ClientLoginRequired, ex.ReloginAttemptExceeded, ex.BadCredentials)):
        return "login"
    if isinstance(e, ex.FeedbackRequired):
        return "bloqueio"
    if isinstance(e, (ex.PleaseWaitFewMinutes, ex.RateLimitError, ex.ClientThrottledError, ex.SentryBlock)):
        return "limite"
    if isinstance(e, (ex.ProxyAddressIsBlocked,)):
        return "proxy"
    if isinstance(e, (ex.ClientConnectionError, ex.ClientRequestTimeout, ex.ClientIncompleteReadError)):
        return "rede"
    if isinstance(e, (ex.DirectThreadNotFound, ex.NotFoundError)):
        return "nao_existe"
    if isinstance(e, ex.DirectMessageRequestsDisabled):
        return "bloqueado_pela_pessoa"
    if isinstance(e, AssertionError):
        return "login" if "sessionid" in str(e).lower() or "login required" in str(e).lower() else "dados"
    return "outro"


# ------------------------------------------------------------------ sessão

def arquivo_sessao(perfil):
    return PASTA_SESSOES / f"perfil-{int(perfil)}.json"


def novo_cliente(proxy):
    cl = Client()
    cl.delay_range = [1, 3]  # pausa humana entre ações da própria biblioteca
    if proxy:
        cl.set_proxy(proxy)
    return cl


def entrar(p):
    perfil = p["perfil"]
    sessionid = str(p.get("sessionid") or "").strip()
    proxy = str(p.get("proxy") or "").strip() or None
    cl = novo_cliente(proxy)
    arq = arquivo_sessao(perfil)
    if arq.exists():
        # Mesmo "aparelho" das outras vezes (o Instagram estranha aparelho novo a cada entrada)
        try:
            cl.load_settings(arq)
            if proxy:
                cl.set_proxy(proxy)
        except Exception:
            pass
    if not sessionid:
        raise AssertionError("Falta o sessionid")
    cl.login_by_sessionid(sessionid)
    PASTA_SESSOES.mkdir(parents=True, exist_ok=True)
    cl.dump_settings(arq)
    try:
        os.chmod(arq, 0o600)
    except Exception:
        pass
    clientes[perfil] = cl
    return {"pk": str(cl.user_id), "username": cl.username}


def cliente(p):
    cl = clientes.get(p["perfil"])
    if cl is None:
        if p.get("sessionid"):
            entrar(p)
            cl = clientes[p["perfil"]]
        else:
            raise ex.LoginRequired("Perfil sem sessão no motor")
    return cl


def salvar_sessao(perfil):
    cl = clientes.get(perfil)
    if cl is None:
        return
    try:
        cl.dump_settings(arquivo_sessao(perfil))
    except Exception:
        pass


# ------------------------------------------------------------------ mensagens cruas → formato do CRM

def primeira_url(lista):
    for c in lista or []:
        if isinstance(c, dict) and c.get("url"):
            return c["url"]
    return None


def url_da_midia(m):
    """Foto ou vídeo de um item de mídia cru → (tipo, url)"""
    if not isinstance(m, dict):
        return None, None
    if m.get("video_versions"):
        return "video", primeira_url(m.get("video_versions"))
    cands = (m.get("image_versions2") or {}).get("candidates")
    if cands:
        return "imagem", primeira_url(cands)
    if m.get("carousel_media"):
        return url_da_midia(m["carousel_media"][0])
    return None, None


def link_do_post(m):
    if not isinstance(m, dict):
        return None
    code = m.get("code")
    if code:
        tipo = "reel" if m.get("product_type") == "clips" else "p"
        return f"https://www.instagram.com/{tipo}/{code}/"
    return None


def converter_item(item, meu_pk):
    tipo_ig = item.get("item_type") or ""
    d = {
        "mid": str(item.get("item_id")),
        "de_mim": str(item.get("user_id")) == str(meu_pk),
        "timestamp_us": int(item.get("timestamp") or 0),
        "texto": None,
        "anexos": [],
        "story": None,
        "nao_suportada": False,
        "reacoes": [],
        "resposta_mid": None,
    }
    for r in ((item.get("reactions") or {}).get("emojis") or []):
        d["reacoes"].append({"de": str(r.get("sender_id")), "emoji": r.get("emoji")})
    if item.get("replied_to_message"):
        d["resposta_mid"] = str((item["replied_to_message"] or {}).get("item_id") or "") or None

    if tipo_ig == "text":
        d["texto"] = item.get("text")
    elif tipo_ig == "link":
        lk = item.get("link") or {}
        d["texto"] = lk.get("text")
    elif tipo_ig == "like":
        d["texto"] = item.get("like") or "❤️"
    elif tipo_ig == "media":
        t, url = url_da_midia(item.get("media"))
        if url:
            d["anexos"].append({"tipo": t, "url": url})
        else:
            d["nao_suportada"] = True
    elif tipo_ig == "voice_media":
        audio = ((item.get("voice_media") or {}).get("media") or {}).get("audio") or {}
        url = audio.get("audio_src")
        if url:
            d["anexos"].append({"tipo": "audio", "url": url, "mime": "audio/mp4"})
        else:
            d["nao_suportada"] = True
    elif tipo_ig == "animated_media":
        img = ((item.get("animated_media") or {}).get("images") or {}).get("fixed_height") or {}
        if img.get("url"):
            d["anexos"].append({"tipo": "imagem", "url": img["url"], "mime": "image/gif"})
    elif tipo_ig in ("media_share", "clip", "felix_share"):
        m = item.get("media_share") or (item.get("clip") or {}).get("clip") or item.get("clip") or (item.get("felix_share") or {}).get("video")
        link = link_do_post(m)
        d["anexos"].append({"tipo": "reel" if tipo_ig != "media_share" else "post", "url": link, "nome": ((m or {}).get("caption") or {}).get("text", "")[:120] if isinstance((m or {}).get("caption"), dict) else None})
        d["texto"] = item.get("text")
    elif tipo_ig == "story_share":
        ss = item.get("story_share") or {}
        _, url = url_da_midia(ss.get("media"))
        d["story"] = {"tipo": "compartilhado", "url": url}
        d["texto"] = ss.get("message") or ss.get("title")
    elif tipo_ig == "reel_share":
        rs = item.get("reel_share") or {}
        _, url = url_da_midia(rs.get("media"))
        tipo_rs = rs.get("type")
        if tipo_rs == "mention":
            d["story"] = {"tipo": "mencao", "url": url}
        else:
            d["story"] = {"tipo": "resposta", "url": url}
        d["texto"] = rs.get("text")
    elif tipo_ig.startswith("xma"):
        lista = item.get(tipo_ig) or []
        x = lista[0] if isinstance(lista, list) and lista else (lista if isinstance(lista, dict) else {})
        alvo = x.get("target_url") or x.get("preview_url")
        if tipo_ig in ("xma_story_share", "xma_reel_share", "xma_reel_mention"):
            d["story"] = {"tipo": "mencao" if "mention" in tipo_ig else "resposta", "url": x.get("preview_url")}
            d["texto"] = item.get("text") or x.get("title_text")
        else:
            d["anexos"].append({"tipo": "reel" if "clip" in tipo_ig or "reel" in tipo_ig else "compartilhamento", "url": alvo, "nome": x.get("title_text")})
            d["texto"] = item.get("text")
    elif tipo_ig in ("action_log", "video_call_event", "placeholder_message"):
        return None  # avisos do sistema ("fulano curtiu", chamadas): não são mensagens
    elif tipo_ig in ("raven_media", "visual_media"):
        d["nao_suportada"] = True
        d["texto"] = "Foto ou vídeo temporário (só abre no app)"
    else:
        d["nao_suportada"] = True
        d["texto"] = item.get("text")
    return d


def converter_thread(t, meu_pk):
    users = []
    for u in t.get("users") or []:
        users.append({
            "pk": str(u.get("pk") or u.get("pk_id") or u.get("id")),
            "username": u.get("username"),
            "nome": u.get("full_name"),
            "foto": u.get("profile_pic_url"),
            "verificado": bool(u.get("is_verified")),
        })
    itens = []
    for it in t.get("items") or []:
        try:
            c = converter_item(it, meu_pk)
            if c:
                itens.append(c)
        except Exception as e:
            itens.append({"mid": str(it.get("item_id")), "de_mim": str(it.get("user_id")) == str(meu_pk),
                          "timestamp_us": int(it.get("timestamp") or 0), "texto": None, "anexos": [], "story": None,
                          "nao_suportada": True, "reacoes": [], "resposta_mid": None, "erro": str(e)[:120]})
    return {
        "thread_id": str(t.get("thread_id")),
        "grupo": bool(t.get("is_group")) or len(users) > 1,
        "pendente": bool(t.get("pending")),
        "ultima_us": int(t.get("last_activity_at") or 0),
        "usuarios": users,
        "itens": itens,
        "tem_mais": bool(t.get("has_older")),
        "cursor": t.get("oldest_cursor"),
    }


# ------------------------------------------------------------------ comandos

def cmd_entrar(p):
    return entrar(p)


def cmd_sair(p):
    clientes.pop(p["perfil"], None)
    if p.get("apagar_sessao"):
        try:
            arquivo_sessao(p["perfil"]).unlink()
        except FileNotFoundError:
            pass
    return {}


def cmd_inbox(p):
    cl = cliente(p)
    limite = max(1, min(int(p.get("limite") or 20), 100))
    por_thread = max(1, min(int(p.get("msgs") or 10), 20))
    pendentes = bool(p.get("pendentes"))
    caminho = "direct_v2/pending_inbox/" if pendentes else "direct_v2/inbox/"
    threads = []
    cursor = None
    while len(threads) < limite:
        params = {
            "visual_message_return_type": "unseen",
            "persistentBadging": "true",
            "is_prefetching": "false",
            "limit": str(min(20, limite)),
            "thread_message_limit": str(por_thread),
        }
        if not pendentes:
            params.update({"eb_device_id": "0", "igd_request_log_tracking_id": cl.generate_uuid(), "fetch_reason": "initial_snapshot" if not cursor else "page_scroll", "no_pending_badge": "true"})
        if cursor:
            params.update({"cursor": cursor, "direction": "older"})
        r = cl.private_request(caminho, params=params)
        inbox = r.get("inbox") or {}
        for t in inbox.get("threads") or []:
            threads.append(converter_thread(t, cl.user_id))
        cursor = inbox.get("oldest_cursor")
        if not cursor or not inbox.get("has_older"):
            break
        time.sleep(1.5)
    salvar_sessao(p["perfil"])
    return {"threads": threads[:limite], "meu_pk": str(cl.user_id)}


def cmd_thread(p):
    cl = cliente(p)
    quantos = max(1, min(int(p.get("quantos") or 40), 200))
    itens = []
    cursor = None
    t = None
    while len(itens) < quantos:
        params = {"visual_message_return_type": "unseen", "direction": "older", "limit": "20"}
        if cursor:
            params["cursor"] = cursor
        r = cl.private_request(f"direct_v2/threads/{p['thread_id']}/", params=params)
        t = r.get("thread") or {}
        itens.extend(t.get("items") or [])
        cursor = t.get("oldest_cursor")
        if not cursor or not t.get("has_older"):
            break
        time.sleep(1.5)
    t = dict(t or {})
    t["items"] = itens[:quantos]
    return {"thread": converter_thread(t, cl.user_id)}


def alvo(p):
    if p.get("thread_id"):
        return {"thread_ids": [int(p["thread_id"])]}
    return {"user_ids": [int(p["user_pk"])]}


def cmd_enviar_texto(p):
    cl = cliente(p)
    m = cl.direct_send(str(p["texto"]), **alvo(p))
    salvar_sessao(p["perfil"])
    return {"mid": str(m.id), "thread_id": str(m.thread_id) if m.thread_id else None}


def cmd_enviar_arquivo(p):
    cl = cliente(p)
    caminho = Path(p["caminho"])
    tipo = p.get("tipo")
    if tipo == "imagem":
        m = cl.direct_send_photo(caminho, **alvo(p))
    elif tipo == "video":
        m = cl.direct_send_video(caminho, **alvo(p))
    elif tipo == "audio":
        m = cl.direct_send_voice(caminho, **alvo(p))
    else:
        raise AssertionError("O Instagram só aceita foto, vídeo ou áudio no Direct")
    salvar_sessao(p["perfil"])
    return {"mid": str(m.id), "thread_id": str(m.thread_id) if m.thread_id else None}


def cmd_visto(p):
    cl = cliente(p)
    cl.direct_send_seen(int(p["thread_id"]))
    return {}


def cmd_aprovar(p):
    cl = cliente(p)
    cl.direct_pending_approve(int(p["thread_id"]))
    return {}


def cmd_ping(p):
    return {"versao": getattr(sys.modules.get("instagrapi"), "__version__", None), "perfis": list(clientes.keys())}


COMANDOS = {
    "entrar": cmd_entrar, "sair": cmd_sair, "inbox": cmd_inbox, "thread": cmd_thread,
    "enviar_texto": cmd_enviar_texto, "enviar_arquivo": cmd_enviar_arquivo, "visto": cmd_visto,
    "aprovar": cmd_aprovar, "ping": cmd_ping,
}


def main():
    responder({"evento": "pronto"})
    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            p = json.loads(linha)
        except Exception:
            continue
        pid = p.get("id")
        fn = COMANDOS.get(p.get("cmd"))
        if not fn:
            responder({"id": pid, "erro": f"Comando desconhecido: {p.get('cmd')}", "tipo": "dados"})
            continue
        try:
            r = fn(p) or {}
            r.update({"id": pid, "ok": True})
            responder(r)
        except Exception as e:
            tipo = tipo_do_erro(e)
            if tipo in ("login", "desafio", "suspensa"):
                clientes.pop(p.get("perfil"), None)
            msg = str(e) or type(e).__name__
            responder({"id": pid, "erro": msg[:400], "tipo": tipo, "classe": type(e).__name__,
                       "detalhe": traceback.format_exc(limit=3)[-600:] if tipo == "outro" else None})


if __name__ == "__main__":
    main()
