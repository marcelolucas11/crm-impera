// Lista rápida de reuniões (botão "Reuniões" do kanban), no jeito da agenda do Google/Meet:
// "Anteriores" em cima (a mais recente à mostra, "Mostrar mais" abre o resto) e "Programadas" por dia.
// Cada linha mostra o horário, o nome e o nicho do lead. Tocar abre a ficha por cima da lista (com a conversa do
// WhatsApp para mandar mensagem); fechar a ficha volta para a lista no mesmo lugar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, RefreshCw, Video, ChevronDown, ChevronUp, BellRing, UserRound } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { useFecharComVoltar } from '../../voltar.js';
import { useNotificacoesAparelho, ligarNotificacoes, ehIOS, instaladoComoApp } from '../../pwa.js';

const DIAS_ANTES = 30;
const ATUALIZAR_MS = 60000;

const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const chaveDia = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function rotuloDia(iso, t) {
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (n) => chaveDia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n));
  const data = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
  const maiuscula = data.charAt(0).toUpperCase() + data.slice(1);
  const k = chaveDia(d);
  if (k === dia(0)) return { destaque: t('kanban.reunioes.hoje'), data };
  if (k === dia(1)) return { destaque: t('kanban.reunioes.amanha'), data };
  if (k === dia(-1)) return { destaque: t('kanban.reunioes.ontem'), data };
  return { destaque: '', data: maiuscula };
}

// Agrupa por dia mantendo a ordem
function porDia(lista) {
  const grupos = [];
  for (const r of lista) {
    const k = chaveDia(new Date(r.inicio));
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === k) ultimo.itens.push(r);
    else grupos.push({ chave: k, inicio: r.inicio, itens: [r] });
  }
  return grupos;
}

function LinhaReuniao({ r, agora, onAbrir, t, empilhada = false }) {
  const ini = Date.parse(r.inicio);
  const fim = Date.parse(r.fim || '') || ini + 45 * 60000;
  const acontecendo = agora >= ini && agora < fim;
  const emBreve = !acontecendo && ini > agora && ini - agora <= 60 * 60000;
  const passada = fim <= agora;
  const podeAbrir = Boolean(r.lead_id);
  const abrir = () => podeAbrir && onAbrir(r.lead_id);
  return (
    <div className={`reuniao-item ${acontecendo ? 'agora' : ''} ${passada ? 'passada' : ''} ${empilhada ? 'empilhada' : ''} ${podeAbrir ? '' : 'sem-lead'}`}>
      <button type="button" className="reuniao-abrir" onClick={abrir} disabled={!podeAbrir}
        title={podeAbrir ? t('kanban.reunioes.abrirDica', { nome: r.nome || '' }) : t('kanban.reunioes.semLead')}>
        <span className="reuniao-linha1">
          {acontecendo && <span className="reuniao-selo-agora">{t('kanban.reunioes.agora')}</span>}
          {emBreve && <span className="reuniao-selo-breve">{t('kanban.reunioes.emMin', { min: Math.max(1, Math.round((ini - agora) / 60000)) })}</span>}
          <span className="reuniao-hora">{hora(r.inicio)}{r.fim ? ` – ${hora(r.fim)}` : ''}</span>
          {r.no_show && <span className="reuniao-selo-noshow">{t('kanban.reunioes.noShow')}</span>}
        </span>
        <span className="reuniao-nome">{r.nome || t('kanban.reunioes.semLead')}</span>
        <span className="reuniao-linha3">
          <span className={`reuniao-nicho ${r.nicho ? '' : 'vazio'}`}>{r.nicho || t('kanban.reunioes.semNicho')}</span>
          {r.etapa && <span className="reuniao-etapa" style={r.etapa_cor ? { '--cor-etapa': r.etapa_cor } : undefined}>{r.etapa}</span>}
          {r.responsavel && <span className="reuniao-resp"><UserRound size={11} /> {r.responsavel.split(' ')[0]}</span>}
        </span>
      </button>
      {r.link && !passada && (
        <a className="reuniao-participar" href={r.link} target="_blank" rel="noreferrer" title={t('kanban.reunioes.participarDica')}>
          <Video size={15} /> <span>{t('kanban.reunioes.participar')}</span>
        </a>
      )}
    </div>
  );
}

// Faixa que convida a ligar as notificações neste aparelho (só aparece se ainda estiverem desligadas)
function FaixaNotificacoes({ t }) {
  const [estado, conferir] = useNotificacoesAparelho();
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  if (estado !== 'desligado' && estado !== 'precisa-instalar') return null;
  const ios = ehIOS() && !instaladoComoApp();
  const ligar = async () => {
    setErro(''); setOcupado(true);
    try { await ligarNotificacoes(); } catch (e) { setErro(e.message); } finally { setOcupado(false); conferir(); }
  };
  return (
    <div className="reunioes-faixa-notif">
      <BellRing size={16} />
      <div className="reunioes-faixa-texto">
        <span>{estado === 'precisa-instalar' || ios ? t('kanban.reunioes.notifInstalar') : t('kanban.reunioes.notifAviso')}</span>
        {erro && <small className="alerta">{erro}</small>}
      </div>
      {estado === 'desligado' && (
        <button type="button" className="btn btn-pequeno btn-ouro" onClick={ligar} disabled={ocupado}>{t('kanban.reunioes.notifLigar')}</button>
      )}
    </div>
  );
}

