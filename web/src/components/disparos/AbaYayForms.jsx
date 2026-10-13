// Automação Yay! Forms: quando chega um lead novo, o CRM manda a sequência de boas-vindas no WhatsApp dele
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap, Save, ScanSearch, Clock, ShieldCheck, Smartphone, CalendarClock, MousePointerClick } from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { dataHora } from '../../utils.js';
import Modal from '../Modal.jsx';
import ConstrutorFluxo from './ConstrutorFluxo.jsx';
import PreviaWhatsApp from './PreviaWhatsApp.jsx';
import BarraModelos from './BarraModelos.jsx';
import { useAviso, Interruptor, hidratarBlocos } from './comum.jsx';
import { paraEnvio, novoBloco, formatarTelefone } from './texto.js';
import { useRelogio, frasesAoVivo } from './AbaMonitor.jsx';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function JanelaHorario({ janela, aoMudar, texto = 'Só enviar dentro do horário' }) {
  return (
    <div className="dp-janela">
      <Interruptor ligado={janela.ativa} aoMudar={(ativa) => aoMudar({ ...janela, ativa })} rotulo={texto} />
      {janela.ativa && (
        <div className="dp-janela-campos">
          <label>Das<input type="time" value={janela.inicio} onChange={(e) => aoMudar({ ...janela, inicio: e.target.value })} /></label>
          <label>às<input type="time" value={janela.fim} onChange={(e) => aoMudar({ ...janela, fim: e.target.value })} /></label>
          <div className="dp-dias" role="group" aria-label="Dias da semana">
            {DIAS.map((d, i) => (
              <button key={d} type="button" className={janela.dias.includes(i) ? 'ativo' : ''}
                onClick={() => aoMudar({ ...janela, dias: janela.dias.includes(i) ? janela.dias.filter((x) => x !== i) : [...janela.dias, i].sort() })}>{d}</button>
            ))}
          </div>
          <span className="suave pequeno">Fora do horário, a fila espera e continua sozinha quando abrir.</span>
        </div>
      )}
    </div>
  );
}

