// Fila da IA: leads da janela de "lead novo" que chegaram antes de a IA ligar e ninguém da equipe chamou.
// A equipe revisa a lista, desmarca quem não quer e manda o resto para a IA, que atende no ritmo das travas de proteção.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Inbox, Send } from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde, formatarTelefone } from '../../utils.js';
import Modal from '../Modal.jsx';
import { useAviso } from '../disparos/comum.jsx';

const ORIGEM = { yayforms: 'Yay! Forms', whatsapp: 'WhatsApp', calendly: 'Calendly', manual: 'Manual' };

export default function FilaPendentes({ admin, alterado }) {
  const aviso = useAviso();
  const [dados, setDados] = useState(null);
  const [aberta, setAberta] = useState(false);
  const [marcados, setMarcados] = useState(new Set());
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => api('/ia/fila').then(setDados).catch(() => {}), []);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('ia', () => { if (!aberta) carregar(); });

  const leads = dados?.leads || [];
  const abrir = async () => {
    const d = await api('/ia/fila').catch((e) => { aviso(e.message, 'erro'); return null; });
    if (!d) return;
    setDados(d);
    // Lead criado à mão sem mensagem dele começa desmarcado: pode ser alguém que você já conhece por fora do CRM
    setMarcados(new Set(d.leads.filter((l) => !(l.origem === 'manual' && !l.mensagens_do_lead)).map((l) => l.lead_id)));
    setAberta(true);
  };

  const alternar = (id) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todos = marcados.size === leads.length && leads.length > 0;
  const dias = useMemo(() => Math.ceil(marcados.size / Math.max(1, dados?.limite_novos_por_dia || 20)), [marcados, dados]);

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await api('/ia/fila', { method: 'POST', body: { lead_ids: [...marcados] } });
      aviso(`${r.enfileirados} lead(s) entregues para a IA`);
      setAberta(false);
      carregar();
    } catch (e) { aviso(e.message, 'erro'); } finally { setEnviando(false); }
  };

  if (!dados) return null;
  return (
    <>
      <div className="ia-fila-faixa">
        <Inbox size={15} />
        <span className="pequeno">
          {leads.length
            ? <><b>{leads.length}</b> lead(s) das últimas {dados.janela_horas} h ainda sem nenhuma mensagem da equipe e fora do atendimento da IA.</>
            : <>Nenhum lead das últimas {dados.janela_horas} h esperando resposta.</>}
        </span>
        {admin && leads.length > 0 && (
          <button type="button" className="btn btn-pequeno btn-ouro" disabled={alterado || !dados.ativo} onClick={abrir}
            title={alterado ? 'Salve as alterações antes' : !dados.ativo ? 'Ligue a IA antes' : ''}>
            Revisar e mandar para a IA
          </button>
        )}
      </div>
      {aberta && createPortal(
        <Modal titulo={`Leads sem resposta — últimas ${dados.janela_horas} h`} onFechar={() => setAberta(false)} largo>
          <p className="pequeno suave">
            A IA atende os marcados, dos mais novos para os mais antigos, respeitando as travas de proteção
            (um por vez, intervalo entre leads, no máximo {dados.limite_novos_por_dia} leads novos em 24 h).
            A primeira mensagem só sai dentro do horário comercial. Se você ou alguém da equipe responder antes, a IA não entra.
          </p>
          <label className="dp-check ia-fila-todos">
            <input type="checkbox" checked={todos} onChange={() => setMarcados(todos ? new Set() : new Set(leads.map((l) => l.lead_id)))} />
            <span>Marcar todos ({leads.length})</span>
          </label>
          <div className="ia-fila-lista">
            {leads.map((l) => (
              <label key={l.lead_id} className="ia-fila-item">
                <input type="checkbox" checked={marcados.has(l.lead_id)} onChange={() => alternar(l.lead_id)} />
                <span className="ia-fila-nome">{l.nome || 'Sem nome'}<span className="suave pequeno"> · {formatarTelefone(l.phone)}</span></span>
                <span className="pequeno suave">{ORIGEM[l.origem] || l.origem} · chegou {tempoDesde(l.criado_em)}</span>
                <span className="pequeno">{l.mensagens_do_lead ? `Escreveu ${l.mensagens_do_lead}x, sem resposta` : 'A IA manda a 1ª mensagem'}</span>
              </label>
            ))}
          </div>
          <div className="ia-dir-rodape">
            <span className="pequeno suave">
              {marcados.size} marcado(s){marcados.size > (dados.limite_novos_por_dia || 20) ? ` · pelo limite diário, leva cerca de ${dias} dias` : ''}
            </span>
            <span className="ia-dir-acoes">
              <button type="button" className="btn btn-pequeno" onClick={() => setAberta(false)}>Cancelar</button>
              <button type="button" className="btn btn-ouro" disabled={enviando || !marcados.size} onClick={enviar}>
                <Send size={14} /> {enviando ? 'Enviando…' : `Mandar ${marcados.size} para a IA`}
              </button>
            </span>
          </div>
        </Modal>,
        document.body
      )}
    </>
  );
}
