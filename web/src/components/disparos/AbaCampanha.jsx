// Disparo personalizado: monta o fluxo, escolhe os contatos (listas e/ou seleção), ajusta os timers e dispara
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquareText, Users, Timer, Send, FlaskConical, ShieldAlert, ListChecks, Shuffle, Hash, Coffee, CalendarClock, Smartphone } from 'lucide-react';
import { api } from '../../api.js';
import Modal from '../Modal.jsx';
import ConstrutorFluxo from './ConstrutorFluxo.jsx';
import PreviaWhatsApp from './PreviaWhatsApp.jsx';
import BarraModelos from './BarraModelos.jsx';
import SeletorContatos from './SeletorContatos.jsx';
import { JanelaHorario } from './AbaYayForms.jsx';
import { useAviso, Interruptor, hidratarBlocos } from './comum.jsx';
import { paraEnvio, novoBloco, formatarTelefone, duracaoCurta, novoId } from './texto.js';

const CHAVE_RASCUNHO = 'crm.disparos.rascunho';
const CONFIG_PADRAO = {
  intervalo: { modo: 'aleatorio', fixo: 30, min: 25, max: 60 },
  lote: { ativo: true, contatos: 30, minutos: 5 },
  janela: { ativa: true, inicio: '08:00', fim: '20:00', dias: [1, 2, 3, 4, 5, 6] },
};

function lerRascunho() {
  try {
    const r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || 'null');
    if (r && Array.isArray(r.blocos)) return r;
  } catch { /* sem rascunho */ }
  return null;
}

