// Cérebro da assistente (mesmo molde da IA de primeiro contato):
//  1) Contexto do CRM — o prompt que ela escreve lendo o CRM inteiro (editável, com versões e melhoria automática)
//  2) Diretrizes — textos que você escreve ou sobe de arquivo
//  3) Memória — fatos curtos que ela leva em conta em tudo
import { useCallback, useEffect, useState } from 'react';
import { Brain, Sparkles, Wand2, Save, History, BookMarked, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { api } from '../../../api.js';
import { useEvento } from '../../../tempoReal.js';
import { useT } from '../../../i18n/index.jsx';
import { useAviso } from '../../disparos/comum.jsx';
import DiretrizesIa from '../DiretrizesIa.jsx';
import { dinheiro, rotuloModelo, dataHoraCurta } from './comum.js';

export default function Cerebro({ user, dados, aoMudar }) {
  const t = useT();
  return (
    <div className="ag-cerebro">
      <Contexto user={user} dados={dados} aoMudar={aoMudar} />
      <DiretrizesIa admin base="/agente/diretrizes" evento="agente" titulo={t('ia.agente.cerebro.diretrizesTitulo')}
        descricao={t('ia.agente.cerebro.diretrizesTexto', { nome: dados.config.nome })} />
      <Memoria nome={dados.config.nome} />
    </div>
  );
}

function Contexto({ user, dados, aoMudar }) {
  const t = useT();
  const aviso = useAviso();
  const [c, setC] = useState(null);
  const [texto, setTexto] = useState('');
  const [alterado, setAlterado] = useState(false);
  const [dias, setDias] = useState(60);
  const [modelo, setModelo] = useState(dados.config.modelo_contexto);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const d = await api('/agente/cerebro');
      setC(d);
      setTexto((atual) => (alterado ? atual : d.contexto));
    } catch (e) { aviso(e.message, 'erro'); }
  }, [aviso, alterado]);
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEvento('agente', (d) => { if ((!d?.usuario || d.usuario === user.id) && (d?.contexto || d?.reconectou)) carregar(); });

  const tarefa = c?.tarefa;
  const rodando = tarefa?.status === 'rodando';
  useEffect(() => {
    if (!rodando) return undefined;
    const id = setInterval(carregar, 5000);
    return () => clearInterval(id);
  }, [rodando, carregar]);

  // Terminou: mostra o texto novo (se não houver edição não salva)
  useEffect(() => {
    if (tarefa?.status === 'ok' && !alterado && c) setTexto(c.contexto);
    if (tarefa?.status === 'erro') aviso(tarefa.erro, 'erro');
    if (tarefa?.status === 'ok' || tarefa?.status === 'erro') api('/agente/cerebro/tarefa', { method: 'DELETE' }).catch(() => {});
  }, [tarefa?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const rodar = async (tipo) => {
    if (alterado && !confirm(t('ia.agente.cerebro.confirmarDescartar'))) return;
    if (tipo === 'gerar' && c?.contexto?.trim() && !confirm(t('ia.agente.cerebro.confirmarRefazer'))) return;
    try {
      await api(`/agente/cerebro/${tipo}`, { method: 'POST', body: { dias, modelo } });
      setAlterado(false);
      carregar();
    } catch (e) { aviso(e.message, 'erro'); }
  };

  const salvar = async () => {
    setSalvando(true);
    try { await api('/agente/cerebro', { method: 'PUT', body: { contexto: texto } }); setAlterado(false); aviso(t('ia.agente.cerebro.salvo')); carregar(); aoMudar?.(); } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };

  const voltarVersao = async (id) => {
    if (!id) return;
    try { const { versao } = await api(`/agente/cerebro/versoes/${id}`); setTexto(versao.texto); setAlterado(true); aviso(t('ia.agente.cerebro.versaoCarregada'), 'info'); } catch (e) { aviso(e.message, 'erro'); }
  };

  const mudarAuto = async (p) => {
    try { await api('/agente/config', { method: 'PUT', body: p }); aoMudar?.(); } catch (e) { aviso(e.message, 'erro'); }
  };

  if (!c) return <section className="cartao-secao"><div className="carregando" /></section>;
  const cfg = dados.config;

  return (
    <section className="cartao-secao">
      <div className="dp-secao-topo">
        <h2><Brain size={16} /> {t('ia.agente.cerebro.titulo')}</h2>
        {c.contexto_atualizado_em && <span className="suave pequeno">{t('ia.agente.cerebro.atualizado', { quando: dataHoraCurta(c.contexto_atualizado_em), origem: t(`ia.agente.cerebro.origem.${c.contexto_origem || 'manual'}`) })}</span>}
      </div>
      <p className="suave pequeno">{t('ia.agente.cerebro.explicacao', { nome: cfg.nome })}</p>

      <div className="ia-playbook-acoes">
        <div className="ia-campos-2">
          <label>{t('ia.agente.cerebro.modelo')}
            <select value={modelo} disabled={rodando} onChange={(e) => setModelo(e.target.value)}>
              {dados.modelos.map((m) => <option key={m.id} value={m.id}>{rotuloModelo(m)}</option>)}
            </select>
          </label>
          <label>{t('ia.agente.cerebro.dias')}
            <input type="number" min={7} max={180} value={dias} disabled={rodando} onChange={(e) => setDias(Number(e.target.value) || 60)} />
          </label>
        </div>
        <div className="ia-playbook-botoes">
          <button type="button" className="btn btn-ouro" disabled={rodando || !cfg.chave_configurada} onClick={() => rodar('gerar')}><Sparkles size={14} /> {t('ia.agente.cerebro.gerar', { dias })}</button>
          <button type="button" className="btn" disabled={rodando || !cfg.chave_configurada || !c.contexto?.trim()} onClick={() => rodar('melhorar')}><Wand2 size={14} /> {t('ia.agente.cerebro.melhorar')}</button>
        </div>
        <span className="suave pequeno">
          {t('ia.agente.cerebro.estimativa', { mensagens: c.estimativa.mensagens.toLocaleString('pt-BR'), grupos: c.estimativa.grupos, dias: c.estimativa.dias, custo: dinheiro(c.estimativa.custo_estimado) })}
          {c.contexto_lido_ate ? ` ${t('ia.agente.cerebro.lidoAte', { quando: dataHoraCurta(c.contexto_lido_ate) })}` : ''}
        </span>
      </div>

      {rodando && (
        <div className="ia-playbook-tarefa">
          <div className="carregando" />
          <span>{t(tarefa.tipo === 'melhorar' ? 'ia.agente.cerebro.rodandoMelhorar' : 'ia.agente.cerebro.rodandoGerar', { modelo: tarefa.modelo })}</span>
        </div>
      )}

      <textarea rows={20} value={texto} disabled={rodando} placeholder={t('ia.agente.cerebro.vazio')}
        onChange={(e) => { setTexto(e.target.value); setAlterado(true); }} />

      <div className="ia-playbook-rodape">
        <label className="dp-check">
          <input type="checkbox" checked={Boolean(cfg.contexto_auto)} disabled={!c.contexto?.trim()} onChange={(e) => mudarAuto({ contexto_auto: e.target.checked })} />
          <span>{t('ia.agente.cerebro.auto1')}{' '}
            <input type="number" min={1} max={60} className="ia-dias" value={cfg.contexto_auto_dias} onChange={(e) => mudarAuto({ contexto_auto_dias: e.target.value })} />{' '}
            {t('ia.agente.cerebro.auto2')}</span>
        </label>
        <span className="ag-linha-acoes">
          {c.versoes?.length > 0 && (
            <span className="ag-versoes"><History size={13} />
              <select value="" onChange={(e) => voltarVersao(Number(e.target.value))}>
                <option value="">{t('ia.agente.cerebro.versoes')}</option>
                {c.versoes.map((v) => <option key={v.id} value={v.id}>{dataHoraCurta(v.created_at)} · {t(`ia.agente.cerebro.origem.${v.origem || 'manual'}`)} · {v.tamanho.toLocaleString('pt-BR')}</option>)}
              </select>
            </span>
          )}
          <span className="suave pequeno">{t('ia.agente.cerebro.tamanho', { n: texto.length.toLocaleString('pt-BR'), max: c.limite.toLocaleString('pt-BR') })}</span>
          <button type="button" className="btn btn-ouro" disabled={!alterado || salvando || rodando} onClick={salvar}><Save size={14} /> {t('ia.agente.salvar')}</button>
        </span>
      </div>
    </section>
  );
}

function Memoria({ nome }) {
  const t = useT();
  const aviso = useAviso();
  const [lista, setLista] = useState(null);
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState(null);
  const carregar = useCallback(() => api('/agente/memoria').then((d) => setLista(d.memoria)).catch((e) => aviso(e.message, 'erro')), [aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('agente', (d) => { if (d?.acoes) carregar(); });

  const fazer = async (caminho, metodo, corpo) => {
    try { setLista((await api(caminho, { method: metodo, body: corpo })).memoria); return true; } catch (e) { aviso(e.message, 'erro'); return false; }
  };

  return (
    <section className="cartao-secao">
      <h2><BookMarked size={16} /> {t('ia.agente.memoria.titulo')}</h2>
      <p className="suave pequeno">{t('ia.agente.memoria.explicacao', { nome })}</p>
      <form className="ag-memoria-nova" onSubmit={async (e) => { e.preventDefault(); if (novo.trim() && await fazer('/agente/memoria', 'POST', { texto: novo })) setNovo(''); }}>
        <input value={novo} maxLength={500} placeholder={t('ia.agente.memoria.placeholder')} onChange={(e) => setNovo(e.target.value)} />
        <button type="submit" className="btn btn-pequeno btn-ouro" disabled={!novo.trim()}><Plus size={13} /> {t('ia.agente.memoria.adicionar')}</button>
      </form>
      {!lista ? <div className="carregando" /> : !lista.length ? <div className="vazio">{t('ia.agente.memoria.vazia')}</div> : (
        <ul className="ag-memoria">
          {lista.map((m) => (
            <li key={m.id}>
              {editando?.id === m.id ? (
                <form className="ag-memoria-nova" onSubmit={async (e) => { e.preventDefault(); if (await fazer(`/agente/memoria/${m.id}`, 'PUT', { texto: editando.texto })) setEditando(null); }}>
                  <input autoFocus value={editando.texto} maxLength={500} onChange={(e) => setEditando({ ...editando, texto: e.target.value })} />
                  <button type="submit" className="btn btn-pequeno"><Check size={13} /></button>
                  <button type="button" className="btn btn-pequeno" onClick={() => setEditando(null)}><X size={13} /></button>
                </form>
              ) : (
                <>
                  <span>{m.texto}{m.origem === 'alice' && <span className="ia-etiqueta">{t('ia.agente.memoria.sugerida')}</span>}</span>
                  <span className="ag-linha-acoes">
                    <button type="button" className="btn btn-pequeno" onClick={() => setEditando({ id: m.id, texto: m.texto })} aria-label={t('ia.agente.editar')}><Pencil size={12} /></button>
                    <button type="button" className="btn btn-pequeno" onClick={() => confirm(t('ia.agente.memoria.confirmarApagar')) && fazer(`/agente/memoria/${m.id}`, 'DELETE')} aria-label={t('ia.agente.apagar')}><Trash2 size={12} /></button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
