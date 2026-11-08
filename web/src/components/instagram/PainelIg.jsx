// Painel à direita do Direct: quem é a pessoa no Instagram, o que a Alice já descobriu na entrevista,
// "Transformar em lead" (com WhatsApp opcional) e, quando já é lead, a ficha completa do kanban.
import { useCallback, useEffect, useState } from 'react';
import { X, ExternalLink, BadgeCheck, Megaphone, Camera as IconeInstagram, Sparkles, UserPlus, Play } from 'lucide-react';
import { api } from '../../api.js';
import { rota } from '../../base.js';
import { useT } from '../../i18n/index.jsx';
import { useEvento, avisoTem } from '../../tempoReal.js';
import { pode } from '../../permissoes.js';
import { dataHora } from '../../utils.js';
import LeadFicha from '../LeadFicha.jsx';
import { FotoContato, nomeDaConversa, numero } from './comum.jsx';

const CAMPOS_ENTREVISTA = ['nome', 'nicho', 'experiencia', 'anuncia', 'objetivo', 'quando_comecar', 'telefone', 'observacoes'];

function Entrevista({ conversaId, t }) {
  const [ia, setIa] = useState(null);
  const carregar = useCallback(() => api(`/instagram/conversas/${conversaId}/ia`).then(setIa).catch(() => {}), [conversaId]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('instagram', (d) => { if (avisoTem(d, 'conversa', conversaId) && d.ia) carregar(); });
  const dados = ia?.dados || {};
  const preenchidos = CAMPOS_ENTREVISTA.filter((k) => dados[k]);
  if (!ia?.status && !preenchidos.length) return null;
  return (
    <div className="dados-bloco">
      <b className="dados-titulo"><Sparkles size={14} /> {t('instagram.painel.entrevista')}</b>
      {ia.eh_lead !== null && ia.eh_lead !== undefined && (
        <span className={`tag ${ia.eh_lead ? 'tag-ia' : ''}`}>{ia.eh_lead ? t('instagram.painel.ehLead') : t('instagram.painel.naoEhLead')}</span>
      )}
      {preenchidos.length ? (
        <dl className="respostas">
          {preenchidos.map((k) => <div key={k}><dt>{t(`instagram.painel.campo.${k}`)}</dt><dd>{dados[k]}</dd></div>)}
        </dl>
      ) : <p className="suave pequeno">{t('instagram.painel.entrevistaVazia')}</p>}
    </div>
  );
}

function TransformarEmLead({ conversa, onFeito, t }) {
  const [telefone, setTelefone] = useState('');
  const [nome, setNome] = useState(conversa.nome || '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const criar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    setErro('');
    try {
      await api(`/instagram/conversas/${conversa.id}/lead`, { method: 'POST', body: { telefone: telefone.trim() || null, nome: nome.trim() || null } });
      onFeito?.();
    } catch (err) { setErro(err.message); } finally { setOcupado(false); }
  };
  return (
    <form className="dados-bloco" onSubmit={criar}>
      <p className="pequeno">{t('instagram.painel.virarLeadTexto')}</p>
      <label className="pequeno">{t('instagram.painel.nome')}
        <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder={conversa.username ? `@${conversa.username}` : ''} />
      </label>
      <label className="pequeno">{t('instagram.painel.whatsapp')}
        <input value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" maxLength={30} placeholder={t('instagram.painel.whatsappExemplo')} />
      </label>
      <button className="btn btn-ouro" disabled={ocupado}><UserPlus size={15} /> {ocupado ? t('instagram.painel.criando') : t('instagram.painel.virarLead')}</button>
      <p className="suave pequeno">{t('instagram.painel.virarLeadDica')}</p>
      {erro && <div className="erro pequeno">{erro}</div>}
    </form>
  );
}

export default function PainelIg({ conversa, user, stages, users, horas, onFechar, onAtualizado }) {
  const t = useT();
  const [dados, setDados] = useState(null);
  const carregar = useCallback(() => api(`/instagram/conversas/${conversa.id}/contato`).then(setDados).catch(() => {}), [conversa.id]);
  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  useEvento('instagram', (d) => { if (avisoTem(d, 'conversa', conversa.id) || d?.contato) carregar(); });

  const k = dados?.contato;
  const c = dados?.conversa || conversa;
  const podeCriarLead = pode(user, 'leads_editar');
  const aposMudar = () => { carregar(); onAtualizado?.(); };

  return (
    <aside className="ficha-lateral ig-painel">
      <div className="painel-lateral-topo">
        <button type="button" className="botao-icone" onClick={onFechar} aria-label={t('instagram.painel.fechar')}><X size={20} /></button>
        <b>{c.lead_id ? t('instagram.painel.tituloLead') : t('instagram.painel.tituloContato')}</b>
      </div>
      <div className="painel-lateral-corpo">
        <div className="dados-contato">
          <div className="dados-topo">
            <FotoContato conversa={c} tamanho={c.lead_id ? 96 : 140} />
            <h3>{nomeDaConversa(c)} {k?.verificado && <BadgeCheck size={18} className="ig-verificado" />}</h3>
            {c.username && <p className="suave">@{c.username}</p>}
            <p className="suave pequeno">
              {k?.seguidores !== null && k?.seguidores !== undefined ? t('instagram.painel.seguidores', { n: numero(k.seguidores) }) : ''}
              {k?.segue_perfil !== null && k?.segue_perfil !== undefined ? ` · ${k.segue_perfil ? t('instagram.painel.segueVoce') : t('instagram.painel.naoSegue')}` : ''}
            </p>
            <p className="suave pequeno"><IconeInstagram size={12} /> {t('instagram.painel.noPerfil', { perfil: c.perfil_username })}</p>
            {c.anuncio_id && <span className="tag"><Megaphone size={11} /> {t('instagram.painel.veioDoAnuncio', { titulo: c.anuncio_titulo || t('instagram.chat.anuncioSemTitulo') })}</span>}
          </div>

          {!c.lead_id && podeCriarLead && <TransformarEmLead conversa={c} onFeito={aposMudar} t={t} />}
          {!c.lead_id && !podeCriarLead && <p className="dados-bloco suave pequeno">{t('instagram.painel.semPermissaoLead')}</p>}

          <Entrevista conversaId={c.id} t={t} />

          {dados?.midias?.length > 0 && (
            <div className="dados-bloco">
              <b className="dados-titulo">{t('instagram.painel.midias', { n: dados.midias.length })}</b>
              <div className="grade-midias">
                {dados.midias.flatMap((m) => [
                  ...(m.story ? [{ chave: `${m.id}-s`, src: rota(`/api/instagram/midia/${m.id}/story`), tipo: 'story' }] : []),
                  ...m.anexos.filter((a) => a.pronto && ['imagem', 'video', 'post', 'reel'].includes(a.tipo)).map((a) => ({ chave: `${m.id}-${a.indice}`, src: rota(`/api/instagram/midia/${m.id}/${a.indice}`), tipo: a.tipo })),
                ]).slice(0, 18).map((x) => (
                  <a key={x.chave} href={x.src} target="_blank" rel="noreferrer" title={x.tipo}>
                    {x.tipo === 'video' || x.tipo === 'reel'
                      ? <><video src={`${x.src}#t=0.5`} preload="metadata" muted playsInline /><span className="grade-video"><Play size={18} fill="currentColor" /></span></>
                      : <img src={x.src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                  </a>
                ))}
              </div>
            </div>
          )}

          <p className="dados-bloco suave pequeno">
            {t('instagram.painel.totalMensagens', { n: dados?.total_mensagens ?? '…' })}
            {k?.atualizado_em ? ` · ${t('instagram.painel.atualizado', { quando: dataHora(k.atualizado_em) })}` : ''}
          </p>
          {c.username && (
            <a className="dados-link" href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {t('instagram.painel.abrirPerfil')}</a>
          )}
        </div>

        {c.lead_id && (
          <LeadFicha key={c.lead_id} leadId={c.lead_id} stages={stages} users={users} user={user} horas={horas} onAtualizado={onAtualizado} dentroDoDirect />
        )}
      </div>
    </aside>
  );
}