export default function ListaReunioes({ onFechar, onAbrirLead, fichaAberta = false }) {
  const t = useT();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [maisAnteriores, setMaisAnteriores] = useState(false);
  const [agora, setAgora] = useState(Date.now());
  const corpo = useRef(null);

  useFecharComVoltar(true, onFechar);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const d = await api(`/reunioes?antes=${DIAS_ANTES}`);
      setDados(d.reunioes);
      setErro('');
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
      setAgora(Date.now());
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(() => { if (!document.hidden) carregar(); }, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [carregar]);

  // Esc fecha a lista (quando a ficha não está aberta por cima — aí o Esc fecha só a ficha)
  useEffect(() => {
    if (fichaAberta) return undefined;
    const esc = (e) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [fichaAberta, onFechar]);

  const { anteriores, programadas } = useMemo(() => {
    const lista = dados || [];
    const ant = [];
    const prog = [];
    for (const r of lista) {
      const fim = Date.parse(r.fim || '') || Date.parse(r.inicio) + 45 * 60000;
      (fim <= agora ? ant : prog).push(r);
    }
    return { anteriores: ant, programadas: prog };
  }, [dados, agora]);

  const anterioresVisiveis = maisAnteriores ? anteriores : anteriores.slice(-1);
  const gruposProgramadas = useMemo(() => porDia(programadas), [programadas]);
  const gruposAnteriores = useMemo(() => porDia(anterioresVisiveis), [anterioresVisiveis]);

  return (
    <div className="fundo-painel fundo-reunioes" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <aside className="painel reunioes-painel" role="dialog" aria-label={t('kanban.reunioes.titulo')}>
        <div className="painel-topo reunioes-topo">
          <h2><CalendarDays size={18} /> {t('kanban.reunioes.titulo')}</h2>
          <div className="reunioes-topo-acoes">
            <button type="button" className={`botao-icone-vidro ${carregando ? 'girando' : ''}`} onClick={carregar} title={t('kanban.reunioes.atualizar')} aria-label={t('kanban.reunioes.atualizar')}>
              <RefreshCw size={16} />
            </button>
            <button type="button" className="fechar" onClick={onFechar} aria-label={t('kanban.reunioes.fechar')}>×</button>
          </div>
        </div>

        <div className="reunioes-corpo" ref={corpo}>
          <FaixaNotificacoes t={t} />
          {erro && <div className="erro">{erro}</div>}
          {!dados && !erro && <p className="suave reunioes-vazio">{t('kanban.reunioes.carregando')}</p>}

          {dados && (
            <>
              <section className="reunioes-secao">
                <h3>{t('kanban.reunioes.anteriores')}</h3>
                {anteriores.length === 0 && <p className="suave reunioes-vazio">{t('kanban.reunioes.semAnteriores', { dias: DIAS_ANTES })}</p>}
                {gruposAnteriores.map((g) => {
                  const dia = rotuloDia(g.inicio, t);
                  return (
                    <div key={g.chave} className="reunioes-dia">
                      {maisAnteriores && <div className="reunioes-dia-rotulo"><b>{dia.destaque}</b>{dia.destaque ? ' · ' : ''}{dia.data}</div>}
                      {g.itens.map((r) => (
                        <LinhaReuniao key={r.uri} r={r} agora={agora} onAbrir={onAbrirLead} t={t}
                          empilhada={!maisAnteriores && anteriores.length > 1} />
                      ))}
                    </div>
                  );
                })}
                {anteriores.length > 1 && (
                  <button type="button" className="reunioes-mais" onClick={() => setMaisAnteriores(!maisAnteriores)}>
                    {maisAnteriores ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    {maisAnteriores ? t('kanban.reunioes.mostrarMenos') : `${t('kanban.reunioes.mostrarMais')} (${anteriores.length - 1})`}
                  </button>
                )}
              </section>

              <section className="reunioes-secao">
                <h3>{t('kanban.reunioes.programadas')}</h3>
                {programadas.length === 0 && <p className="suave reunioes-vazio">{t('kanban.reunioes.semProgramadas')}</p>}
                {gruposProgramadas.map((g) => {
                  const dia = rotuloDia(g.inicio, t);
                  return (
                    <div key={g.chave} className="reunioes-dia">
                      <div className="reunioes-dia-rotulo"><b>{dia.destaque}</b>{dia.destaque ? ' · ' : ''}{dia.data}</div>
                      {g.itens.map((r) => <LinhaReuniao key={r.uri} r={r} agora={agora} onAbrir={onAbrirLead} t={t} />)}
                    </div>
                  );
                })}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