function Passo({ numero, icone: Icone, titulo, children, extra }) {
  return (
    <section className="cartao-secao dp-passo">
      <div className="dp-secao-topo">
        <h2><span className="dp-passo-num">{numero}</span><Icone size={17} /> {titulo}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export default function AbaCampanha({ numeros, modeloInicial, aoConsumirModelo, listaInicial, aoConsumirLista, aoIniciar }) {
  const aviso = useAviso();
  const rascunho = useRef(lerRascunho()).current;
  const [nome, setNome] = useState(rascunho?.nome || '');
  const [blocos, setBlocos] = useState(() => rascunho?.blocos?.length ? rascunho.blocos : [novoBloco('texto', true)]);
  const [config, setConfig] = useState(() => ({ ...CONFIG_PADRAO, ...(rascunho?.config || {}) }));
  const [numeroId, setNumeroId] = useState(rascunho?.numeroId || '');
  const [listas, setListas] = useState([]);
  const [listasEscolhidas, setListasEscolhidas] = useState(new Set());
  const [selecionados, setSelecionados] = useState(new Map());
  const [mostrarSeletor, setMostrarSeletor] = useState(false);
  const [variaveis, setVariaveis] = useState({});
  const [teste, setTeste] = useState('');
  const [testando, setTestando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api('/disparos/listas').then((d) => setListas(d.listas)).catch(() => {});
    api('/disparos/variaveis').then((d) => setVariaveis(d.variaveis)).catch(() => {});
    // Rascunho com arquivos: completa nome/tamanho
    if (rascunho?.blocos?.some((b) => b.midia_id && !b.midia)) hidratarBlocos(rascunho.blocos, api).then(setBlocos);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Modelo escolhido no Monitor ("Usar numa campanha")
  useEffect(() => {
    if (!modeloInicial) return;
    hidratarBlocos(modeloInicial.blocos, api).then((b) => {
      setBlocos(b.map((x) => ({ ...x, id: novoId() })));
      aviso(`Modelo “${modeloInicial.nome}” carregado`);
      aoConsumirModelo?.();
    });
  }, [modeloInicial]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Disparar para esta lista" (aba Listas)
  useEffect(() => {
    if (!listaInicial) return;
    setListasEscolhidas(new Set([listaInicial.id]));
    aviso(`Público “${listaInicial.nome}” escolhido como destino`, 'info');
    aoConsumirLista?.();
  }, [listaInicial]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guarda o rascunho no navegador
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ nome, blocos, config, numeroId })); } catch { /* sem armazenamento */ }
    }, 400);
    return () => clearTimeout(t);
  }, [nome, blocos, config, numeroId]);

  const conectados = numeros.filter((n) => n.status === 'conectado');
  useEffect(() => {
    if (!numeroId && conectados.length === 1) setNumeroId(String(conectados[0].id));
  }, [conectados.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalListas = useMemo(() => listas.filter((l) => listasEscolhidas.has(l.id)).reduce((a, l) => a + l.total, 0), [listas, listasEscolhidas]);
  const estimativa = selecionados.size + totalListas; // antes de tirar repetidos e bloqueados

  const tempoPorContato = blocos.reduce((a, b) => a + (b.espera?.segundos || 0), 0) + blocos.length * 2;
  const intervaloMedio = config.intervalo.modo === 'fixo' ? config.intervalo.fixo : (config.intervalo.min + config.intervalo.max) / 2;
  const descansos = config.lote.ativo ? Math.floor(Math.max(0, estimativa - 1) / config.lote.contatos) * config.lote.minutos * 60 : 0;
  const tempoTotal = estimativa ? estimativa * tempoPorContato + Math.max(0, estimativa - 1) * intervaloMedio + descansos : 0;

  const mudarIntervalo = (p) => setConfig((c) => ({ ...c, intervalo: { ...c.intervalo, ...p } }));
  const mudarLote = (p) => setConfig((c) => ({ ...c, lote: { ...c.lote, ...p } }));

  const validar = () => {
    if (!blocos.length) return 'Monte pelo menos um bloco de mensagem';
    const vazio = blocos.findIndex((b) => (b.tipo === 'texto' ? !b.texto.trim() : !(b.midia_id || b.midia)));
    if (vazio >= 0) return `O bloco ${vazio + 1} está vazio`;
    if (!numeroId) return 'Escolha o número de WhatsApp que vai enviar';
    return null;
  };

  const enviarTeste = async () => {
    const erro = validar();
    if (erro) { aviso(erro, 'erro'); return; }
    if (!teste.trim()) { aviso('Digite o número para o teste', 'erro'); return; }
    setTestando(true);
    try {
      await api('/disparos/teste', { method: 'POST', body: { numero_id: Number(numeroId), telefone: teste, blocos: paraEnvio(blocos) } });
      aviso(`Teste a caminho de ${teste} — acompanhe no Monitor`);
    } catch (e) { aviso(e.message, 'erro'); } finally { setTestando(false); }
  };

  const abrirConfirmacao = () => {
    const erro = validar();
    if (erro) { aviso(erro, 'erro'); return; }
    if (!estimativa) { aviso('Escolha uma lista ou selecione contatos', 'erro'); return; }
    setConfirmando(true);
  };

  const disparar = async () => {
    setEnviando(true);
    try {
      const r = await api('/disparos/campanhas', {
        method: 'POST',
        body: {
          nome,
          numero_id: Number(numeroId),
          blocos: paraEnvio(blocos),
          config,
          destinatarios: {
            listas: [...listasEscolhidas],
            contatos: [...selecionados.values()].map((c) => ({ telefone: c.telefone, lead_id: c.lead_id, nome: c.nome })),
          },
        },
      });
      const extras = [r.repetidos && `${r.repetidos} repetido(s)`, r.bloqueados && `${r.bloqueados} bloqueado(s)`, r.invalidos && `${r.invalidos} inválido(s)`].filter(Boolean);
      aviso(`Disparo iniciado para ${r.total} contato(s)${extras.length ? ` — fora: ${extras.join(', ')}` : ''}`);
      setConfirmando(false);
      setSelecionados(new Map());
      setListasEscolhidas(new Set());
      setNome('');
      aoIniciar?.(r.id);
    } catch (e) { aviso(e.message, 'erro'); } finally { setEnviando(false); }
  };

  const numeroEscolhido = numeros.find((n) => String(n.id) === String(numeroId));

  return (
    <div className="dp-aba">
      <div className="dp-grade">
        <div className="dp-coluna-principal">
          <Passo numero={1} icone={MessageSquareText} titulo="Mensagens" extra={<BarraModelos blocos={blocos} setBlocos={setBlocos} />}>
            <label>Nome da campanha (só para você)
              <input placeholder={`Campanha ${new Date().toLocaleDateString('pt-BR')}`} value={nome} onChange={(e) => setNome(e.target.value)} />
            </label>
            <ConstrutorFluxo blocos={blocos} setBlocos={setBlocos} variaveis={variaveis} />
          </Passo>

          <Passo numero={2} icone={Users} titulo="Para quem">
            {listas.length > 0 && (
              <div className="dp-escolha-listas">
                <span className="dp-config-titulo"><ListChecks size={15} /> Públicos e listas salvas</span>
                <div className="dp-listas-chips">
                  {listas.map((l) => (
                    <button key={l.id} type="button" className={`chip chip-pequeno ${listasEscolhidas.has(l.id) ? 'ativo' : ''}`}
                      onClick={() => { const s = new Set(listasEscolhidas); if (s.has(l.id)) s.delete(l.id); else s.add(l.id); setListasEscolhidas(s); }}>
                      {l.nome} <small>{l.total}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="dp-escolha-contatos">
              <span className="dp-config-titulo"><Users size={15} /> Contatos avulsos {selecionados.size > 0 && <b className="dp-contador">{selecionados.size}</b>}</span>
              <button type="button" className="btn btn-pequeno" onClick={() => setMostrarSeletor(!mostrarSeletor)}>{mostrarSeletor ? 'Fechar seletor' : 'Escolher contatos do kanban e do WhatsApp'}</button>
            </div>
            {mostrarSeletor && <SeletorContatos selecionados={selecionados} aoMudar={setSelecionados} altura={420} />}
            <p className="suave pequeno">Números repetidos entre listas e seleção entram uma vez só; números da lista de bloqueio são pulados.</p>
          </Passo>

          <Passo numero={3} icone={Timer} titulo="Timers e segurança">
            <div className="dp-aviso-ban">
              <ShieldAlert size={18} />
              <span>O WhatsApp conectado por QR code não é oficial e pode bloquear números que disparam em massa. Use intervalos aleatórios,
                descanso por lote e só fale com quem espera sua mensagem. Comece com poucos contatos por dia.</span>
            </div>
            <div className="dp-config-grade">
              <div className="dp-config-item">
                <span className="dp-config-titulo"><Smartphone size={15} /> Número que envia</span>
                <select value={numeroId} onChange={(e) => setNumeroId(e.target.value)}>
                  <option value="">Escolha…</option>
                  {numeros.map((n) => <option key={n.id} value={n.id}>{n.name}{n.phone ? ` · ${formatarTelefone(n.phone)}` : ''}{n.status !== 'conectado' ? ' (desconectado)' : ''}</option>)}
                </select>
                {numeroEscolhido && numeroEscolhido.status !== 'conectado' && <span className="alerta pequeno">Desconectado: a fila espera reconectar.</span>}
              </div>
              <div className="dp-config-item">
                <span className="dp-config-titulo"><Shuffle size={15} /> Tempo entre um contato e o próximo</span>
                <div className="dp-segmentos dp-segmentos-pequeno">
                  <button type="button" className={config.intervalo.modo === 'aleatorio' ? 'ativo' : ''} onClick={() => mudarIntervalo({ modo: 'aleatorio' })}><Shuffle size={12} /> Aleatório (anti-ban)</button>
                  <button type="button" className={config.intervalo.modo === 'fixo' ? 'ativo' : ''} onClick={() => mudarIntervalo({ modo: 'fixo' })}><Hash size={12} /> Fixo</button>
                </div>
                {config.intervalo.modo === 'fixo' ? (
                  <div className="dp-linha-campos"><input type="number" min={3} value={config.intervalo.fixo} onChange={(e) => mudarIntervalo({ fixo: Number(e.target.value) })} /><span className="suave pequeno">segundos</span></div>
                ) : (
                  <div className="dp-linha-campos">
                    <label>Entre<input type="number" min={3} value={config.intervalo.min} onChange={(e) => mudarIntervalo({ min: Number(e.target.value) })} /></label>
                    <label>e<input type="number" min={3} value={config.intervalo.max} onChange={(e) => mudarIntervalo({ max: Number(e.target.value) })} /></label>
                    <span className="suave pequeno">segundos (sorteado a cada contato)</span>
                  </div>
                )}
              </div>
              <div className="dp-config-item">
                <span className="dp-config-titulo"><Coffee size={15} /> Lote de segurança</span>
                <Interruptor ligado={config.lote.ativo} aoMudar={(ativo) => mudarLote({ ativo })} rotulo="Descansar de tempos em tempos" />
                {config.lote.ativo && (
                  <div className="dp-linha-campos">
                    <label>A cada<input type="number" min={1} value={config.lote.contatos} onChange={(e) => mudarLote({ contatos: Number(e.target.value) })} /></label>
                    <label>contatos, pausar<input type="number" min={1} value={config.lote.minutos} onChange={(e) => mudarLote({ minutos: Number(e.target.value) })} /></label>
                    <span className="suave pequeno">minutos</span>
                  </div>
                )}
              </div>
              <div className="dp-config-item">
                <span className="dp-config-titulo"><CalendarClock size={15} /> Janela de horário</span>
                <JanelaHorario janela={config.janela} aoMudar={(janela) => setConfig((c) => ({ ...c, janela }))} />
              </div>
            </div>
          </Passo>
        </div>

        <aside className="dp-coluna-previa">
          <PreviaWhatsApp blocos={blocos} variaveis={variaveis} nome={variaveis.nome || 'Contato'} />
          <div className="dp-teste">
            <span className="dp-config-titulo"><FlaskConical size={15} /> Enviar teste</span>
            <div className="dp-manual">
              <input placeholder="Seu número com DDD" value={teste} onChange={(e) => setTeste(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviarTeste()} />
              <button type="button" className="btn btn-pequeno" disabled={testando} onClick={enviarTeste}><Send size={13} /> {testando ? 'Enviando…' : 'Enviar teste'}</button>
            </div>
            <span className="suave pequeno">Manda o fluxo agora, com as esperas, para conferir mídias e variáveis.</span>
          </div>
        </aside>
      </div>

      <div className="dp-rodape-fixo visivel">
        <span>
          <b>{estimativa}</b> contato(s){estimativa ? ` · tempo estimado ~${duracaoCurta(tempoTotal)}` : ''}
          {config.janela.ativa ? ` · só ${config.janela.inicio}–${config.janela.fim}` : ''}
        </span>
        <button className="btn btn-ouro" onClick={abrirConfirmacao}><Send size={14} /> Revisar e disparar</button>
      </div>

      {confirmando && (
        <Modal titulo="Confirmar disparo" onFechar={() => setConfirmando(false)}>
          <div className="painel-corpo">
            <ul className="dp-resumo">
              <li><b>{estimativa}</b> contato(s) selecionado(s){listasEscolhidas.size ? ` (incluindo ${listasEscolhidas.size} lista(s))` : ''} — repetidos e bloqueados saem automaticamente</li>
              <li><b>{blocos.length}</b> bloco(s) por contato · ~{duracaoCurta(tempoPorContato)} por contato</li>
              <li>{config.intervalo.modo === 'fixo' ? `${config.intervalo.fixo}s` : `${config.intervalo.min}–${config.intervalo.max}s (aleatório)`} entre contatos
                {config.lote.ativo ? ` · pausa de ${config.lote.minutos} min a cada ${config.lote.contatos}` : ''}</li>
              <li>Pelo número <b>{numeroEscolhido?.name}</b>{config.janela.ativa ? `, só das ${config.janela.inicio} às ${config.janela.fim}` : ''}</li>
              <li>Tempo estimado: <b>~{duracaoCurta(tempoTotal)}</b></li>
            </ul>
            <p className="suave pequeno">A fila roda no servidor: pode trocar de tela ou fechar o navegador. Acompanhe, pause ou cancele no Monitor.</p>
            <div className="acoes">
              <button className="btn" onClick={() => setConfirmando(false)}>Voltar</button>
              <span className="espaco" />
              <button className="btn btn-ouro" disabled={enviando} onClick={disparar}><Send size={14} /> {enviando ? 'Iniciando…' : 'Iniciar disparo'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
