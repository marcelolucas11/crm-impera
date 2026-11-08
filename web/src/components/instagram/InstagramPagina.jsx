// Aba Instagram: Direct (como o WhatsApp, com a Alice), Comentários, Desempenho, Relatórios da IA e Ajustes.
// Cada parte aparece só para quem tem a permissão dela (o servidor confere de novo).
import { Component, useCallback, useEffect, useState } from 'react';
import { MessageCircle, MessagesSquare, BarChart3, FileText, Settings, Camera as IconeInstagram } from 'lucide-react';
import { api } from '../../api.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento } from '../../tempoReal.js';
import { pode } from '../../permissoes.js';
import { ProvedorAvisos } from '../disparos/comum.jsx';
import Direct from './Direct.jsx';
import Comentarios from './Comentarios.jsx';
import Desempenho from './Desempenho.jsx';
import Relatorios from './Relatorios.jsx';
import Ajustes from './Ajustes.jsx';
import '../disparos/disparos.css';
import '../estatisticas/estatisticas.css';
import './instagram.css';

const ler = (k, padrao) => { try { return localStorage.getItem(k) || padrao; } catch { return padrao; } };
const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

export default function InstagramPagina(props) {
  return <ProvedorAvisos><Conteudo {...props} /></ProvedorAvisos>;
}

// Se uma parte da tela do Instagram quebrar, só ela mostra o aviso (o resto do CRM continua)
class Protecao extends Component {
  constructor(props) { super(props); this.state = { erro: null }; }
  static getDerivedStateFromError(erro) { return { erro }; }
  componentDidCatch(erro) { console.error('[instagram] tela:', erro); }
  componentDidUpdate(anteriores) { if (anteriores.chave !== this.props.chave && this.state.erro) this.setState({ erro: null }); }
  render() {
    if (!this.state.erro) return this.props.children;
    const { t } = this.props;
    return (
      <div className="pagina">
        <div className="cartao-secao ig-erro-tela">
          <b>{t('instagram.erroTela.titulo')}</b>
          <p className="suave">{t('instagram.erroTela.texto')}</p>
          <code>{String(this.state.erro?.message || this.state.erro).slice(0, 200)}</code>
          <button type="button" className="btn btn-ouro" onClick={() => this.setState({ erro: null })}>{t('instagram.erroTela.tentar')}</button>
        </div>
      </div>
    );
  }
}

function Conteudo({ user, stages, users, horas, aoMudarAlgo, setErro, aoAbrirConversa }) {
  const t = useT();
  const [estado, setEstado] = useState(null);
  const admin = user.role === 'admin';

  const abas = [
    pode(user, 'instagram') && { id: 'direct', icone: MessageCircle },
    pode(user, 'instagram_comentarios') && estado?.comentarios_ativo && { id: 'comentarios', icone: MessagesSquare },
    pode(user, 'instagram_desempenho') && { id: 'desempenho', icone: BarChart3 },
    pode(user, 'instagram_desempenho') && { id: 'relatorios', icone: FileText },
    admin && { id: 'ajustes', icone: Settings },
  ].filter(Boolean);
  const [aba, setAbaEstado] = useState(() => ler('crm.igAba', 'direct'));
  const abaAtual = abas.some((a) => a.id === aba) ? aba : abas[0]?.id;
  const setAba = (a) => { setAbaEstado(a); gravar('crm.igAba', a); };

  const carregar = useCallback(() => api('/instagram/estado').then(setEstado).catch((e) => setErro?.(e.message)), [setErro]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('instagram', (d) => { if (d?.perfis || d?.comentarios || d?.reconectou || d?.conexao) carregar(); });

  // "Abrir conversa" vindo de outra tela (ficha do lead, aviso da Alice, assistente pessoal)
  useEffect(() => {
    const ir = () => { if (window.__igAbrir) setAba('direct'); };
    ir();
    window.addEventListener('ig-abrir', ir);
    return () => window.removeEventListener('ig-abrir', ir);
  }, []);

  if (!estado) return <div className="tela-cheia"><div className="carregando" /></div>;

  const semPerfis = !estado.perfis.length;
  return (
    <div className="ig-pagina">
      <div className="ig-subtopo">
        <div className="segmentado" role="tablist" aria-label={t('instagram.titulo')}>
          {abas.map((a) => (
            <button key={a.id} role="tab" aria-selected={abaAtual === a.id} className={abaAtual === a.id ? 'ativo' : ''} onClick={() => setAba(a.id)}>
              <a.icone size={14} /> {t(`instagram.aba.${a.id}`)}
              {a.id === 'direct' && estado.nao_lidas > 0 && <span className="ig-bolinha">{estado.nao_lidas}</span>}
              {a.id === 'comentarios' && estado.comentarios > 0 && <span className="ig-bolinha">{estado.comentarios}</span>}
            </button>
          ))}
        </div>
        <span className="espaco" />
        <span className="ig-perfis-mini">
          {estado.perfis.map((p) => <span key={p.id} className="tag" title={p.nome || ''}><IconeInstagram size={11} /> @{p.username}</span>)}
        </span>
      </div>

      {semPerfis && abaAtual !== 'ajustes' ? (
        <div className="pagina">
          <div className="dp-vazio">
            <IconeInstagram size={34} strokeWidth={1.4} />
            <b>{t('instagram.semPerfis.titulo')}</b>
            <span>{admin ? t('instagram.semPerfis.admin') : t('instagram.semPerfis.membro')}</span>
          </div>
        </div>
      ) : (
        <Protecao chave={abaAtual} t={t}>
          {abaAtual === 'direct' && <Direct user={user} stages={stages} users={users} horas={horas} perfis={estado.perfis} aoMudarAlgo={aoMudarAlgo} aoAbrirConversa={aoAbrirConversa} />}
          {abaAtual === 'comentarios' && <Comentarios user={user} perfis={estado.perfis} />}
          {abaAtual === 'desempenho' && <Desempenho user={user} perfis={estado.perfis} />}
          {abaAtual === 'relatorios' && <Relatorios user={user} perfis={estado.perfis} modelos={estado.modelos} modeloPadrao={estado.relatorio_modelo} />}
          {abaAtual === 'ajustes' && <Ajustes perfis={estado.perfis} aoMudar={carregar} />}
        </Protecao>
      )}
    </div>
  );
}
