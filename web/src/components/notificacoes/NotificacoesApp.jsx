// Equipe e integrações → Notificações do app.
// Instalar o CRM como app, ligar as notificações neste aparelho, ver os aparelhos que recebem e disparar um teste
// com um lead que já agendou (mesmo aviso que o CRM manda de verdade, com "Teste" no título).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, BellOff, Smartphone, Download, Send, RefreshCw, CircleCheck, CircleX, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { tempoDesde, dataHora } from '../../utils.js';
import { useInstalacao, useNotificacoesAparelho, ligarNotificacoes, desligarNotificacoes } from '../../pwa.js';

// Mesmo texto que o app monta no aparelho ao receber (ver public/sw.js)
const dd = (n) => String(n).padStart(2, '0');
function quandoReuniao(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoje = new Date();
  const amanha = new Date(hoje.getTime() + 86400000);
  const igual = (a, b) => a.toDateString() === b.toDateString();
  const data = `${dd(d.getDate())}/${dd(d.getMonth() + 1)}`;
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = igual(d, hoje) ? `hoje, ${data}` : igual(d, amanha) ? `amanhã, ${data}` : `${d.toLocaleDateString('pt-BR', { weekday: 'short' })} ${data}`;
  return `${dia} às ${hora}`;
}
export function textoDoAviso({ nome, inicio, nicho }) {
  return [`${nome || 'Lead'} — ${quandoReuniao(inicio)}`, nicho ? `Nicho: ${nicho}` : null].filter(Boolean).join('\n');
}

function PreviaNotificacao({ titulo, corpo }) {
  return (
    <div className="previa-notif" aria-label="Prévia da notificação">
      <img src="icones/icone-96.png" alt="" className="previa-notif-icone" />
      <div className="previa-notif-textos">
        <div className="previa-notif-app"><span>CRM-IMPERA</span><small>agora</small></div>
        <b>{titulo}</b>
        <span className="previa-notif-corpo">{corpo}</span>
      </div>
    </div>
  );
}

function SecaoInstalar({ t }) {
  const inst = useInstalacao();
  return (
    <section className="cartao-secao">
      <h2><Download size={17} /> {t('notif.instalar.titulo')}</h2>
      {inst.instalado ? <p className="sucesso">{t('notif.instalar.jaInstalado')}</p> : (
        <>
          {inst.podeInstalar && (
            <button type="button" className="btn btn-ouro" onClick={() => inst.instalar()}><Download size={15} /> {t('notif.instalar.botao')}</button>
          )}
          <ul className="notif-passos">
            <li className={inst.ios ? 'destaque' : ''}>{t('notif.instalar.ios')}</li>
            <li className={inst.android ? 'destaque' : ''}>{t('notif.instalar.android')}</li>
            <li className={!inst.ios && !inst.android ? 'destaque' : ''}>{t('notif.instalar.computador')}</li>
          </ul>
        </>
      )}
    </section>
  );
}

function SecaoEsteAparelho({ t, aoMudar }) {
  const [estado, conferir] = useNotificacoesAparelho();
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');
  const executar = async (fn, sucesso) => {
    setOcupado(true); setErro(''); setMsg('');
    try { await fn(); setMsg(sucesso); aoMudar?.(); } catch (e) { setErro(e.message); } finally { setOcupado(false); conferir(); }
  };
  const textoEstado = {
    carregando: t('notif.estado.carregando'),
    ligado: t('notif.estado.ligado'),
    desligado: t('notif.estado.desligado'),
    bloqueado: t('notif.estado.bloqueado'),
    'precisa-instalar': t('notif.estado.precisaInstalar'),
    'sem-suporte': t('notif.estado.semSuporte'),
  }[estado];
  return (
    <section className="cartao-secao">
      <h2><Smartphone size={17} /> {t('notif.esteAparelho')}</h2>
      <p className={`notif-estado notif-estado-${estado}`}>
        {estado === 'ligado' ? <BellRing size={16} /> : <BellOff size={16} />} {textoEstado}
      </p>
      <div className="acoes-linha">
        {(estado === 'desligado' || estado === 'bloqueado') && (
          <button type="button" className="btn btn-ouro" disabled={ocupado} onClick={() => executar(ligarNotificacoes, t('notif.ligadoOk'))}>
            <BellRing size={15} /> {t('notif.ligar')}
          </button>
        )}
        {estado === 'ligado' && (
          <button type="button" className="btn" disabled={ocupado} onClick={() => executar(desligarNotificacoes, t('notif.desligadoOk'))}>
            <BellOff size={15} /> {t('notif.desligar')}
          </button>
        )}
        <button type="button" className="btn" onClick={conferir}><RefreshCw size={14} /> {t('notif.conferir')}</button>
      </div>
      {msg && <div className="sucesso">{msg}</div>}
      {erro && <div className="erro">{erro}</div>}
    </section>
  );
}