function Inspetor({ dados, aoFechar, aoInserir }) {
  return (
    <Modal titulo="Último envio recebido do Yay! Forms" onFechar={aoFechar} largo>
      <div className="painel-corpo dp-inspetor">
        {!dados?.recebido_em ? (
          <p className="suave">Nenhum webhook recebido ainda. Envie uma resposta de teste no formulário e abra de novo.</p>
        ) : (
          <>
            <p className="suave pequeno">Recebido em {dataHora(dados.recebido_em)}{dados.lead_id ? ` · lead #${dados.lead_id}` : ''}. Clique num campo para colocá-lo na mensagem.</p>
            <div className="dp-insp-identificados">
              <span><b>Nome:</b> {dados.identificados?.nome || '—'}</span>
              <span><b>Telefone:</b> {dados.identificados?.telefone ? formatarTelefone(dados.identificados.telefone) : <span className="alerta">não identificado</span>}</span>
              <span><b>E-mail:</b> {dados.identificados?.email || '—'}</span>
            </div>
            <h4>Variáveis padrão</h4>
            <div className="dp-insp-chips">
              {dados.padroes.map((p) => <button key={p.variavel} type="button" className="dp-chip-var" onClick={() => aoInserir(p.variavel)}>{`{{${p.variavel}}}`}</button>)}
            </div>
            <h4>Campos deste formulário</h4>
            {!dados.campos.length ? <p className="suave">O payload não trouxe respostas.</p> : (
              <table className="tabela dp-insp-tabela">
                <thead><tr><th>Campo</th><th>Valor recebido</th><th>Variável</th></tr></thead>
                <tbody>
                  {dados.campos.map((c) => (
                    <tr key={c.variavel} onClick={() => aoInserir(c.variavel)} className="clicavel" title="Clique para inserir na mensagem">
                      <td><small className="suave">{c.origem}</small><br />{c.rotulo}</td>
                      <td className="dp-insp-valor">{c.valor}</td>
                      <td><span className="dp-chip-var dp-chip-var-form"><MousePointerClick size={11} /> {`{{${c.variavel}}}`}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <details className="tabela-dados">
              <summary>Ver payload bruto (JSON)</summary>
              <pre className="dp-json">{JSON.stringify(dados.bruto, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function AbaYayForms({ numeros }) {
  const aviso = useAviso();
  const [cfg, setCfg] = useState(null);
  const [blocos, setBlocos] = useState([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [campanhaId, setCampanhaId] = useState(null);
  const [payload, setPayload] = useState(null);
  const [inspecionando, setInspecionando] = useState(false);
  const [exemplo, setExemplo] = useState({ variaveis: {} });
  const [salvando, setSalvando] = useState(false);
  const [alterado, setAlterado] = useState(false);
  const [estado, setEstado] = useState(null);
  const agora = useRelogio();

  const carregarEstado = useCallback(async (id) => {
    if (!id) return;
    try { setEstado(await api(`/disparos/campanhas/${id}`)); } catch { /* sem estado */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [d, p, v] = await Promise.all([api('/disparos/yayforms'), api('/disparos/yayforms/payload'), api('/disparos/variaveis')]);
        setCfg(d.config);
        setBlocos(await hidratarBlocos(d.config.blocos, api));
        setPodeEditar(d.pode_editar);
        setCampanhaId(d.campanha_id);
        setPayload(p);
        setExemplo(v);
        carregarEstado(d.campanha_id);
      } catch (e) { aviso(e.message, 'erro'); }
    })();
  }, [aviso, carregarEstado]);

  useEvento('disparos', (d) => { if (!d?.campanha || d.campanha === campanhaId) carregarEstado(campanhaId); });

  const mudar = (p) => { setCfg((c) => ({ ...c, ...p })); setAlterado(true); };
  const mudarBlocos = (b) => { setBlocos(typeof b === 'function' ? b(blocos) : b); setAlterado(true); };

  const salvar = async (extra = {}) => {
    setSalvando(true);
    try {
      const d = await api('/disparos/yayforms', { method: 'PUT', body: { ...cfg, ...extra, blocos: paraEnvio(blocos) } });
      setCfg(d.config);
      setAlterado(false);
      aviso(extra.ativo === undefined ? 'Automação salva' : extra.ativo ? 'Saudação automática ligada' : 'Saudação automática desligada', extra.ativo === false ? 'info' : 'ok');
      carregarEstado(campanhaId);
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };

  const extras = useMemo(() => payload?.campos || [], [payload]);
  const variaveisPrevia = useMemo(() => {
    const v = { ...exemplo.variaveis };
    for (const c of payload?.campos || []) if (!(c.variavel in v)) v[c.variavel] = c.valor;
    return v;
  }, [exemplo, payload]);

  const inserirVariavel = (nome) => {
    const marca = `{{${nome}}}`;
    const idx = [...blocos].reverse().findIndex((b) => b.tipo === 'texto');
    if (idx === -1) {
      mudarBlocos([...blocos, { ...novoBloco('texto', !blocos.length), texto: marca }]);
    } else {
      const i = blocos.length - 1 - idx;
      mudarBlocos(blocos.map((b, j) => (j === i ? { ...b, texto: `${b.texto}${b.texto && !/\s$/.test(b.texto) ? ' ' : ''}${marca}` } : b)));
    }
    aviso(`${marca} adicionado ao último bloco de texto`, 'info');
  };

  if (!cfg) return <div className="dp-centro"><div className="carregando" /></div>;
  const camp = estado?.campanha;
  const conectados = numeros.filter((n) => n.status === 'conectado');
  const recentes = (estado?.itens || []).slice(0, 6);

  return (
    <div className="dp-aba">
      <section className={`dp-mestre ${cfg.ativo ? 'ligada' : ''}`}>
        <div className="dp-mestre-icone"><Zap size={22} /></div>
        <div className="dp-mestre-texto">
          <h2>Saudação imediata para novos leads do Yay! Forms</h2>
          <p className="suave">Assim que um lead novo chega pelo formulário, o CRM espera alguns segundos e manda a sequência abaixo no WhatsApp dele.</p>
          {camp && <p className="dp-mestre-status">{frasesAoVivo(camp, agora) || 'Desligada.'} {camp.contagem.enviado ? `· ${camp.contagem.enviado} saudação(ões) enviada(s)` : ''}</p>}
        </div>
        <Interruptor grande ligado={cfg.ativo} disabled={!podeEditar || salvando} aoMudar={(ativo) => salvar({ ativo })} rotulo={cfg.ativo ? 'Ligada' : 'Desligada'} />
      </section>
      {!podeEditar && <div className="dp-dica-admin">Só administradores alteram a automação. Você pode ver como ela está configurada.</div>}

      <div className="dp-grade">
        <div className="dp-coluna-principal">
          <section className="cartao-secao">
            <div className="dp-secao-topo">
              <h2>Mensagens de boas-vindas</h2>
              <div className="acoes">
                <button type="button" className="btn btn-pequeno" onClick={() => setInspecionando(true)}><ScanSearch size={13} /> Inspecionar último payload</button>
                <BarraModelos blocos={blocos} setBlocos={mudarBlocos} />
              </div>
            </div>
            <ConstrutorFluxo blocos={blocos} setBlocos={mudarBlocos} variaveis={variaveisPrevia} extras={extras}
              rotuloPrimeiro="Depois do atraso inicial: aguardar" />
          </section>

          <section className="cartao-secao">
            <h2>Quando e para quem</h2>
            <div className="dp-config-grade">
              <div className="dp-config-item">
                <span className="dp-config-titulo"><Clock size={15} /> Atraso antes da 1ª mensagem</span>
                <div className="dp-linha-campos">
                  <label>De<input type="number" min={0} max={3600} value={cfg.atraso_min} onChange={(e) => mudar({ atraso_min: Number(e.target.value) })} /></label>
                  <label>até<input type="number" min={0} max={3600} value={cfg.atraso_max} onChange={(e) => mudar({ atraso_max: Number(e.target.value) })} /></label>
                  <span className="suave pequeno">segundos (sorteado a cada lead)</span>
                </div>
              </div>
              <div className="dp-config-item">
                <span className="dp-config-titulo"><Smartphone size={15} /> Número que envia</span>
                <select value={cfg.numero_id || ''} onChange={(e) => mudar({ numero_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Qualquer número conectado</option>
                  {numeros.map((n) => <option key={n.id} value={n.id}>{n.nome || n.name}{n.telefone || n.phone ? ` · ${formatarTelefone(n.telefone || n.phone)}` : ''}{n.status !== 'conectado' ? ' (desconectado)' : ''}</option>)}
                </select>
                {!conectados.length && <span className="alerta pequeno">Nenhum número conectado agora: as saudações esperam na fila.</span>}
              </div>
              <div className="dp-config-item">
                <span className="dp-config-titulo"><ShieldCheck size={15} /> Proteção contra repetição</span>
                <label className="dp-check">
                  <input type="checkbox" checked={cfg.nao_repetir_horas > 0} onChange={(e) => mudar({ nao_repetir_horas: e.target.checked ? 24 : 0 })} />
                  <span>Não mandar de novo para quem recebeu nas últimas
                    <input className="dp-inline-num" type="number" min={1} value={cfg.nao_repetir_horas || 24} disabled={!cfg.nao_repetir_horas} onChange={(e) => mudar({ nao_repetir_horas: Number(e.target.value) })} /> horas</span>
                </label>
                <label className="dp-check">
                  <input type="checkbox" checked={cfg.pular_se_conversa} onChange={(e) => mudar({ pular_se_conversa: e.target.checked })} />
                  <span>Pular se já houve conversa no WhatsApp nas últimas
                    <input className="dp-inline-num" type="number" min={1} value={cfg.conversa_horas} disabled={!cfg.pular_se_conversa} onChange={(e) => mudar({ conversa_horas: Number(e.target.value) })} /> horas</span>
                </label>
                <label className="dp-check">
                  <input type="checkbox" checked={cfg.apenas_completas} onChange={(e) => mudar({ apenas_completas: e.target.checked })} />
                  <span>Só para quem terminou o formulário (respostas incompletas esperam a pessoa terminar)</span>
                </label>
              </div>
              <div className="dp-config-item">
                <span className="dp-config-titulo"><CalendarClock size={15} /> Horário permitido</span>
                <JanelaHorario janela={cfg.janela} aoMudar={(janela) => mudar({ janela })} />
              </div>
            </div>
          </section>

          {recentes.length > 0 && (
            <section className="cartao-secao">
              <h2>Últimos disparos da automação</h2>
              <table className="tabela">
                <tbody>
                  {recentes.map((it) => (
                    <tr key={it.id}>
                      <td><b>{it.nome || '—'}</b> <span className="suave pequeno">{it.phone !== '-' ? formatarTelefone(it.phone) : ''}</span></td>
                      <td><span className={`dp-status dp-status-${it.status}`}>{{ pendente: 'Agendado', enviando: 'Enviando', enviado: 'Enviado', falha: 'Falha', pulado: 'Pulado', cancelado: 'Cancelado' }[it.status]}</span></td>
                      <td className="pequeno suave">{it.erro || dataHora(it.enviado_em || it.agendado_para)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>

        <aside className="dp-coluna-previa">
          <PreviaWhatsApp blocos={blocos} variaveis={variaveisPrevia} nome={variaveisPrevia.nome || 'Lead'} atrasoInicial={Math.round((Number(cfg.atraso_min) + Number(cfg.atraso_max)) / 2)} />
          <p className="suave pequeno">Prévia com os dados do lead mais recente do Yay! Forms.</p>
        </aside>
      </div>

      {podeEditar && alterado && (
        <div className="dp-rodape-fixo visivel">
          <span>Há alterações não salvas</span>
          <button className="btn btn-ouro" disabled={salvando || !alterado} onClick={() => salvar()}><Save size={14} /> {salvando ? 'Salvando…' : 'Salvar automação'}</button>
        </div>
      )}

      {inspecionando && <Inspetor dados={payload} aoFechar={() => setInspecionando(false)} aoInserir={(v) => { inserirVariavel(v); }} />}
    </div>
  );
}
