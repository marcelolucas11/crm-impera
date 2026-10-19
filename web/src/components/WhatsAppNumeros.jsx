import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatarTelefone, dataHora } from '../utils.js';
import { useEvento } from '../tempoReal.js';
import { CircleCheck } from 'lucide-react';

const STATUS = {
  conectado: ['Conectado', 'ok'],
  aguardando_qr: ['Aguardando leitura do QR code', 'espera'],
  conectando: ['Conectando…', 'espera'],
  reconectando: ['Reconectando…', 'espera'],
  desconectado: ['Desconectado', 'off'],
  erro: ['Erro', 'erro'],
};
const EM_ANDAMENTO = new Set(['aguardando_qr', 'conectando', 'reconectando']);

// Barra de progresso da importação do histórico (atualiza em tempo real pelo evento "importacao")
function ProgressoHistorico({ h, dias }) {
  if (!h) return null;
  const meses = Math.round((dias || 90) / 30);
  if (h.fase === 'recebendo' || h.fase === 'recebido') {
    const pct = typeof h.progresso === 'number' ? h.progresso : null;
    return (
      <div className="progresso-historico">
        <div className="progresso-rotulo">
          <span>{h.fase === 'recebido' ? 'Celular terminou de mandar o histórico' : 'Recebendo o histórico do celular…'}</span>
          <b>{(h.importadas || 0).toLocaleString('pt-BR')} mensagens</b>
        </div>
        {pct !== null && <span className="barra-progresso"><i style={{ width: `${pct}%` }} /></span>}
        {h.mais_antiga && <small className="suave">Mais antiga até agora: {dataHora(h.mais_antiga)}</small>}
      </div>
    );
  }
  if (h.fase === 'completando' || h.fase === 'aguardando_celular') {
    const pct = h.total ? Math.round(((h.feitas || 0) / h.total) * 100) : 0;
    const esperando = h.fase === 'aguardando_celular';
    return (
      <div className="progresso-historico">
        <div className="progresso-rotulo">
          <span>
            {esperando ? '⏸ Esperando o celular responder' : '⟳ Completando'} {meses} meses, conversa por conversa ({h.feitas || 0} de {h.total || 0})
          </span>
          <b>{(h.importadas || 0).toLocaleString('pt-BR')} mensagens</b>
        </div>
        <span className="barra-progresso"><i style={{ width: `${pct}%` }} /></span>
        <small className="suave">
          {esperando
            ? `O celular parou de responder (tela bloqueada ou sem internet). Continua sozinho${h.retoma_em ? ` às ${dataHora(h.retoma_em)}` : ''} — ou na hora, se você abrir o WhatsApp no celular.`
            : 'Roda sozinho, sem precisar clicar. Vai mais rápido com o WhatsApp aberto no celular; se o celular bloquear, a importação espera e continua sozinha.'}
        </small>
      </div>
    );
  }
  if (h.fase === 'concluido') {
    return <p className="suave pequeno numero-historico"><CircleCheck size={14} /> Histórico de {meses} meses importado ({(h.importadas || 0).toLocaleString('pt-BR')} mensagens){h.concluido_em ? ` · ${dataHora(h.concluido_em)}` : ''}.</p>;
  }
  if (h.fase === 'interrompido') {
    return <p className="suave pequeno numero-historico">Importação pausada: {h.erro} Continua sozinha quando o número voltar.</p>;
  }
  return null;
}

