import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatarTelefone } from '../utils.js';

const STATUS = {
  conectado: ['Conectado', 'ok'],
  aguardando_qr: ['Aguardando leitura do QR code', 'espera'],
  conectando: ['Conectando…', 'espera'],
  reconectando: ['Reconectando…', 'espera'],
  desconectado: ['Desconectado', 'off'],
  erro: ['Erro', 'erro'],
};
const EM_ANDAMENTO = new Set(['aguardando_qr', 'conectando', 'reconectando']);

export default function WhatsAppNumeros({ aoMensagem, aoErro }) {
  const [numeros, setNumeros] = useState([]);
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setNumeros((await api('/whatsapp/numeros')).numeros);
    } catch (e) { aoErro(e.message); }
  }, [aoErro]);

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
