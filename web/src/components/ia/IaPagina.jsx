// Tela "IA": configuração da IA de primeiro contato, playbook aprendido das conversas, diretrizes (prompts), simulador e conversas atendidas.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot, Save, KeyRound, Building2, Wand2, Clock, ShieldCheck, MessageSquareText, Send, RotateCcw, ExternalLink, Trash2, Sparkles, History,
} from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde, formatarTelefone } from '../../utils.js';
import { ProvedorAvisos, useAviso, Interruptor } from '../disparos/comum.jsx';
import '../disparos/disparos.css';
import DiretrizesIa from './DiretrizesIa.jsx';
import FilaPendentes from './FilaPendentes.jsx';
import './ia.css';

const DIAS = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado'], [0, 'Domingo']];
const STATUS = {
  ativa: ['IA atendendo', 'ok'],
  aguardando_humano: ['Aguardando você', 'aviso'],
  humano: ['Equipe assumiu', 'neutro'],
  pausada: ['Pausada', 'neutro'],
  erro: ['Erro', 'erro'],
};
const FUSOS = ['America/Sao_Paulo', 'America/Santiago', 'America/Manaus', 'America/Fortaleza', 'America/Recife', 'America/Belem', 'America/Cuiaba', 'America/Rio_Branco'];
const numeroFormatado = (n) => new Intl.NumberFormat('pt-BR').format(n || 0);
const dataCurta = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const ORIGEM_PLAYBOOK = { manual: 'editado à mão', analise: 'análise profunda', melhoria: 'melhoria', automatica: 'melhoria automática' };
// Texto que termina sem pontuação, fechamento de negrito/aspas ou parêntese provavelmente parou no meio
const parecePelaMetade = (t) => Boolean(t?.trim()) && !/[.!?)"”*:\]]\s*$/.test(t.trim());
const rotuloModelo = (m) => `${m.nome} — ${m.nivel}${m.preco ? ` (${m.preco})` : ''}`;

export default function IaPagina(props) {
  return <ProvedorAvisos><Conteudo {...props} /></ProvedorAvisos>;
}