export default function WhatsAppNumeros({ aoMensagem, aoErro }) {
  const [numeros, setNumeros] = useState([]);
  const [dias, setDias] = useState(90);
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const d = await api('/whatsapp/numeros');
      setNumeros(d.numeros);
      if (d.historico_dias !== undefined) setDias(d.historico_dias);
    } catch (e) { aoErro(e.message); }
  }, [aoErro]);

  // Progresso da importação chega em tempo real
  useEvento('importacao', (h) => {
    if (!h?.numero) return;
    setNumeros((ns) => ns.map((n) => (n.id === h.numero ? { ...n, historico: h } : n)));
  });
  useEvento('whatsapp', (d) => { if (d?.numeros) carregar(); });

  // Atualiza rápido enquanto algum número está conectando ou mostrando QR
  const andamento = numeros.some((n) => EM_ANDAMENTO.has(n.status));
  useEffect(() => {
    carregar();
    const id = setInterval(carregar, andamento ? 2000 : 10000);
    return () => clearInterval(id);
  }, [carregar, andamento]);

  const acao = async (fn, msg) => {
    setOcupado(true);
    try { await fn(); if (msg) aoMensagem(msg); await carregar(); } catch (e) { aoErro(e.message); } finally { setOcupado(false); }
  };

  const adicionar = (e) => {
    e.preventDefault();
    acao(async () => { await api('/whatsapp/numeros', { method: 'POST', body: { nome: nome || 'WhatsApp' } }); setNome(''); });
  };

  return (
    <section className="cartao-secao">
      <h2>WhatsApp</h2>
      <p className="suave pequeno">
        Conexão por QR code, como o WhatsApp Web. Não é a API oficial: evite disparos em massa e mensagens automáticas,
        porque o WhatsApp pode banir o número. O CRM só envia o que alguém da equipe digita.
      </p>

      {numeros.length === 0 && <p className="suave">Nenhum número conectado ainda.</p>}

      <div className="numeros">
        {numeros.map((n) => {
          const [rotulo, classe] = STATUS[n.status] || [n.status, 'off'];
          return (
            <div key={n.id} className="numero">
              <div className="numero-topo">
                <div>
                  <b>{n.name}</b>
                  {n.phone && <span className="suave"> · {formatarTelefone(n.phone)}</span>}
                </div>
                <span className={`status status-${classe}`}>{rotulo}</span>
              </div>
              {n.erro && <div className="erro pequeno">{n.erro}</div>}
              {n.status === 'conectado' && <ProgressoHistorico h={n.historico} dias={dias} />}
              {n.status === 'conectado' && !n.historico && (
                <p className="suave pequeno numero-historico">
                  Números conectados antes da versão 0.6: clique em <b>Importar {Math.round(dias / 30)} meses de histórico</b> para completar as conversas
                  sem desconectar.
                </p>
              )}

              {n.status === 'aguardando_qr' && n.qr && (
                <div className="qr">
                  <img src={n.qr} alt="QR code para conectar o WhatsApp" width="240" height="240" />
                  <ol className="pequeno">
                    <li>Abra o WhatsApp no celular deste número</li>
                    <li>Toque em <b>Configurações → Aparelhos conectados</b></li>
                    <li>Toque em <b>Conectar um aparelho</b> e aponte para este código</li>
                  </ol>
                </div>
              )}

              <div className="acoes-linha">
                {n.status === 'conectado' && dias > 0 && (
                  <button className="btn btn-pequeno btn-ouro" disabled={ocupado || ['completando', 'aguardando_celular'].includes(n.historico?.fase)}
                    title="Pede ao celular, conversa por conversa, as mensagens que faltam até completar a janela de dias. Não desconecta o número."
                    onClick={() => confirm(
                      `Importar ${Math.round(dias / 30)} meses de histórico de ${n.name}?\n\n`
                      + 'O CRM pede ao celular, uma conversa de cada vez, as mensagens que faltam. Não desconecta o número.\n'
                      + 'Deixe o celular ligado e com internet. Conversas que o CRM nunca recebeu só chegam desconectando e conectando de novo pelo QR code.'
                    ) && acao(() => api(`/whatsapp/numeros/${n.id}/importar-historico`, { method: 'POST' }), 'Importação iniciada. Acompanhe o progresso aqui.')}>
                    {['completando', 'aguardando_celular'].includes(n.historico?.fase) ? 'Importando…' : `Importar ${Math.round(dias / 30)} meses de histórico`}
                  </button>
                )}
                {n.status === 'conectado' && (
                  <button className="btn btn-pequeno" disabled={ocupado}
                    title="Busca de novo as figurinhas favoritas do celular"
                    onClick={() => acao(() => api(`/whatsapp/numeros/${n.id}/figurinhas/sincronizar`, { method: 'POST' }), 'Figurinhas favoritas sincronizadas.')}>
                    Sincronizar figurinhas
                  </button>
                )}
                {['desconectado', 'erro'].includes(n.status) && (
                  <button className="btn btn-pequeno btn-ouro" disabled={ocupado} onClick={() => acao(() => api(`/whatsapp/numeros/${n.id}/conectar`, { method: 'POST' }))}>Conectar</button>
                )}
                {!['desconectado', 'erro'].includes(n.status) && (
                  <button className="btn btn-pequeno" disabled={ocupado}
                    onClick={() => confirm(`Desconectar ${n.name}? Para usar de novo, será preciso ler o QR code.`) && acao(() => api(`/whatsapp/numeros/${n.id}/desconectar`, { method: 'POST' }), 'Número desconectado.')}>
                    Desconectar
                  </button>
                )}
                <button className="btn btn-pequeno" disabled={ocupado}
                  onClick={() => { const novo = prompt('Nome deste número (ex.: Comercial, Suporte):', n.name); if (novo) acao(() => api(`/whatsapp/numeros/${n.id}`, { method: 'PATCH', body: { nome: novo } })); }}>
                  Renomear
                </button>
                <button className="btn btn-pequeno" disabled={ocupado}
                  onClick={() => confirm(`Remover ${n.name} do CRM? As conversas já gravadas continuam nos leads.`) && acao(() => api(`/whatsapp/numeros/${n.id}`, { method: 'DELETE' }), 'Número removido.')}>
                  Remover
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <form className="form-linha form-linha-2" onSubmit={adicionar}>
        <input placeholder="Nome do número (ex.: Comercial)" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} />
        <button className="btn btn-ouro" disabled={ocupado}>+ Conectar novo número</button>
      </form>
    </section>
  );
}
