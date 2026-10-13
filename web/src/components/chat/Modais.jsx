// Janelas da tela de WhatsApp: encaminhar, informações da mensagem, enquete, contato, localização,
// chamadas e atalhos de teclado.
import { useEffect, useMemo, useState } from 'react';
import { Check, Phone, Video, ExternalLink, Smartphone, Copy } from 'lucide-react';
import Modal from '../Modal.jsx';
import Avatar from '../Avatar.jsx';
import { api } from '../../api.js';
import { formatarTelefone, dataHora } from '../../utils.js';

export function Encaminhar({ mensagens, numeros, numeroPadrao, onFechar, onFeito }) {
  const [conversas, setConversas] = useState([]);
  const [busca, setBusca] = useState('');
  const [escolhidas, setEscolhidas] = useState([]);
  const [numeroId, setNumeroId] = useState(numeroPadrao || numeros[0]?.id || '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ filtro: 'todas' });
      if (busca.trim()) p.set('q', busca.trim());
      api(`/whatsapp/conversas?${p}`).then((d) => setConversas(d.conversas.slice(0, 80))).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [busca]);

  const alternar = (c) => setEscolhidas((l) => (l.some((x) => x.chave === c.chave) ? l.filter((x) => x.chave !== c.chave) : l.length >= 5 ? l : [...l, c]));

  const enviar = async () => {
    setEnviando(true);
    setErro('');
    try {
      const falhas = [];
      for (const m of mensagens) {
        const d = await api(`/whatsapp/mensagens/${m.id}/encaminhar`, { method: 'POST', body: { chaves: escolhidas.map((c) => c.chave), numero_id: Number(numeroId) } });
        falhas.push(...d.resultados.filter((r) => !r.ok).map((r) => r.erro));
      }
      if (falhas.length) setErro(`Algumas não foram: ${[...new Set(falhas)].join('; ')}`);
      else onFeito?.();
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal titulo={`Encaminhar ${mensagens.length > 1 ? `${mensagens.length} mensagens` : 'mensagem'}`} onFechar={onFechar}>
      <div className="modal-wa">
        <input type="search" autoFocus placeholder="Buscar conversa…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="lista-escolha">
          {conversas.map((c) => {
            const marcada = escolhidas.some((x) => x.chave === c.chave);
            return (
              <button key={c.chave} type="button" className={`item-escolha ${marcada ? 'marcado' : ''}`} onClick={() => alternar(c)}>
                <span className="caixa">{marcada && <Check size={14} />}</span>
                <Avatar chave={c.chave} nome={c.nome} tamanho={36} lead={Boolean(c.lead_id)} />
                <span className="item-escolha-nome">
                  <b>{c.nome || formatarTelefone(c.telefone) || 'Contato'}</b>
                  <small className="suave">{c.grupo ? 'Grupo' : formatarTelefone(c.telefone)}</small>
                </span>
              </button>
            );
          })}
        </div>
        <p className="suave pequeno">Até 5 conversas de cada vez (regra do WhatsApp). {escolhidas.length ? `Escolhidas: ${escolhidas.map((c) => c.nome || formatarTelefone(c.telefone)).join(', ')}` : ''}</p>
        {erro && <div className="erro pequeno">{erro}</div>}
        <div className="acoes-linha">
          {numeros.length > 1 && (
            <select value={numeroId} onChange={(e) => setNumeroId(e.target.value)} title="Número que vai enviar">
              {numeros.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          )}
          <span className="espaco" />
          <button className="btn" type="button" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-ouro" type="button" disabled={!escolhidas.length || enviando || !numeroId} onClick={enviar}>{enviando ? 'Encaminhando…' : 'Encaminhar'}</button>
        </div>
      </div>
    </Modal>
  );
}

export function InfoMensagem({ id, onFechar }) {
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => { api(`/whatsapp/mensagens/${id}/info`).then(setInfo).catch((e) => setErro(e.message)); }, [id]);
  const linha = (rotulo, valor, icone) => (
    <div className="info-linha"><span>{icone} {rotulo}</span><b>{valor ? dataHora(valor) : '—'}</b></div>
  );
  return (
    <Modal titulo="Informações da mensagem" onFechar={onFechar}>
      <div className="modal-wa">
        {erro && <div className="erro">{erro}</div>}
        {!info && !erro && <span className="girando" />}
        {info && (
          <>
            {linha('Enviada', info.enviada_em, '✓')}
            {linha('Entregue', info.entregue_em || (info.status >= 3 ? null : null), '✓✓')}
            {linha('Lida', info.lida_em, <span className="azul">✓✓</span>)}
            {info.ouvida_em && linha('Ouvida', info.ouvida_em, '🎧')}
            <p className="suave pequeno">
              {info.enviada_por ? `Enviada por ${info.enviada_por}` : 'Enviada pelo celular'}{info.numero ? ` · número ${info.numero}` : ''}.
              {!info.entregue_em && info.status >= 3 ? ' Entregue (o WhatsApp não informou o horário).' : ''}
              {!info.lida_em && info.status >= 4 ? ' Lida (o WhatsApp não informou o horário).' : ''}
              {info.status >= 3 && !info.lida_em && info.status < 4 ? ' Se o contato desligou a confirmação de leitura, o ✓✓ azul não aparece.' : ''}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

export function NovaEnquete({ onEnviar, onFechar }) {
  const [pergunta, setPergunta] = useState('');
  const [opcoes, setOpcoes] = useState(['', '']);
  const [multipla, setMultipla] = useState(true);
  const validas = opcoes.map((o) => o.trim()).filter(Boolean);
  const mudar = (i, v) => setOpcoes((l) => {
    const novo = l.map((o, j) => (j === i ? v : o));
    if (novo.at(-1).trim() && novo.length < 12) novo.push('');
    return novo;
  });
  return (
    <Modal titulo="Criar enquete" onFechar={onFechar}>
      <form className="modal-wa" onSubmit={(e) => { e.preventDefault(); onEnviar({ pergunta: pergunta.trim(), opcoes: validas, multipla }); }}>
        <label>Pergunta<input autoFocus value={pergunta} onChange={(e) => setPergunta(e.target.value)} maxLength={255} placeholder="Faça uma pergunta" /></label>
        <span className="pequeno suave">Opções</span>
        {opcoes.map((o, i) => (
          <input key={i} value={o} onChange={(e) => mudar(i, e.target.value)} maxLength={100} placeholder={i < 2 ? `Opção ${i + 1}` : '+ Adicionar opção'} />
        ))}
        <label className="linha-check"><input type="checkbox" checked={multipla} onChange={(e) => setMultipla(e.target.checked)} /> Permitir várias respostas</label>
        <div className="acoes-linha">
          <span className="espaco" />
          <button className="btn" type="button" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-ouro" disabled={!pergunta.trim() || validas.length < 2}>Enviar enquete</button>
        </div>
      </form>
    </Modal>
  );
}

export function EnviarContato({ onEnviar, onFechar }) {
  const [busca, setBusca] = useState('');
  const [leads, setLeads] = useState([]);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      if (busca.trim().length < 2) { setLeads([]); return; }
      api(`/leads?q=${encodeURIComponent(busca.trim())}`).then((d) => setLeads((d.leads || []).filter((l) => l.phone).slice(0, 20))).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [busca]);
  return (
    <Modal titulo="Enviar contato" onFechar={onFechar}>
      <div className="modal-wa">
        <input type="search" autoFocus placeholder="Buscar lead por nome ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="lista-escolha">
          {leads.map((l) => (
            <button key={l.id} type="button" className="item-escolha" onClick={() => onEnviar([{ nome: l.name || formatarTelefone(l.phone), telefone: l.phone }])}>
              <Avatar chave={`l:${l.id}`} nome={l.name} tamanho={34} lead />
              <span className="item-escolha-nome"><b>{l.name || 'Sem nome'}</b><small className="suave">{formatarTelefone(l.phone)}</small></span>
            </button>
          ))}
        </div>
        <span className="pequeno suave">Ou digite os dados:</span>
        <form className="form-linha form-linha-2" onSubmit={(e) => { e.preventDefault(); onEnviar([{ nome: nome.trim() || 'Contato', telefone }]); }}>
          <input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input placeholder="Telefone com DDD" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          <button className="btn btn-ouro" disabled={telefone.replace(/\D/g, '').length < 10}>Enviar</button>
        </form>
      </div>
    </Modal>
  );
}

// Aceita "-23.55, -46.63" ou um link do Google Maps
function lerCoordenadas(texto) {
  const t = String(texto || '');
  const m = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

export function EnviarLocalizacao({ onEnviar, onFechar }) {
  const [texto, setTexto] = useState('');
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const coords = lerCoordenadas(texto);
  const usarMinha = () => {
    setErro('');
    if (!navigator.geolocation) { setErro('O navegador não permite pegar a localização.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setTexto(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`),
      () => setErro('Localização negada (só funciona em http://localhost ou https). Cole as coordenadas ou um link do Google Maps.'),
      { timeout: 10000 }
    );
  };
  return (
    <Modal titulo="Enviar localização" onFechar={onFechar}>
      <form className="modal-wa" onSubmit={(e) => { e.preventDefault(); if (coords) onEnviar({ ...coords, nome: nome.trim() || null }); }}>
        <label>Coordenadas ou link do Google Maps<input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="-23.5505, -46.6333" /></label>
        <label>Nome do lugar (opcional)<input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} /></label>
        {coords && <a className="pequeno" href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">Conferir no mapa ↗</a>}
        {erro && <div className="erro pequeno">{erro}</div>}
        <div className="acoes-linha">
          <button className="btn" type="button" onClick={usarMinha}>📍 Usar minha localização</button>
          <span className="espaco" />
          <button className="btn btn-ouro" disabled={!coords}>Enviar</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Chamada de voz/vídeo. O CRM não transmite áudio/vídeo (a biblioteca do WhatsApp não faz chamadas):
 * gera um link de chamada do WhatsApp para enviar ao contato (com confirmação), ou abre no celular / WhatsApp Web.
 */
export function Ligar({ video, chave, telefone, numeros, numeroPadrao, onFechar, onEnviado }) {
  const [numeroId, setNumeroId] = useState(numeroPadrao || numeros[0]?.id || '');
  const [link, setLink] = useState(null);
  const [qr, setQr] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const waMe = telefone ? `https://wa.me/${telefone}` : null;
  const web = telefone ? `https://web.whatsapp.com/send?phone=${telefone}` : null;

  useEffect(() => {
    if (!waMe) return;
    api(`/whatsapp/qr?texto=${encodeURIComponent(waMe)}`).then((d) => setQr(d.qr)).catch(() => {});
  }, [waMe]);

  const gerar = async (enviar) => {
    setOcupado(true);
    setErro('');
    try {
      const d = await api(`/whatsapp/conversas/${encodeURIComponent(chave)}/link-chamada`, { method: 'POST', body: { numero_id: Number(numeroId), video, enviar } });
      setLink(d.link);
      if (enviar) { onEnviado?.(); onFechar(); }
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal titulo={video ? 'Chamada de vídeo' : 'Chamada de voz'} onFechar={onFechar}>
      <div className="modal-wa">
        <p className="suave pequeno">
          O CRM não faz a chamada em si (a conexão por QR code não transmite áudio nem vídeo). Escolha uma das opções:
        </p>
        <div className="opcao-chamada">
          <b>{video ? <Video size={16} /> : <Phone size={16} />} Link de chamada do WhatsApp</b>
          <span className="suave pequeno">O CRM cria um link de chamada; ao tocar nele, o contato entra na chamada. Você entra pelo mesmo link no celular ou no computador.</span>
          {numeros.length > 1 && (
            <select value={numeroId} onChange={(e) => setNumeroId(e.target.value)}>
              {numeros.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          )}
          {link ? (
            <div className="link-chamada">
              <a href={link} target="_blank" rel="noreferrer">{link}</a>
              <button type="button" className="btn btn-pequeno" onClick={() => navigator.clipboard?.writeText(link)}><Copy size={14} /> Copiar</button>
              <button type="button" className="btn btn-pequeno btn-ouro" disabled={ocupado}
                onClick={() => confirm('Enviar o link da chamada para o contato agora?') && gerar(true)}>Enviar ao contato</button>
            </div>
          ) : (
            <div className="acoes-linha">
              <button type="button" className="btn btn-pequeno" disabled={ocupado || !numeroId} onClick={() => gerar(false)}>{ocupado ? 'Gerando…' : 'Gerar link'}</button>
              <button type="button" className="btn btn-pequeno btn-ouro" disabled={ocupado || !numeroId}
                onClick={() => confirm('Gerar um link de chamada e enviar ao contato nesta conversa?') && gerar(true)}>Gerar e enviar ao contato</button>
            </div>
          )}
        </div>
        {telefone && (
          <div className="opcao-chamada">
            <b><Smartphone size={16} /> Ligar pelo celular</b>
            <span className="suave pequeno">Aponte a câmera do celular para o código (ou abra o link no celular) e toque em ligar no WhatsApp.</span>
            <div className="qr-ligar">
              {qr && <img src={qr} alt="QR code para abrir a conversa no celular" width="140" height="140" />}
              <div className="acoes-coluna">
                <a className="btn btn-pequeno" href={waMe} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir no celular (wa.me)</a>
                <a className="btn btn-pequeno" href={web} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir no WhatsApp Web</a>
              </div>
            </div>
          </div>
        )}
        {erro && <div className="erro pequeno">{erro}</div>}
      </div>
    </Modal>
  );
}

export const ATALHOS = [
  ['Ctrl + Alt + /', 'Buscar conversas'],
  ['Ctrl + Alt + Shift + F', 'Buscar na conversa'],
  ['Ctrl + Alt + Tab', 'Próxima conversa'],
  ['Ctrl + Alt + Shift + Tab', 'Conversa anterior'],
  ['Ctrl + Alt + Shift + U', 'Marcar como não lida / lida'],
  ['Ctrl + Alt + Shift + E', 'Arquivar / desarquivar'],
  ['Ctrl + Alt + Shift + P', 'Fixar / desafixar'],
  ['Ctrl + Alt + Shift + M', 'Silenciar / reativar som'],
  ['Ctrl + Alt + E', 'Painel de emojis'],
  ['Ctrl + Alt + S', 'Painel de figurinhas'],
  ['Ctrl + Alt + P', 'Dados do contato / ficha do lead'],
  ['↑ (campo vazio)', 'Editar a última mensagem enviada'],
  ['Esc', 'Fechar conversa, painel ou menu'],
  ['Ctrl + Alt + K', 'Mostrar estes atalhos'],
];

export function Atalhos({ onFechar }) {
  const lista = useMemo(() => ATALHOS, []);
  return (
    <Modal titulo="Atalhos do teclado" onFechar={onFechar}>
      <div className="modal-wa atalhos">
        {lista.map(([tecla, acao]) => (
          <div key={tecla} className="info-linha"><span>{acao}</span><kbd>{tecla}</kbd></div>
        ))}
        <p className="suave pequeno">No Mac, use Cmd no lugar de Ctrl e Option no lugar de Alt.</p>
      </div>
    </Modal>
  );
}
