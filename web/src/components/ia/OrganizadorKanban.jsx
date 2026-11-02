// Organizador do kanban por IA: lê as conversas dos leads e avança cada um pelas etapas sozinho.
// Varredura a cada X minutos (só conversas novas, com limite de gasto por dia), critérios editáveis com a etapa de destino,
// "Organizar tudo" com prévia antes de aplicar e o registro das movimentações com botão de desfazer.
import { useCallback, useEffect, useState } from 'react';
import { Columns3, Save, Plus, Trash2, Play, Undo2, Sparkles, Thermometer, ArrowRight, AlertTriangle, X, Wand2 } from 'lucide-react';
import Modal from '../Modal.jsx';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde } from '../../utils.js';
import { useAviso, Interruptor } from '../disparos/comum.jsx';

const usd = (v) => `US$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 0.1 && v > 0 ? 4 : 2 })}`;
const ROTULO_PAPEL = {
  contato: 'Lead contactado', qualificado: 'Lead qualificado', reuniao: 'Reunião agendada',
  aguardando_proposta: 'Aguardando proposta (reunião feita)', proposta: 'Proposta enviada',
};
const rotuloModelo = (m) => `${m.nome} — ${m.nivel}${m.preco ? ` (${m.preco})` : ''}`;

export default function OrganizadorKanban({ admin }) {
  const aviso = useAviso();
  const [dados, setDados] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [alterado, setAlterado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [varrendo, setVarrendo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const d = await api('/organizador');
      setDados(d);
      setCfg((atual) => (atual && alterado ? atual : d.config));
    } catch (e) { aviso(e.message, 'erro'); }
  }, [aviso, alterado]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('organizador', () => carregar());

  // Enquanto a análise do "Organizar tudo" roda, atualiza o progresso
  const analisando = dados?.tarefa?.estado === 'analisando';
  useEffect(() => {
    if (!analisando) return undefined;
    const id = setInterval(carregar, 2000);
    return () => clearInterval(id);
  }, [analisando, carregar]);

  if (!dados || !cfg) return <section className="cartao-secao"><div className="carregando" /></section>;

  const mudar = (campos) => { setCfg({ ...cfg, ...campos }); setAlterado(true); };
  const salvar = async (extra = {}) => {
    setSalvando(true);
    try {
      const d = await api('/organizador/config', { method: 'PUT', body: { ...cfg, ...extra } });
      setDados(d);
      setCfg(d.config);
      setAlterado(false);
      aviso(extra.ativo === true ? 'Organizador ligado: a partir de agora ele acompanha as conversas novas' : extra.ativo === false ? 'Organizador desligado' : 'Organizador salvo');
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };
  const varrerAgora = async () => {
    setVarrendo(true);
    try {
      const d = await api('/organizador/varrer', { method: 'POST' });
      setDados(d);
      const r = d.resultado;
      if (r?.pulou) aviso(r.pulou === 'organizando' ? 'Espere o "Organizar tudo" terminar' : 'Uma varredura já está rodando');
      else aviso(r?.erro ? `Erro na varredura: ${r.erro}` : `Varredura feita: ${r.avaliados} lida(s) pela IA, ${r.movidos} lead(s) movido(s)`, r?.erro ? 'erro' : undefined);
    } catch (e) { aviso(e.message, 'erro'); } finally { setVarrendo(false); }
  };

  const st = dados.status;
  const faltando = dados.papeis.filter((p) => !p.etapa);
  const uv = st.ultima_varredura;

  return (
    <div className="org">
      <section className={`dp-mestre ${cfg.ativo ? 'ligada' : ''}`}>
        <div className="dp-mestre-icone"><Columns3 size={22} /></div>
        <div className="dp-mestre-texto">
          <h2>Organizador do kanban</h2>
          <p className="suave">
            A cada {cfg.intervalo_min} min a IA lê só as conversas novas dos leads do kanban e avança cada um para a etapa certa.
            Nunca volta etapa, nunca mexe em Fechado/Perdido e continua de onde você parou.
          </p>
          <p className="dp-mestre-status">
            Hoje: {usd(st.gasto_hoje)} de {usd(cfg.limite_diario_usd)} · {st.movidos_hoje} lead(s) movido(s)
            {st.pendentes ? ` · ${st.pendentes} esperando leitura` : ''}
            {uv ? ` · última varredura ${tempoDesde(uv.em)}${uv.erro ? ' (com erro)' : ''}` : ''}
          </p>
          {st.limite_atingido && (
            <p className="org-alerta"><AlertTriangle size={14} /> Limite do dia atingido: a leitura pela IA volta {st.volta_em ? `às ${new Date(st.volta_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'amanhã'}. As regras sem IA (mensagem enviada, PDF, Calendly) continuam valendo.</p>
          )}
          {uv?.erro && <p className="org-alerta"><AlertTriangle size={14} /> {uv.erro}</p>}
        </div>
        <div className="org-mestre-acoes">
          <Interruptor grande ligado={cfg.ativo} disabled={!admin || salvando} aoMudar={(ativo) => salvar({ ativo })} rotulo={cfg.ativo ? 'Ligado' : 'Desligado'} />
          {admin && cfg.ativo && <button type="button" className="btn btn-pequeno" disabled={varrendo || analisando} onClick={varrerAgora}><Play size={13} /> {varrendo ? 'Varrendo…' : 'Varrer agora'}</button>}
        </div>
      </section>

      {faltando.length > 0 && (
        <div className="dp-dica-admin">
          Sem etapa para: <b>{faltando.map((p) => ROTULO_PAPEL[p.papel]).join(', ')}</b>. O organizador não leva leads para esses pontos até você escolher a etapa em
          {' '}<b>Kanban → Editar etapas</b> (coluna de automação).
        </div>
      )}

      <div className="org-grade">
        <div className="dp-coluna-principal">
          <section className="cartao-secao">
            <h2>Como ele trabalha</h2>
            <div className="org-campos">
              <label>Modelo que lê as conversas
                <select value={cfg.modelo} disabled={!admin} onChange={(e) => mudar({ modelo: e.target.value })}>
                  {dados.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
                </select>
                <span className="suave pequeno">Usa a mesma chave da API da IA de primeiro contato. O Haiku resolve a maioria das conversas pelo menor custo.</span>
              </label>
              <label>Varrer a cada (minutos)
                <input type="number" min="1" max="120" value={cfg.intervalo_min} disabled={!admin} onChange={(e) => mudar({ intervalo_min: e.target.value })} />
                <span className="suave pequeno">Só chama a IA se algum lead do kanban teve mensagem nova desde a última varredura.</span>
              </label>
              <label>Limite de gasto por dia (US$)
                <input type="number" min="0.05" step="0.05" value={cfg.limite_diario_usd} disabled={!admin} onChange={(e) => mudar({ limite_diario_usd: e.target.value })} />
                <span className="suave pequeno">Ao bater, a leitura pela IA para até a meia-noite. O "Organizar tudo" tem limite próprio.</span>
              </label>
              <label>Máximo de leads lidos por varredura
                <input type="number" min="1" max="200" value={cfg.max_leads_rodada} disabled={!admin} onChange={(e) => mudar({ max_leads_rodada: e.target.value })} />
                <span className="suave pequeno">O que passar disso fica para a próxima varredura.</span>
              </label>
            </div>
            <div className="org-regras suave pequeno">
              <b>Sem IA (custo zero):</b> primeira mensagem enviada → contactado · PDF com nome começando em <b>"Proposta comercial"</b> → proposta enviada (outros PDFs são ignorados) ·
              reunião do Calendly → agendada; horário passou sem cancelamento → aguardando proposta.<br />
              <b>Com IA:</b> critérios abaixo, reunião combinada fora do Calendly, reunião feita e proposta mandada por escrito. Cada movimentação guarda o trecho da conversa que a justifica.
            </div>
          </section>

          <Criterios cfg={cfg} etapas={dados.etapas} admin={admin} mudar={mudar} modelos={dados.modelos} gerador={dados.gerador} />

          {admin && alterado && (
            <div className="org-salvar">
              <span className="suave">Alterações não salvas</span>
              <button type="button" className="btn" onClick={() => { setCfg(dados.config); setAlterado(false); }}>Descartar</button>
              <button type="button" className="btn btn-ouro" disabled={salvando} onClick={() => salvar()}><Save size={14} /> {salvando ? 'Salvando…' : 'Salvar organizador'}</button>
            </div>
          )}
        </div>

        <div className="org-lateral">
          <OrganizarTudo dados={dados} admin={admin} diasPadrao={cfg.organizar_dias} aoMudar={setDados} />
        </div>
      </div>

      <Movimentos movimentos={dados.movimentos} aoMudar={(m) => setDados({ ...dados, movimentos: m })} />
    </div>
  );
}

function Criterios({ cfg, etapas, admin, mudar, modelos, gerador }) {
  const criterios = cfg.criterios;
  const [gerando, setGerando] = useState(null); // índice do critério com a janela "Criar com IA" aberta
  const rodando = gerador?.tarefa?.status === 'rodando' ? gerador.tarefa : null;
  const atualizar = (i, campos) => mudar({ criterios: criterios.map((c, j) => (j === i ? { ...c, ...campos } : c)) });
  const remover = (i) => mudar({ criterios: criterios.filter((_, j) => j !== i) });
  const novo = () => mudar({ criterios: [...criterios, { id: `c${Date.now().toString(36)}`, titulo: '', prompt: '', etapa_id: '', ativo: true, fixo: false }] });
  const etapaQualificado = etapas.find((s) => s.papel === 'qualificado');

  return (
    <section className="cartao-secao">
      <div className="ia-linha">
        <h2><Sparkles size={16} /> O que a IA procura nas conversas</h2>
        {admin && <button type="button" className="btn btn-pequeno" onClick={novo}><Plus size={13} /> Novo critério</button>}
      </div>
      <p className="suave pequeno">Descreva com suas palavras. Quando a conversa atende ao critério, o lead vai para a etapa escolhida (só avançando).</p>
      <div className="org-criterios">
        {criterios.map((c, i) => (
          <div key={c.id} className={`org-criterio ${c.ativo === false ? 'desligado' : ''}`}>
            <div className="org-criterio-topo">
              {c.fixo
                ? <b>Lead qualificado</b>
                : <input className="org-criterio-titulo" placeholder="Nome do critério (ex.: Pediu proposta)" value={c.titulo} maxLength={60} disabled={!admin} onChange={(e) => atualizar(i, { titulo: e.target.value })} />}
              <span className="org-seta"><ArrowRight size={14} /></span>
              {c.fixo
                ? <span className="org-destino">{etapaQualificado?.nome || 'defina a etapa "qualificado" em Editar etapas'}</span>
                : (
                  <select value={c.etapa_id || ''} disabled={!admin} onChange={(e) => atualizar(i, { etapa_id: Number(e.target.value) || '' })}>
                    <option value="">Levar para a etapa…</option>
                    {etapas.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                )}
              {admin && (
                <button type="button" className="btn btn-pequeno org-btn-gerar" onClick={() => setGerando(i)} title="A IA lê as conversas e as respostas do formulário e escreve este prompt">
                  <Wand2 size={13} /> {rodando?.criterio_id === c.id ? 'Criando…' : 'Criar com IA'}
                </button>
              )}
              <Interruptor ligado={c.ativo !== false} disabled={!admin} aoMudar={(ativo) => atualizar(i, { ativo })} />
              {!c.fixo && admin && <button type="button" className="btn btn-pequeno btn-perigo-leve" onClick={() => remover(i)} title="Apagar critério"><Trash2 size={13} /></button>}
            </div>
            <textarea
              rows={c.fixo ? 7 : 4}
              placeholder="O que precisa aparecer na conversa para o lead ir para esta etapa…"
              value={c.prompt}
              maxLength={4000}
              disabled={!admin}
              onChange={(e) => atualizar(i, { prompt: e.target.value })}
            />
          </div>
        ))}
      </div>
      {gerando !== null && criterios[gerando] && (
        <GeradorPrompt
          criterio={criterios[gerando]}
          modelos={modelos}
          gerador={gerador}
          aoFechar={() => setGerando(null)}
          aoUsar={(prompt) => { atualizar(gerando, { prompt }); setGerando(null); }}
        />
      )}
    </section>
  );
}

// Janela "Criar com IA": escolhe o modelo e o período, escreve o que pesa para você e a IA monta o prompt do critério
// a partir das conversas reais e das variáveis do formulário. O resultado só entra no critério ao clicar em "Usar este prompt".
function GeradorPrompt({ criterio, modelos, gerador, aoFechar, aoUsar }) {
  const aviso = useAviso();
  const fixo = criterio.id === 'qualificado';
  const [modelo, setModelo] = useState(gerador?.modelo_padrao || 'claude-opus-5-5');
  const [dias, setDias] = useState(60);
  const [orientacao, setOrientacao] = useState(fixo ? gerador?.orientacao_qualificado || '' : '');
  const [estimativa, setEstimativa] = useState(null);
  const [tarefa, setTarefa] = useState(gerador?.tarefa || { status: 'parada' });
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const minha = !tarefa.criterio_id || tarefa.criterio_id === criterio.id;
  const rodando = tarefa.status === 'rodando';

  const consultar = useCallback(async () => {
    try { setTarefa((await api('/organizador/gerar-prompt')).tarefa); } catch { /* tenta de novo no próximo ciclo */ }
  }, []);
  useEvento('organizador', consultar);
  useEffect(() => {
    if (!rodando) return undefined;
    const id = setInterval(consultar, 3000);
    return () => clearInterval(id);
  }, [rodando, consultar]);
  useEffect(() => { if (tarefa.status === 'concluida' && minha) setTexto(tarefa.resultado?.prompt || ''); }, [tarefa.status, tarefa.terminada_em]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (rodando || tarefa.status === 'concluida') return undefined;
    setEstimativa(null);
    const id = setTimeout(() => api(`/organizador/gerar-prompt/estimativa?dias=${dias}&modelo=${modelo}`).then(setEstimativa).catch(() => setEstimativa(null)), 400);
    return () => clearTimeout(id);
  }, [dias, modelo, rodando, tarefa.status]);

  const iniciar = async () => {
    setOcupado(true);
    try {
      const r = await api('/organizador/gerar-prompt', {
        method: 'POST',
        body: { criterio_id: criterio.id, criterio: { titulo: criterio.titulo, prompt: criterio.prompt, etapa_id: criterio.etapa_id }, orientacao, dias: Number(dias), modelo },
      });
      setTarefa(r.tarefa);
    } catch (e) { aviso(e.message, 'erro'); } finally { setOcupado(false); }
  };
  const dispensar = async () => {
    try { setTarefa((await api('/organizador/gerar-prompt', { method: 'DELETE' })).tarefa); } catch { /* já limpou */ }
  };
  const usar = async () => { aoUsar(texto); aviso('Prompt colocado no critério. Clique em "Salvar organizador" para valer.'); await dispensar(); };

  const r = tarefa.resultado;
  return (
    <Modal titulo={`Criar com IA — ${fixo ? 'Lead qualificado' : criterio.titulo || 'critério'}`} onFechar={aoFechar} largo>
      <div className="org-gerador">
        {(tarefa.status === 'parada' || tarefa.status === 'erro' || (!minha && !rodando)) && (
          <>
            <p className="suave pequeno">
              A IA lê as conversas reais dos leads do formulário, as perguntas e respostas do <b>Yay! Forms</b>, quem agendou pelo <b>Calendly</b>,
              quanto cada lead responde no WhatsApp e quem virou cliente ou se perdeu. Com isso escreve o prompt usando as variáveis exatas do seu formulário.
              Nada muda até você clicar em <b>Usar este prompt</b> e salvar.
            </p>
            {tarefa.status === 'erro' && minha && <p className="org-alerta"><AlertTriangle size={14} /> {tarefa.erro}</p>}
            <div className="ia-campos-2">
              <label>Modelo que analisa
                <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
                  {modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
                </select>
              </label>
              <label>Conversas dos últimos (dias)
                <input type="number" min="7" max="365" value={dias} onChange={(e) => setDias(e.target.value)} />
              </label>
            </div>
            <label>O que pesa para você {fixo ? '(já preenchido com o que você me disse — ajuste à vontade)' : ''}
              <textarea rows={6} maxLength={3000} value={orientacao} onChange={(e) => setOrientacao(e.target.value)}
                placeholder="Ex.: conta quando o lead pediu a proposta por escrito ou perguntou o valor do contrato…" />
            </label>
            <p className="suave pequeno">
              {estimativa
                ? <>{estimativa.leads} lead(s) do formulário no período · {estimativa.conversas} conversa(s) para ler · {estimativa.perguntas} pergunta(s) do formulário · custo estimado <b>{usd(estimativa.custo_estimado)}</b></>
                : 'Calculando o que há para ler…'}
            </p>
            <div className="org-salvar">
              <button type="button" className="btn" onClick={aoFechar}>Cancelar</button>
              <button type="button" className="btn btn-ouro" disabled={ocupado || !estimativa?.leads} onClick={iniciar}><Sparkles size={14} /> Ler conversas e criar prompt</button>
            </div>
          </>
        )}

        {rodando && (
          <>
            <p>{minha ? `Lendo as conversas dos últimos ${tarefa.dias} dias com ${tarefa.modelo}…` : 'A IA está criando o prompt de outro critério. Aguarde terminar.'}</p>
            <div className="org-progresso org-progresso-indef"><span /></div>
            <p className="suave pequeno">Pode levar alguns minutos. Dá para fechar esta janela: o trabalho continua e o resultado aparece quando você abrir de novo.</p>
          </>
        )}

        {tarefa.status === 'concluida' && minha && r && (
          <>
            <p className="suave pequeno">
              {r.modelo} leu {r.conversas} conversa(s) de {r.leads} lead(s) e {r.perguntas.length} pergunta(s) do formulário · custo {usd(r.custo)}. Revise e edite se quiser.
            </p>
            <textarea className="org-gerador-texto" rows={16} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} />
            {r.notas?.length > 0 && (
              <div className="org-gerador-notas">
                <b>O que a IA encontrou</b>
                <ul>{r.notas.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </div>
            )}
            <div className="org-salvar">
              <button type="button" className="btn" onClick={dispensar}>Descartar e refazer</button>
              <button type="button" className="btn btn-ouro" disabled={!texto.trim()} onClick={usar}>Usar este prompt</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function OrganizarTudo({ dados, admin, diasPadrao, aoMudar }) {
  const aviso = useAviso();
  const [dias, setDias] = useState(diasPadrao || 30);
  const [limite, setLimite] = useState(5);
  const [estimativa, setEstimativa] = useState(null);
  const [marcados, setMarcados] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const t = dados.tarefa;

  useEffect(() => {
    if (['analisando', 'pronta'].includes(t?.estado)) return undefined;
    const id = setTimeout(() => api(`/organizador/estimativa?dias=${dias}`).then(setEstimativa).catch(() => setEstimativa(null)), 300);
    return () => clearTimeout(id);
  }, [dias, t?.estado]);

  // Prévia nova: começa com os marcados por padrão (avanços); voltas vêm desmarcadas
  useEffect(() => {
    if (t?.estado === 'pronta') setMarcados(new Set(t.itens.filter((i) => i.marcado).map((i) => i.lead_id)));
    else setMarcados(null);
  }, [t?.id, t?.estado]); // eslint-disable-line react-hooks/exhaustive-deps

  const chamar = async (caminho, opcoes) => {
    setOcupado(true);
    try {
      const r = await api(caminho, opcoes);
      aoMudar({ ...dados, tarefa: r.tarefa });
      return r;
    } catch (e) { aviso(e.message, 'erro'); return null; } finally { setOcupado(false); }
  };
  const iniciar = () => chamar('/organizador/organizar', { method: 'POST', body: { dias: Number(dias), limite_usd: Number(limite) } });
  const aplicar = async () => {
    const r = await chamar('/organizador/organizar/aplicar', { method: 'POST', body: { lead_ids: [...(marcados || [])] } });
    if (r) aviso(`${r.tarefa.movidos} lead(s) movido(s)${r.tarefa.pulados ? ` · ${r.tarefa.pulados} pulado(s) porque mudaram depois da prévia` : ''}. A varredura volta a cuidar só das conversas novas.`);
  };
  const descartar = () => chamar('/organizador/organizar', { method: 'DELETE' });
  const alternar = (id) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <section className="cartao-secao org-organizar">
      <h2><Columns3 size={16} /> Organizar tudo automático</h2>

      {(!t || ['cancelada', 'erro'].includes(t.estado)) && (
        <>
          <p className="suave pequeno">
            A IA lê os leads em andamento dos últimos dias — antigos e novos, inclusive os que você moveu — e mostra uma <b>prévia</b> de para onde cada um iria.
            Nada é movido antes de você aplicar. Depois disso a varredura volta a olhar só as conversas novas.
          </p>
          {t?.estado === 'erro' && <p className="org-alerta"><AlertTriangle size={14} /> {t.erro}</p>}
          {t?.estado === 'cancelada' && <p className="suave pequeno">A última organização foi cancelada.</p>}
          <div className="ia-campos-2">
            <label>Últimos (dias)
              <input type="number" min="1" max="365" value={dias} disabled={!admin} onChange={(e) => setDias(e.target.value)} />
            </label>
            <label>Gastar no máximo (US$)
              <input type="number" min="0.05" step="0.5" value={limite} disabled={!admin} onChange={(e) => setLimite(e.target.value)} />
            </label>
          </div>
          {estimativa && (
            <p className="suave pequeno">
              {estimativa.total} lead(s) em andamento no período, {estimativa.com_conversa} com conversa para a IA ler ·
              estimativa {usd(estimativa.custo_estimado)} ({usd(estimativa.custo_por_lead)} por lead).
            </p>
          )}
          {admin && <button type="button" className="btn btn-ouro" disabled={ocupado || !estimativa?.total} onClick={iniciar}><Sparkles size={14} /> Analisar e mostrar prévia</button>}
        </>
      )}

      {t?.estado === 'analisando' && (
        <>
          <p>Lendo os leads… {t.feitos} de {t.total}</p>
          <div className="org-progresso"><span style={{ width: `${t.total ? Math.round((t.feitos / t.total) * 100) : 0}%` }} /></div>
          <p className="suave pequeno">Gasto até agora: {usd(t.gasto)} de {usd(t.limite_usd)} · {t.itens.length} mudança(s) encontrada(s){t.erros ? ` · ${t.erros} erro(s)` : ''}</p>
          {admin && <button type="button" className="btn btn-pequeno" onClick={descartar} disabled={ocupado}><X size={13} /> Cancelar</button>}
        </>
      )}

      {t?.estado === 'pronta' && marcados && (
        <>
          <p className="suave pequeno">
            {t.feitos} lido(s) · {t.itens.length} mudança(s) · {t.sem_mudanca} já no lugar certo · gasto {usd(t.gasto)}
            {t.parou_no_limite ? ' · parou no limite de gasto (os restantes não foram lidos)' : ''}
            {t.erros ? ` · ${t.erros} erro(s): ${t.ultimo_erro || ''}` : ''}
          </p>
          {t.itens.some((i) => i.direcao === 'volta') && (
            <p className="suave pequeno"><b>Voltar etapa</b> desfaz algo que alguém fez: vem desmarcado. Marque só se concordar.</p>
          )}
          <div className="org-previa">
            {t.itens.map((i) => (
              <label key={i.lead_id} className={`org-item ${i.direcao}`}>
                <input type="checkbox" checked={marcados.has(i.lead_id)} disabled={!admin} onChange={() => alternar(i.lead_id)} />
                <span className="org-item-corpo">
                  <span className="org-item-nome">
                    {i.nome}
                    {i.temperatura != null && <span className="org-temp"><Thermometer size={11} /> {i.temperatura}</span>}
                    {i.direcao === 'volta' && <span className="org-volta">volta</span>}
                  </span>
                  <span className="org-item-etapas">{i.de.nome} <ArrowRight size={12} /> <b>{i.para.nome}</b></span>
                  <span className="org-item-motivo">{i.motivo}{i.trecho ? <> — <i>“{i.trecho}”</i></> : null}</span>
                </span>
              </label>
            ))}
            {!t.itens.length && <p className="suave pequeno">Todos os leads lidos já estão na etapa certa.</p>}
          </div>
          {admin && (
            <div className="org-salvar">
              <button type="button" className="btn" onClick={descartar} disabled={ocupado}>Descartar prévia</button>
              <button type="button" className="btn btn-ouro" onClick={aplicar} disabled={ocupado || !marcados.size}>Aplicar {marcados.size} mudança(s)</button>
            </div>
          )}
        </>
      )}

      {t?.estado === 'concluida' && (
        <>
          <p>Organização aplicada {tempoDesde(t.aplicada_em)}: {t.movidos} lead(s) movido(s){t.pulados ? `, ${t.pulados} pulado(s)` : ''}.</p>
          <p className="suave pequeno">A varredura automática continua cuidando só das conversas novas.</p>
          {admin && <button type="button" className="btn btn-pequeno" onClick={descartar} disabled={ocupado}>Fechar</button>}
        </>
      )}
    </section>
  );
}

function Movimentos({ movimentos, aoMudar }) {
  const aviso = useAviso();
  const [ocupado, setOcupado] = useState(null);
  const desfazer = async (m) => {
    setOcupado(m.id);
    try {
      const r = await api(`/organizador/movimentos/${m.id}/desfazer`, { method: 'POST' });
      aoMudar(r.movimentos);
      aviso(`${m.lead_nome || 'Lead'} voltou para ${m.de_nome}. A IA não leva mais este lead para ${m.para_nome}.`);
    } catch (e) { aviso(e.message, 'erro'); } finally { setOcupado(null); }
  };
  return (
    <section className="cartao-secao">
      <h2><Undo2 size={16} /> Movimentações do organizador</h2>
      {!movimentos.length && <p className="suave pequeno">Nenhuma movimentação ainda.</p>}
      <div className="org-movs">
        {movimentos.map((m) => (
          <div key={m.id} className={`org-mov ${m.desfeito_em ? 'desfeito' : ''}`}>
            <div className="org-mov-topo">
              <b>{m.lead_nome || `Lead #${m.lead_id}`}</b>
              <span className="org-item-etapas">{m.de_nome} <ArrowRight size={12} /> {m.para_nome}</span>
              <span className={`ia-etiqueta org-origem-${m.origem}`}>{m.origem === 'regra' ? 'Regra' : 'IA'}{m.modo === 'organizar' ? ' · Organizar tudo' : ''}</span>
              <span className="suave pequeno">{tempoDesde(m.created_at)}</span>
              {m.desfeito_em
                ? <span className="suave pequeno">desfeito{m.desfeito_por_nome ? ` por ${m.desfeito_por_nome}` : ''}</span>
                : <button type="button" className="btn btn-pequeno" disabled={ocupado === m.id} onClick={() => desfazer(m)}><Undo2 size={12} /> Desfazer</button>}
            </div>
            <div className="org-item-motivo">{m.motivo}{m.trecho ? <> — <i>“{m.trecho}”</i></> : null}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