function Conteudo({ user, aoAbrirConversa }) {
  const aviso = useAviso();
  const admin = user?.role === 'admin';
  const [dados, setDados] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [alterado, setAlterado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [chave, setChave] = useState('');
  const [workspace, setWorkspace] = useState(null);
  const [tarefa, setTarefa] = useState(null);
  const [mudancas, setMudancas] = useState(null);
  const tarefaTratada = useRef(null);
  const [conversas, setConversas] = useState([]);
  const [filtro, setFiltro] = useState('');

  const carregar = useCallback(async () => {
    try {
      const d = await api('/ia/config');
      setDados(d);
      setCfg((atual) => (atual && alterado ? atual : d.config));
    } catch (e) { aviso(e.message, 'erro'); }
  }, [aviso, alterado]);
  const carregarConversas = useCallback(() => api(`/ia/conversas${filtro ? `?status=${filtro}` : ''}`).then((d) => setConversas(d.conversas)).catch(() => {}), [filtro]);

  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregarConversas(); }, [carregarConversas]);
  useEvento('ia', (d) => { carregarConversas(); api('/ia/config').then((x) => setDados(x)).catch(() => {}); if (d?.playbook) acompanharTarefa(); });

  const mudar = (p) => { setCfg((c) => ({ ...c, ...p })); setAlterado(true); };

  const salvar = async (extra = {}) => {
    setSalvando(true);
    try {
      const d = await api('/ia/config', { method: 'PUT', body: { ...cfg, ...extra } });
      setCfg(d.config);
      setDados((x) => ({ ...x, config: d.config }));
      setAlterado(false);
      aviso(extra.ativo === undefined ? 'Configuração salva' : extra.ativo ? 'IA de primeiro contato ligada' : 'IA desligada', extra.ativo === false ? 'info' : 'ok');
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };

  const salvarChave = async () => {
    setSalvando(true);
    try {
      const d = await api('/ia/chave', { method: 'PUT', body: { chave, ...(workspace !== null ? { workspace_id: workspace } : {}) } });
      setChave('');
      setCfg((c) => ({ ...c, ...pegarChave(d.config) }));
      setDados((x) => ({ ...x, config: d.config }));
      setWorkspace(null);
      if (d.aviso) aviso(d.aviso, 'erro');
      else aviso('Chave conferida com a Anthropic e salva');
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };
  const removerChave = async () => {
    if (!confirm('Remover a chave da API? A IA será desligada.')) return;
    try {
      const d = await api('/ia/chave', { method: 'DELETE' });
      setCfg((c) => ({ ...c, ...pegarChave(d.config), ativo: false }));
      setDados((x) => ({ ...x, config: d.config }));
      aviso('Chave removida', 'info');
    } catch (e) { aviso(e.message, 'erro'); }
  };

  // Playbook: a análise roda no servidor em segundo plano; aqui acompanhamos até terminar
  const aplicarResultado = useCallback((t) => {
    const r = t.resultado || {};
    if (t.automatica) {
      aviso(r.aplicado ? 'A melhoria automática atualizou o playbook.' : 'A melhoria automática não viu nada para mudar.', 'info');
      api('/ia/config').then((d) => { setDados(d); setCfg(d.config); setAlterado(false); }).catch(() => {});
    } else if (t.tipo === 'continuar') {
      mudar({ playbook: r.playbook });
      aviso(r.completo
        ? `Playbook completado com ${r.modelo}: ${numeroFormatado(r.acrescentado)} caracteres acrescentados no final, o resto ficou igual. Revise e salve.`
        : `Acrescentei ${numeroFormatado(r.acrescentado)} caracteres, mas o modelo ${r.motivo_parada}. Salve e clique em "Continuar de onde parou" de novo.`, r.completo ? 'ok' : 'erro');
    } else if (r.sem_mudancas) {
      mudar({ playbook_lido_ate: r.lido_ate });
      setMudancas([]);
      aviso(`Li ${r.conversas_analisadas} conversa(s) nova(s) e o playbook já cobre tudo. Salve para marcar a leitura.`, 'info');
    } else {
      mudar({ playbook: r.playbook, playbook_lido_ate: r.lido_ate, playbook_origem: t.tipo === 'melhorar' ? 'melhoria' : 'analise' });
      setMudancas(r.mudancas || null);
      aviso(`${t.tipo === 'melhorar' ? 'Playbook melhorado' : 'Playbook gerado'} com ${r.modelo} a partir de ${r.conversas_analisadas} conversa(s). Revise e salve.${r.completo === false ? ` Atenção: ficou incompleto (o modelo ${r.motivo_parada}). Use "Continuar de onde parou".` : ''}`, r.completo === false ? 'erro' : 'ok');
    }
    api('/ia/playbook/tarefa', { method: 'DELETE' }).catch(() => {});
  }, [aviso]); // eslint-disable-line react-hooks/exhaustive-deps

  const acompanharTarefa = useCallback(async () => {
    try {
      const { tarefa: t } = await api('/ia/playbook/tarefa');
      setTarefa(t);
      if (t.status !== 'concluida' && t.status !== 'erro') return;
      if (tarefaTratada.current === t.iniciada_em) return;
      tarefaTratada.current = t.iniciada_em;
      if (t.status === 'concluida') aplicarResultado(t);
      else if (t.status === 'erro') { aviso(t.erro, 'erro'); api('/ia/playbook/tarefa', { method: 'DELETE' }).catch(() => {}); }
    } catch { /* tenta de novo no próximo ciclo */ }
  }, [aplicarResultado, aviso]);

  useEffect(() => { acompanharTarefa(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tarefa?.status !== 'rodando') return undefined;
    const t = setInterval(acompanharTarefa, 3000);
    return () => clearInterval(t);
  }, [tarefa?.status, acompanharTarefa]);

  const rodarPlaybook = async (tipo) => {
    if (tipo === 'gerar' && cfg.playbook && !confirm('Fazer a análise profunda e substituir o playbook atual? (Você revisa antes de salvar e a versão atual fica guardada.)')) return;
    if (tipo !== 'continuar' && alterado && !confirm('Há mudanças não salvas na tela. A análise usa o playbook SALVO. Continuar mesmo assim?')) return;
    setMudancas(null);
    try {
      // Salva antes a escolha do modelo de análise, se mudou
      if (cfg.modelo_playbook !== dados.config.modelo_playbook) await api('/ia/config', { method: 'PUT', body: { modelo_playbook: cfg.modelo_playbook } });
      const d = await api(`/ia/playbook/${tipo}`, { method: 'POST', ...(tipo === 'continuar' ? { body: { playbook: cfg.playbook } } : {}) });
      setTarefa(d.tarefa);
    } catch (e) { aviso(e.message, 'erro'); }
  };

  const restaurarVersao = async (indice) => {
    if (indice === '') return;
    try {
      const { versao } = await api(`/ia/playbook/versoes/${indice}`);
      if (!confirm(`Colocar na tela a versão de ${dataCurta(versao.em)} (${ORIGEM_PLAYBOOK[versao.origem] || versao.origem})? Ela só vale depois de salvar.`)) return;
      mudar({ playbook: versao.texto, playbook_origem: 'manual' });
      setMudancas(null);
    } catch (e) { aviso(e.message, 'erro'); }
  };

  if (!cfg || !dados) return <div className="dp-centro"><div className="carregando" /></div>;
  const r = dados.resumo;
  const tokens = r.ultimos_30_dias.tokens;

  return (
    <div className="pagina pagina-larga dp-pagina ia-pagina">
      <div className="cabecalho-pagina"><h1>IA de primeiro contato</h1></div>
      <div className="dp-aba">
        <section className={`dp-mestre ${cfg.ativo ? 'ligada' : ''}`}>
          <div className="dp-mestre-icone"><Bot size={22} /></div>
          <div className="dp-mestre-texto">
            <h2>Atende só leads novos e passa para você</h2>
            <p className="suave">
              Cumprimenta, apresenta a {cfg.empresa}, tira dúvidas básicas e marca o lead como <b>aguardando você</b> no kanban.
              Para na hora em que alguém da equipe escreve. Modelo: <b>{cfg.modelo_nome}</b>.
            </p>
            <p className="dp-mestre-status">
              {r.dentro_do_horario ? 'Dentro do horário comercial agora.' : 'Fora do horário comercial agora: a IA avisa que não há atendimento humano de prontidão.'}
              {' '}Hoje: {r.hoje.mensagens} mensagem(ns), {r.hoje.passagens} passagem(ns) para você{r.hoje.bloqueios ? `, ${r.hoje.bloqueios} tentativa(s) bloqueada(s)` : ''}.
            </p>
          </div>
          <Interruptor grande ligado={cfg.ativo} disabled={!admin || salvando} aoMudar={(ativo) => salvar({ ativo })} rotulo={cfg.ativo ? 'Ligada' : 'Desligada'} />
        </section>

        {!admin && <div className="dp-dica-admin">Só administradores alteram a IA. Você pode ver a configuração e as conversas.</div>}
        {dados.saudacao_disparos_ativa && cfg.iniciar_formulario && (
          <div className="dp-dica-admin">
            A <b>saudação automática do Yay! Forms</b> (aba Disparos) está ligada. Enquanto ela estiver ligada, a IA não manda a primeira mensagem
            para leads do formulário — só responde quando eles escreverem. Para a IA fazer a abertura, desligue a saudação nos Disparos.
          </div>
        )}

        <div className="dp-grade">
          <div className="dp-coluna-principal">
            <section className="cartao-secao">
              <h2>Como ela trabalha</h2>
              <div className="ia-modos" role="radiogroup" aria-label="Modo">
                <button type="button" role="radio" aria-checked={cfg.modo === 'sugestao'} className={cfg.modo === 'sugestao' ? 'ativo' : ''} disabled={!admin} onClick={() => mudar({ modo: 'sugestao' })}>
                  <b>Copiloto</b><span>A IA escreve, você aprova ou edita com 1 clique na conversa. Recomendado para começar.</span>
                </button>
                <button type="button" role="radio" aria-checked={cfg.modo === 'automatico'} className={cfg.modo === 'automatico' ? 'ativo' : ''} disabled={!admin} onClick={() => mudar({ modo: 'automatico' })}>
                  <b>Automático</b><span>A IA envia sozinha, com "digitando…" e tempo de uma pessoa.</span>
                </button>
              </div>
              <label>Modelo que responde os leads
                <select value={cfg.modelo_atendimento} disabled={!admin} onChange={(e) => mudar({ modelo_atendimento: e.target.value })}>
                  {cfg.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
                </select>
                <span className="suave pequeno">Preço em US$ por milhão de tokens (entrada / saída). Para o primeiro contato o Haiku costuma bastar; os maiores entendem melhor conversas difíceis, mas custam mais a cada mensagem.</span>
              </label>
              {cfg.modo === 'sugestao' && (
                <label className="dp-check">
                  <input type="checkbox" checked={cfg.automatico_fora_horario} disabled={!admin} onChange={(e) => mudar({ automatico_fora_horario: e.target.checked })} />
                  <span>Fora do horário comercial, responder sozinha (não há ninguém para aprovar)</span>
                </label>
              )}
              <p className="suave pequeno">
                Últimos 30 dias: {r.ultimos_30_dias.conversas} conversa(s), {r.ultimos_30_dias.mensagens} mensagem(ns) enviadas, {r.ultimos_30_dias.passagens} passagem(ns) para a equipe
                {cfg.modo === 'sugestao' || r.ultimos_30_dias.sugestoes_aprovadas ? ` · sugestões: ${r.ultimos_30_dias.sugestoes_aprovadas} aprovadas sem mudança, ${r.ultimos_30_dias.sugestoes_editadas} editadas, ${r.ultimos_30_dias.sugestoes_descartadas} descartadas` : ''}
                {' '}· tokens: {numeroFormatado(tokens.entrada)} de entrada, {numeroFormatado(tokens.saida)} de saída{tokens.cache ? `, ${numeroFormatado(tokens.cache)} em cache` : ''}.
              </p>
            </section>

            {admin && (
              <section className="cartao-secao">
                <h2><KeyRound size={16} /> Chave da API da Anthropic</h2>
                {cfg.chave_configurada ? (
                  <div className="ia-linha">
                    <span>Chave {cfg.chave_final} {cfg.chave_origem === 'env' ? <span className="suave pequeno">(do arquivo .env)</span> : null}</span>
                    {cfg.chave_origem === 'painel' && <button type="button" className="btn btn-pequeno btn-perigo-leve" onClick={removerChave}><Trash2 size={13} /> Remover</button>}
                  </div>
                ) : <p className="suave pequeno">Crie uma chave em console.anthropic.com (API keys) e cole aqui. Ela fica guardada só no servidor do CRM.</p>}
                <div className="ia-linha">
                  <input type="password" autoComplete="off" placeholder="sk-ant-..." value={chave} onChange={(e) => setChave(e.target.value)} />
                  <button type="button" className="btn" disabled={!chave.trim() || salvando} onClick={salvarChave}>{cfg.chave_configurada ? 'Trocar' : 'Salvar'}</button>
                </div>
                <label>ID do workspace (só se a Anthropic pedir)
                  <div className="ia-linha">
                    <input placeholder="wrkspc_..." value={workspace ?? cfg.workspace_id ?? ''} onChange={(e) => setWorkspace(e.target.value)} />
                    <button type="button" className="btn" disabled={salvando || workspace === null || (!chave.trim() && !cfg.chave_configurada)} onClick={salvarChave}>Salvar e testar</button>
                  </div>
                  <span className="suave pequeno">No Console: Settings → Workspaces → copie o ID do workspace onde estão os créditos.</span>
                </label>
              </section>
            )}

            <section className="cartao-secao">
              <h2><Building2 size={16} /> Apresentação</h2>
              <div className="ia-campos-3">
                <label>Nome da atendente virtual<input value={cfg.nome_atendente} disabled={!admin} onChange={(e) => mudar({ nome_atendente: e.target.value })} /></label>
                <label>Fala no
                  <select value={cfg.genero_atendente || 'feminino'} disabled={!admin} onChange={(e) => mudar({ genero_atendente: e.target.value })}>
                    <option value="feminino">Feminino (obrigada, a atendente)</option>
                    <option value="masculino">Masculino (obrigado, o atendente)</option>
                  </select>
                </label>
                <label>Empresa<input value={cfg.empresa} disabled={!admin} onChange={(e) => mudar({ empresa: e.target.value })} /></label>
              </div>
              <label>Como se apresenta na primeira mensagem
                <input value={cfg.apresentacao} disabled={!admin} onChange={(e) => mudar({ apresentacao: e.target.value })} />
                <span className="suave pequeno">
                  A IA se apresenta como {cfg.genero_atendente === 'masculino' ? 'o' : 'a'} {cfg.nome_atendente || 'atendente'} e, ao passar o lead, diz que alguém da equipe continua por aqui.
                  Se o lead perguntar se é um robô, ela nunca nega: diz que é {cfg.genero_atendente === 'masculino' ? 'o assistente virtual' : 'a assistente virtual'} do atendimento.
                </span>
              </label>
              <label>Sobre a empresa (o que a IA pode explicar)
                <textarea rows={4} value={cfg.sobre_empresa} disabled={!admin} onChange={(e) => mudar({ sobre_empresa: e.target.value })} />
              </label>
              <label>Link de agendamento (opcional)
                <input placeholder="https://calendly.com/..." value={cfg.link_agenda} disabled={!admin} onChange={(e) => mudar({ link_agenda: e.target.value })} />
                <span className="suave pequeno">Único link que a IA pode mandar. Vazio = ela nunca manda links.</span>
              </label>
            </section>

            <section className="cartao-secao">
              <div className="dp-secao-topo">
                <h2><Wand2 size={16} /> Seu jeito de atender (playbook)</h2>
                {cfg.playbook_atualizado_em && <span className="suave pequeno">Atualizado em {dataCurta(cfg.playbook_atualizado_em)}{cfg.playbook_origem ? ` · ${ORIGEM_PLAYBOOK[cfg.playbook_origem] || ''}` : ''}</span>}
              </div>
              <p className="suave pequeno">
                Só conversas com leads que preencheram o formulário (sem pessoais nem de grupo, sem mensagens dos Disparos), priorizando as que viraram reunião ou cliente.
                Antes de ir para a IA, nomes, telefones, e-mails, links e valores são retirados. Revise antes de salvar.
              </p>

              {admin && (
                <div className="ia-playbook-acoes">
                  <label>Modelo da análise
                    <select value={cfg.modelo_playbook} disabled={tarefa?.status === 'rodando'} onChange={(e) => mudar({ modelo_playbook: e.target.value })}>
                      {cfg.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
                    </select>
                  </label>
                  <div className="ia-playbook-botoes">
                    <button type="button" className="btn" disabled={tarefa?.status === 'rodando' || !cfg.chave_configurada} onClick={() => rodarPlaybook('gerar')}
                      title="Lê as conversas dos últimos 60 dias, raciocina sobre elas e monta o playbook do zero">
                      <Sparkles size={14} /> Análise profunda (60 dias)
                    </button>
                    <button type="button" className="btn" disabled={tarefa?.status === 'rodando' || !cfg.chave_configurada || !cfg.playbook?.trim()} onClick={() => rodarPlaybook('melhorar')}
                      title="Lê só as conversas novas desde a última leitura (suas e da IA) e complementa o playbook se precisar">
                      <Wand2 size={14} /> Melhorar com conversas novas
                    </button>
                    <button type="button" className="btn" disabled={tarefa?.status === 'rodando' || !cfg.chave_configurada || !cfg.playbook?.trim()} onClick={() => rodarPlaybook('continuar')}
                      title="Usa o texto que está na tela (mesmo sem salvar): a IA escreve só o que falta, a partir do último caractere">
                      <Send size={14} /> Continuar de onde parou
                    </button>
                  </div>
                  <span className="suave pequeno">
                    A análise profunda lê tudo dos últimos 60 dias com o raciocínio ligado e leva alguns minutos (a tela pode ficar aberta ou não).
                    A melhoria lê só o que chegou depois da última leitura{cfg.playbook_lido_ate ? ` (${dataCurta(cfg.playbook_lido_ate)})` : ''}, das suas conversas e das da IA.
                  </span>
                </div>
              )}

              {tarefa?.status === 'rodando' && (
                <div className="ia-playbook-tarefa">
                  <div className="carregando pequeno" />
                  <span>{tarefa.tipo === 'melhorar' ? 'Lendo as conversas novas' : tarefa.tipo === 'continuar' ? 'Completando o playbook a partir de onde parou' : 'Estudando as conversas dos últimos 60 dias'} com {tarefa.modelo}… pode levar alguns minutos.
                    {tarefa.automatica ? ' (melhoria automática)' : ''} Começou {tempoDesde(tarefa.iniciada_em)}.</span>
                </div>
              )}

              {mudancas && (
                <div className="ia-playbook-mudancas">
                  <b>{mudancas.length ? 'O que mudou' : 'Nada para mudar'}</b>
                  {mudancas.length ? <ul>{mudancas.map((m, i) => <li key={i}>{m}</li>)}</ul> : <span className="suave pequeno"> — as conversas novas já estão cobertas pelo playbook.</span>}
                </div>
              )}

              {admin && tarefa?.status !== 'rodando' && parecePelaMetade(cfg.playbook) && (
                <div className="ia-playbook-mudancas ia-playbook-incompleto">
                  <span>O playbook parece ter parado no meio (termina em "…{cfg.playbook.trim().slice(-30)}").</span>
                  <button type="button" className="btn btn-pequeno" onClick={() => rodarPlaybook('continuar')}><Send size={13} /> Continuar de onde parou</button>
                </div>
              )}

              <textarea rows={18} value={cfg.playbook} disabled={!admin || (tarefa?.status === 'rodando' && tarefa.tipo === 'continuar')} placeholder="Ainda sem playbook: a IA usa um estilo curto, cordial e direto. Use a análise profunda para montar o primeiro."
                onChange={(e) => mudar({ playbook: e.target.value, playbook_origem: 'manual' })} />

              {admin && (
                <div className="ia-playbook-rodape">
                  <label className="dp-check">
                    <input type="checkbox" checked={Boolean(cfg.playbook_auto)} disabled={!cfg.playbook?.trim()} onChange={(e) => mudar({ playbook_auto: e.target.checked })} />
                    <span>Melhorar sozinha a cada
                      {' '}<input type="number" min={1} max={60} className="ia-dias" value={cfg.playbook_auto_dias} onChange={(e) => mudar({ playbook_auto_dias: e.target.value })} />{' '}
                      dias, lendo só as conversas novas (aplica direto; a versão anterior fica guardada)</span>
                  </label>
                  {cfg.playbook_versoes?.length > 0 && (
                    <label className="ia-versoes"><span><History size={13} /> Versões anteriores</span>
                      <select value="" onChange={(e) => restaurarVersao(e.target.value)}>
                        <option value="">Escolher para voltar…</option>
                        {cfg.playbook_versoes.map((v) => <option key={v.indice} value={v.indice}>{dataCurta(v.em)} · {ORIGEM_PLAYBOOK[v.origem] || v.origem} · {numeroFormatado(v.tamanho)} caracteres</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
              <span className="suave pequeno">{numeroFormatado(cfg.playbook?.length)} de 20.000 caracteres.</span>
            </section>

            <DiretrizesIa admin={admin} />

            <section className="cartao-secao">
              <h2><Clock size={16} /> Horário com atendimento humano</h2>
              <div className="ia-horario">
                {DIAS.map(([d, nome]) => {
                  const faixa = cfg.horario?.[d];
                  return (
                    <div key={d} className="ia-dia">
                      <label className="dp-check"><input type="checkbox" checked={Boolean(faixa)} disabled={!admin}
                        onChange={(e) => mudar({ horario: { ...cfg.horario, [d]: e.target.checked ? { inicio: '07:00', fim: '18:00' } : null } })} /> <span>{nome}</span></label>
                      {faixa ? (
                        <span className="ia-dia-horas">
                          <input type="time" value={faixa.inicio} disabled={!admin} onChange={(e) => mudar({ horario: { ...cfg.horario, [d]: { ...faixa, inicio: e.target.value } } })} />
                          às
                          <input type="time" value={faixa.fim} disabled={!admin} onChange={(e) => mudar({ horario: { ...cfg.horario, [d]: { ...faixa, fim: e.target.value } } })} />
                        </span>
                      ) : <span className="suave pequeno">sem atendimento</span>}
                    </div>
                  );
                })}
              </div>
              <label>Fuso horário
                <select value={cfg.fuso} disabled={!admin} onChange={(e) => mudar({ fuso: e.target.value })}>
                  {[...new Set([...FUSOS, cfg.fuso])].map((f) => <option key={f} value={f}>{f.replace('America/', '').replace('_', ' ')}</option>)}
                </select>
              </label>
              <label>Aviso fora do horário (vai na primeira resposta, uma vez por conversa)
                <textarea rows={3} value={cfg.aviso_fora_horario} disabled={!admin} onChange={(e) => mudar({ aviso_fora_horario: e.target.value })} />
              </label>
            </section>

            <section className="cartao-secao">
              <h2><ShieldCheck size={16} /> Limites e proteção</h2>
              <StatusProtecao protecao={dados.protecao} cfg={cfg} admin={admin} aoRetomar={async () => {
                try { await api('/ia/protecao/retomar', { method: 'POST' }); aviso('IA liberada para voltar a atender'); carregar(); } catch (e) { aviso(e.message, 'erro'); }
              }} />
              <div className="dp-config-grade">
                <div className="dp-config-item">
                  <span className="dp-config-titulo">Quem é lead novo</span>
                  <span className="pequeno">Ninguém da equipe falou com ele e a conversa tem menos de
                    <input className="dp-inline-num" type="number" min={1} value={cfg.janela_lead_novo_horas} disabled={!admin} onChange={(e) => mudar({ janela_lead_novo_horas: Number(e.target.value) })} /> horas.</span>
                  <label className="dp-check">
                    <input type="checkbox" checked={cfg.iniciar_formulario} disabled={!admin} onChange={(e) => mudar({ iniciar_formulario: e.target.checked })} />
                    <span>Lead novo do Yay! Forms: a IA manda a primeira mensagem (1 a 2 min depois do cadastro)</span>
                  </label>
                  <FilaPendentes admin={admin} alterado={alterado} />
                </div>
                <div className="dp-config-item">
                  <span className="dp-config-titulo">Quando passa para você</span>
                  <span className="pequeno">Ao pedir uma pessoa, perguntar preço, contrato, resultado ou nicho, mandar áudio/arquivo, ou depois de
                    <input className="dp-inline-num" type="number" min={1} max={20} value={cfg.max_mensagens_ia} disabled={!admin} onChange={(e) => mudar({ max_mensagens_ia: Number(e.target.value) })} /> mensagens da IA.</span>
                </div>
                <div className="dp-config-item">
                  <span className="dp-config-titulo">Ritmo de atendimento</span>
                  <label className="dp-check">
                    <input type="checkbox" disabled={!admin} checked={Boolean(cfg.um_por_vez)} onChange={(e) => mudar({ um_por_vez: e.target.checked })} />
                    <span>Atende um lead por vez (só começa o próximo quando termina de responder o atual)</span>
                  </label>
                  <span className="pequeno">Ao trocar de lead, espera de
                    <input className="dp-inline-num" type="number" min={0} max={1800} value={cfg.intervalo_leads_min_seg} disabled={!admin} onChange={(e) => mudar({ intervalo_leads_min_seg: Number(e.target.value) })} /> a
                    <input className="dp-inline-num" type="number" min={0} max={1800} value={cfg.intervalo_leads_max_seg} disabled={!admin} onChange={(e) => mudar({ intervalo_leads_max_seg: Number(e.target.value) })} /> s (sorteado a cada vez).</span>
                  <label className="dp-check">
                    <input type="checkbox" disabled={!admin} checked={Boolean(cfg.descanso_ativo)} onChange={(e) => mudar({ descanso_ativo: e.target.checked })} />
                    <span>Pausas de descanso</span>
                  </label>
                  <span className={`pequeno${cfg.descanso_ativo ? '' : ' suave'}`}>A cada
                    <input className="dp-inline-num" type="number" min={2} max={500} value={cfg.descanso_a_cada} disabled={!admin || !cfg.descanso_ativo} onChange={(e) => mudar({ descanso_a_cada: Number(e.target.value) })} /> mensagens, descansa de
                    <input className="dp-inline-num" type="number" min={1} max={240} value={cfg.descanso_min_min} disabled={!admin || !cfg.descanso_ativo} onChange={(e) => mudar({ descanso_min_min: Number(e.target.value) })} /> a
                    <input className="dp-inline-num" type="number" min={1} max={240} value={cfg.descanso_max_min} disabled={!admin || !cfg.descanso_ativo} onChange={(e) => mudar({ descanso_max_min: Number(e.target.value) })} /> min.</span>
                </div>
                <div className="dp-config-item">
                  <span className="dp-config-titulo">Limites de envio</span>
                  <span className="pequeno">No máximo
                    <input className="dp-inline-num" type="number" min={1} max={200} value={cfg.limite_por_hora} disabled={!admin} onChange={(e) => mudar({ limite_por_hora: Number(e.target.value) })} /> mensagens da IA por hora.</span>
                  <span className="pequeno">No máximo
                    <input className="dp-inline-num" type="number" min={1} max={3000} value={cfg.limite_por_dia} disabled={!admin} onChange={(e) => mudar({ limite_por_dia: Number(e.target.value) })} /> mensagens em 24 horas.</span>
                  <span className="pequeno">No máximo
                    <input className="dp-inline-num" type="number" min={1} max={1000} value={cfg.limite_novos_por_dia} disabled={!admin} onChange={(e) => mudar({ limite_novos_por_dia: Number(e.target.value) })} /> leads novos abordados em 24 horas.</span>
                  <span className="suave pequeno">3 erros de envio seguidos pausam a IA por 30 min.</span>
                </div>
                <div className="dp-config-item">
                  <span className="dp-config-titulo">Jeito humano de digitar</span>
                  <span className="pequeno">Espera
                    <input className="dp-inline-num" type="number" min={3} max={120} value={cfg.espera_agrupar_seg} disabled={!admin} onChange={(e) => mudar({ espera_agrupar_seg: Number(e.target.value) })} /> s o lead terminar de digitar antes de responder.</span>
                  <span className="pequeno">Mais de um balão: espera
                    <input className="dp-inline-num" type="number" min={0} max={15} value={cfg.intervalo_blocos_seg ?? 2} disabled={!admin} onChange={(e) => mudar({ intervalo_blocos_seg: Number(e.target.value) })} /> s entre um e outro (com "digitando…").</span>
                </div>
                <div className="dp-config-item">
                  <span className="dp-config-titulo">Números em que atua</span>
                  {!dados.numeros.length && <span className="suave pequeno">Nenhum número cadastrado.</span>}
                  {dados.numeros.map((n) => (
                    <label key={n.id} className="dp-check">
                      <input type="checkbox" disabled={!admin} checked={!cfg.numero_ids.length || cfg.numero_ids.includes(n.id)}
                        onChange={(e) => {
                          const todos = dados.numeros.map((x) => x.id);
                          const atuais = cfg.numero_ids.length ? cfg.numero_ids : todos;
                          const novos = e.target.checked ? [...atuais, n.id] : atuais.filter((x) => x !== n.id);
                          mudar({ numero_ids: novos.length === todos.length ? [] : novos });
                        }} />
                      <span>{n.nome}{n.phone ? ` · ${formatarTelefone(n.phone)}` : ''}</span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="suave pequeno">
                Segurança: a IA não recebe ordens do lead. Pedidos de código, senha, acesso ou para "ignorar instruções" recebem uma resposta pronta (na 2ª vez, o lead vai para você).
                Ela só vê a conversa daquele lead — não tem acesso ao CRM nem a dados de outros clientes — e toda resposta passa por um filtro que barra código,
                telefones, e-mails, links não autorizados e promessas de resultado antes de sair.
              </p>
            </section>

            <ConversasDaIa conversas={conversas} filtro={filtro} setFiltro={setFiltro} aoAbrir={aoAbrirConversa} />
          </div>

          <aside className="dp-coluna-previa">
            <Simulador cfg={cfg} admin={admin} />
          </aside>
        </div>

        {admin && alterado && (
          <div className="dp-rodape-fixo visivel">
            <span>Há alterações não salvas</span>
            <button className="btn btn-ouro" disabled={salvando} onClick={() => salvar()}><Save size={14} /> {salvando ? 'Salvando…' : 'Salvar configuração'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

const pegarChave = (c) => ({ chave_configurada: c.chave_configurada, chave_final: c.chave_final, chave_origem: c.chave_origem, workspace_id: c.workspace_id });

function ConversasDaIa({ conversas, filtro, setFiltro, aoAbrir }) {
  return (
    <section className="cartao-secao">
      <div className="dp-secao-topo">
        <h2><MessageSquareText size={16} /> Conversas atendidas pela IA</h2>
        <select className="ia-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por situação">
          <option value="">Todas</option>
          {Object.entries(STATUS).map(([k, [rotulo]]) => <option key={k} value={k}>{rotulo}</option>)}
        </select>
      </div>
      {!conversas.length ? <p className="suave pequeno">Nenhuma conversa ainda.</p> : (
        <table className="tabela">
          <tbody>
            {conversas.map((c) => {
              const [rotulo, tipo] = STATUS[c.status] || [c.status, 'neutro'];
              return (
                <tr key={c.id}>
                  <td>
                    <b>{c.lead_nome || c.contato_nome || (c.phone ? formatarTelefone(c.phone) : 'Contato')}</b>
                    <span className="suave pequeno"> · {c.origem === 'yayforms' ? 'formulário' : c.origem === 'manual' ? 'ligada à mão' : 'WhatsApp'}</span>
                    {c.resumo && <div className="suave pequeno">{c.resumo}</div>}
                    {c.status !== 'ativa' && c.motivo && <div className="pequeno ia-motivo">{c.motivo}</div>}
                  </td>
                  <td><span className={`ia-status ia-status-${tipo}`}>{rotulo}</span>{c.sugestoes_pendentes > 0 && <span className="ia-etiqueta">sugestão pendente</span>}</td>
                  <td className="pequeno suave">{c.mensagens_ia} msg · {tempoDesde(c.atualizada_em)}</td>
                  <td><button type="button" className="btn btn-pequeno" onClick={() => aoAbrir?.(c.lead_id ? `l:${c.lead_id}` : c.chave)}><ExternalLink size={13} /> Abrir</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Conversa de teste: mostra o que a IA responderia com a configuração atual (inclusive playbook não salvo), sem enviar nada
function Simulador({ cfg, admin }) {
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [fora, setFora] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [info, setInfo] = useState('');
  const [situacao, setSituacao] = useState('');
  const [respostas, setRespostas] = useState('');
  const [bruto, setBruto] = useState('');

  const enviar = async (e) => {
    e?.preventDefault();
    const lista = texto.trim() ? [...mensagens, { de: 'lead', texto: texto.trim() }] : mensagens;
    if (!lista.length && !situacao) return;
    setMensagens(lista);
    setTexto('');
    setOcupado(true);
    setInfo('');
    try {
      const r = await api('/ia/simular', { method: 'POST', body: {
        mensagens: lista, fora_do_horario: fora, playbook: cfg.playbook, nome: 'Lead', formulario: situacao ? { situacao, respostas } : null,
        config: { nome_atendente: cfg.nome_atendente, genero_atendente: cfg.genero_atendente, apresentacao: cfg.apresentacao, empresa: cfg.empresa, sobre_empresa: cfg.sobre_empresa },
      } });
      if (r.erro_formato) {
        setInfo(r.motivo || 'A IA respondeu fora do formato. Tente de novo.');
        setBruto(r.bruto || '');
        return;
      }
      setBruto('');
      // Mostra os balões como no WhatsApp: o segundo aparece depois do intervalo configurado, com "digitando…"
      const baloes = (r.mensagens || []).map((t) => ({ de: 'equipe', texto: t }));
      const intervalo = Math.max(0, Number(cfg.intervalo_blocos_seg ?? 2)) * 1000;
      let atual = lista;
      for (const [i, b] of baloes.entries()) {
        if (i > 0 && intervalo) await new Promise((ok) => setTimeout(ok, intervalo));
        atual = [...atual, b];
        setMensagens(atual);
      }
      setInfo([
        r.acao === 'passar_humano' ? `→ passaria para a equipe${r.motivo ? `: ${r.motivo}` : ''}` : null,
        r.filtro && r.filtro !== 'aprovada' ? `⚠ filtro: ${r.filtro} (na vida real não seria enviada)` : null,
        r.via && r.via !== 'modelo' ? r.via : null,
      ].filter(Boolean).join(' · '));
    } catch (err) { setInfo(err.message); } finally { setOcupado(false); }
  };

  return (
    <section className="cartao-secao ia-simulador">
      <div className="dp-secao-topo">
        <h2>Simulador</h2>
        <button type="button" className="btn btn-pequeno" onClick={() => { setMensagens([]); setInfo(''); setBruto(''); }} title="Recomeçar"><RotateCcw size={13} /></button>
      </div>
      <p className="suave pequeno">Escreva como se fosse o lead. Nada é enviado no WhatsApp.</p>
      <label className="dp-check"><input type="checkbox" checked={fora} onChange={(e) => setFora(e.target.checked)} /><span>Simular fora do horário</span></label>
      <div className="ia-sim-form">
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)} aria-label="Formulário do lead">
          <option value="">Lead chamou no WhatsApp (sem formulário)</option>
          <option value="parcial">Formulário parcial</option>
          <option value="completo_sem_reuniao">Formulário completo, sem reunião</option>
          <option value="completo_com_reuniao">Formulário completo, com reunião</option>
        </select>
        {situacao && (
          <textarea rows={4} value={respostas} onChange={(e) => setRespostas(e.target.value)}
            placeholder={'Respostas, uma por linha (Pergunta: resposta)\nAceita o investimento mínimo?: Não\nQuando quer começar?: Imediato\nTem contrato em aberto?: Sim'} />
        )}
        <span className="suave pequeno">Deixe a conversa vazia e clique em enviar para ver a primeira mensagem da IA.</span>
      </div>
      <div className="ia-sim-chat">
        {!mensagens.length && <span className="suave pequeno">Ex.: "Oi, vi o anúncio. Vocês trabalham com rifa?"</span>}
        {mensagens.map((m, i) => <div key={i} className={`ia-sim-msg ${m.de === 'lead' ? 'lead' : 'ia'}`}>{m.texto}</div>)}
        {ocupado && <div className="ia-sim-msg ia digitando">digitando…</div>}
      </div>
      {info && <p className="pequeno ia-sim-info">{info}</p>}
      {bruto && (
        <details className="ia-sim-bruto">
          <summary className="pequeno">Ver o que a IA escreveu</summary>
          <pre className="ia-dir-previa">{bruto}</pre>
        </details>
      )}
      <form className="ia-linha" onSubmit={enviar}>
        <input value={texto} disabled={!admin || !cfg.chave_configurada} placeholder={cfg.chave_configurada ? 'Mensagem do lead…' : 'Configure a chave da API primeiro'} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className="btn btn-ouro" disabled={ocupado || !admin || !cfg.chave_configurada} aria-label="Enviar"><Send size={14} /></button>
      </form>
    </section>
  );
}

// Painel ao vivo da contingência: pausa em andamento e quanto de cada limite já foi usado
function StatusProtecao({ protecao, cfg, admin, aoRetomar }) {
  const [, setTique] = useState(0);
  useEffect(() => { const t = setInterval(() => setTique((x) => x + 1), 15000); return () => clearInterval(t); }, []);
  if (!protecao) return null;
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const noFuturo = (iso) => iso && new Date(iso).getTime() > Date.now();
  const pausa = noFuturo(protecao.pausa_falhas_ate)
    ? { texto: `Pausada até ${hora(protecao.pausa_falhas_ate)} por erros de envio seguidos`, tom: 'erro' }
    : noFuturo(protecao.descanso_ate) ? { texto: `Em pausa de descanso até ${hora(protecao.descanso_ate)}`, tom: 'aviso' } : null;
  const uso = (n, max) => `${n}/${max}`;
  const cheio = (n, max) => (n >= max ? ' ia-protecao-cheio' : '');
  return (
    <div className={`ia-protecao${pausa ? ` ia-protecao-${pausa.tom}` : ''}`}>
      <span className="ia-protecao-estado">
        {pausa ? pausa.texto : 'Atendendo normalmente'}
        {pausa && admin && <button type="button" className="botao-link" onClick={aoRetomar}>Retomar agora</button>}
      </span>
      <span className="ia-protecao-numeros pequeno">
        <span className={cheio(protecao.enviadas_hora, cfg.limite_por_hora)}>Última hora: <b>{uso(protecao.enviadas_hora, cfg.limite_por_hora)}</b></span>
        <span className={cheio(protecao.enviadas_dia, cfg.limite_por_dia)}>24 h: <b>{uso(protecao.enviadas_dia, cfg.limite_por_dia)}</b></span>
        <span className={cheio(protecao.leads_novos_dia, cfg.limite_novos_por_dia)}>Leads novos 24 h: <b>{uso(protecao.leads_novos_dia, cfg.limite_novos_por_dia)}</b></span>
        {cfg.descanso_ativo && !pausa && <span>Próximo descanso em <b>{Math.max(0, cfg.descanso_a_cada - protecao.enviadas_desde_descanso)}</b> msgs</span>}
      </span>
    </div>
  );
}