export default function NotificacoesApp({ user }) {
  const t = useT();
  const admin = user?.role === 'admin';
  const [cfg, setCfg] = useState(null);
  const [aparelhos, setAparelhos] = useState([]);
  const [leads, setLeads] = useState(null);
  const [leadId, setLeadId] = useState('');
  const [destino, setDestino] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');

  const carregarAparelhos = useCallback(() => api('/notificacoes/aparelhos').then((d) => setAparelhos(d.aparelhos)).catch((e) => setErro(e.message)), []);
  const carregarCfg = useCallback(() => (admin ? api('/notificacoes/config').then(setCfg).catch((e) => setErro(e.message)) : Promise.resolve()), [admin]);
  useEffect(() => {
    carregarAparelhos();
    carregarCfg();
    api('/notificacoes/leads-agendados').then((d) => setLeads(d.leads)).catch((e) => setErro(e.message));
  }, [carregarAparelhos, carregarCfg]);

  const salvarCfg = async (dados) => {
    setErro(''); setMsg('');
    try { setCfg(await api('/notificacoes/config', { method: 'PUT', body: dados })); setMsg(t('notif.salvo')); } catch (e) { setErro(e.message); }
  };

  const remover = async (a) => {
    setErro(''); setMsg('');
    try { await api(`/notificacoes/aparelhos/${a.id}`, { method: 'DELETE' }); setMsg(t('notif.aparelhos.removido')); carregarAparelhos(); } catch (e) { setErro(e.message); }
  };

  const leadEscolhido = useMemo(() => leads?.find((l) => String(l.lead_id) === String(leadId)) || null, [leads, leadId]);

  const disparar = async () => {
    if (!leadEscolhido) return;
    setEnviando(true); setErro(''); setMsg(''); setResultado(null);
    try {
      const r = await api('/notificacoes/teste', { method: 'POST', body: { lead_id: leadEscolhido.lead_id, uri: leadEscolhido.uri, aparelho_id: destino ? Number(destino) : undefined } });
      setResultado(r);
      carregarAparelhos();
      carregarCfg();
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  };

  const okTeste = resultado?.resultados?.filter((r) => r.ok).length || 0;

  return (
    <div className="notif-pagina">
      {erro && <div className="erro">{erro}</div>}
      {msg && <div className="sucesso">{msg}</div>}

      <section className="cartao-secao notif-intro">
        <h2><BellRing size={18} /> {t('notif.titulo')}</h2>
        <p className="suave">{t('notif.explica')}</p>
        <PreviaNotificacao titulo="Nova reunião agendada"
          corpo={textoDoAviso({ nome: leads?.[0]?.nome || 'Karoline', inicio: leads?.[0]?.inicio || new Date(Date.now() + 86400000).toISOString(), nicho: leads?.[0]?.nicho || 'Rifas' })} />
      </section>

      <div className="notif-grade">
        <SecaoEsteAparelho t={t} aoMudar={carregarAparelhos} />
        <SecaoInstalar t={t} />
      </div>

      {admin && cfg && (
        <section className="cartao-secao">
          <label className="notif-interruptor">
            <input type="checkbox" checked={cfg.ligado} onChange={(e) => salvarCfg({ ligado: e.target.checked })} />
            <span><b>{t('notif.ligadoGeral')}</b><small className="suave">{t('notif.ligadoGeralDica')}</small></span>
          </label>
          <h3>{t('notif.nicho.titulo')}</h3>
          <p className="suave pequeno">{t('notif.nicho.explica')}</p>
          <select value={cfg.pergunta_nicho} onChange={(e) => salvarCfg({ pergunta_nicho: e.target.value })}>
            <option value="">{t('notif.nicho.automatico')}</option>
            {cfg.perguntas.map((p) => (
              <option key={p.pergunta} value={p.pergunta}>
                {p.pergunta} — {t('notif.nicho.leads', { n: p.leads })}{p.exemplo ? ` · ${t('notif.nicho.exemplo', { exemplo: p.exemplo })}` : ''}
              </option>
            ))}
            {cfg.pergunta_nicho && !cfg.perguntas.some((p) => p.pergunta === cfg.pergunta_nicho) && <option value={cfg.pergunta_nicho}>{cfg.pergunta_nicho}</option>}
          </select>
        </section>
      )}

      <section className="cartao-secao">
        <h2><Send size={17} /> {t('notif.teste.titulo')}</h2>
        <p className="suave pequeno">{t('notif.teste.explica')}</p>
        {leads && leads.length === 0 ? <p className="suave">{t('notif.teste.semLeads')}</p> : (
          <div className="notif-teste-form">
            <label>
              {t('notif.teste.lead')}
              <select value={leadId} onChange={(e) => { setLeadId(e.target.value); setResultado(null); }}>
                <option value="">{t('notif.teste.escolha')}</option>
                {(leads || []).map((l) => (
                  <option key={l.lead_id} value={l.lead_id}>
                    {l.nome} — {dataHora(l.inicio)}{l.nicho ? ` · ${l.nicho}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('notif.teste.destino')}
              <select value={destino} onChange={(e) => setDestino(e.target.value)}>
                <option value="">{admin ? t('notif.teste.todos') : t('notif.teste.meus')}</option>
                {aparelhos.map((a) => <option key={a.id} value={a.id}>{a.aparelho}{a.usuario ? ` — ${a.usuario}` : ''}</option>)}
              </select>
            </label>
            {leadEscolhido && (
              <div className="notif-teste-previa">
                <small className="suave">{t('notif.teste.previa')}</small>
                <PreviaNotificacao titulo="Teste · Nova reunião agendada" corpo={textoDoAviso(leadEscolhido)} />
              </div>
            )}
            <button type="button" className="btn btn-ouro" disabled={!leadEscolhido || enviando} onClick={disparar}>
              <Send size={15} /> {enviando ? t('notif.teste.enviando') : t('notif.teste.disparar')}
            </button>
          </div>
        )}
        {resultado && (
          <div className="notif-resultado">
            <p className={okTeste === resultado.resultados.length ? 'sucesso' : 'erro'}>
              {t('notif.teste.resultado', { ok: okTeste, total: resultado.resultados.length })}
            </p>
            <ul>
              {resultado.resultados.map((r) => (
                <li key={r.id} className={r.ok ? 'ok' : 'falhou'}>
                  {r.ok ? <CircleCheck size={15} /> : <CircleX size={15} />}
                  <span><b>{r.aparelho}</b>{r.usuario ? ` — ${r.usuario}` : ''}: {r.ok ? t('notif.teste.entregue') : `${r.status ? `${r.status} · ` : ''}${r.erro}`}</span>
                </li>
              ))}
            </ul>
            {okTeste > 0 && <p className="suave pequeno">{t('notif.teste.dicaNaoChegou')}</p>}
          </div>
        )}
      </section>

      <section className="cartao-secao">
        <h2><Smartphone size={17} /> {admin ? t('notif.aparelhos.titulo') : t('notif.aparelhos.meus')}</h2>
        {aparelhos.length === 0 ? <p className="suave">{t('notif.aparelhos.vazio')}</p> : (
          <div className="notif-aparelhos">
            {aparelhos.map((a) => (
              <div key={a.id} className="notif-aparelho">
                <Smartphone size={18} className="notif-aparelho-icone" />
                <div className="notif-aparelho-textos">
                  <b>{a.aparelho}</b>
                  <small className="suave">
                    {a.usuario ? `${a.usuario} · ` : ''}{t('notif.aparelhos.desde')} {tempoDesde(a.criado_em)} · {a.servico}
                  </small>
                  <small className={a.ultimo_erro ? 'alerta' : 'suave'}>
                    {t('notif.aparelhos.ultimo')}: {a.ultimo_erro ? t('notif.aparelhos.erro', { erro: a.ultimo_erro }) : a.ultimo_ok_em ? t('notif.aparelhos.ok', { quando: tempoDesde(a.ultimo_ok_em) }) : t('notif.aparelhos.nunca')}
                  </small>
                  {!a.recebe && <small className="suave">{t('notif.aparelhos.semKanban')}</small>}
                </div>
                <button type="button" className="btn btn-pequeno" onClick={() => remover(a)} title={t('notif.aparelhos.remover')}>
                  <Trash2 size={13} /> {t('notif.aparelhos.remover')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {admin && cfg && (
        <section className="cartao-secao">
          <h2>{t('notif.historico.titulo')}</h2>
          {cfg.historico.length === 0 ? <p className="suave">{t('notif.historico.vazio')}</p> : (
            <ul className="notif-historico">
              {cfg.historico.map((h, i) => (
                <li key={`${h.em}-${i}`}>
                  <span className="suave">{dataHora(h.em)}</span>
                  <span className={`tag ${h.teste ? '' : 'tag-variavel'}`}>{h.teste ? t('notif.historico.teste') : t('notif.historico.auto')}</span>
                  <b>{h.nome}</b>
                  <span className={h.ok === h.aparelhos ? 'suave' : 'alerta'}>{t('notif.historico.resumo', { ok: h.ok, total: h.aparelhos })}</span>
                  {h.erros?.length > 0 && <small className="alerta notif-historico-erros">{h.erros.join(' · ')}</small>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
