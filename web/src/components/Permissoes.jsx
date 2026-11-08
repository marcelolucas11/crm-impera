// Permissões de uma pessoa da equipe: quais telas e funções do CRM ela usa (Equipe e integrações → Permissões)
import { useEffect, useState } from 'react';
import { ShieldCheck, LayoutGrid, Wrench } from 'lucide-react';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';
import Modal from './Modal.jsx';

export default function Permissoes({ usuario, onFechar, onSalvo }) {
  const t = useT();
  const [lista, setLista] = useState([]);
  const [marcadas, setMarcadas] = useState(() => ({ ...(usuario.permissoes || {}) }));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => { api('/users/permissoes').then((d) => setLista(d.permissoes)).catch((e) => setErro(e.message)); }, []);

  const alternar = (chave) => setMarcadas((m) => ({ ...m, [chave]: !m[chave] }));
  const padrao = () => setMarcadas(Object.fromEntries(lista.map((p) => [p.chave, p.padrao])));
  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      const d = await api(`/users/${usuario.id}`, { method: 'PATCH', body: { permissoes: marcadas } });
      onSalvo?.(d.user);
      onFechar();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };

  const grupo = (id, Icone) => (
    <div className="perm-grupo">
      <b className="perm-titulo"><Icone size={15} /> {t(`equipe.permissoes.grupo.${id}`)}</b>
      {lista.filter((p) => p.grupo === id).map((p) => (
        <label key={p.chave} className={`perm-item ${marcadas[p.chave] ? 'ligada' : ''}`}>
          <input type="checkbox" checked={Boolean(marcadas[p.chave])} onChange={() => alternar(p.chave)} />
          <span className="perm-textos">
            <span className="perm-nome">{t(`equipe.permissoes.${p.chave}`)}</span>
            <small className="suave">{t(`equipe.permissoes.${p.chave}.dica`)}</small>
          </span>
        </label>
      ))}
    </div>
  );

  return (
    <Modal titulo={t('equipe.permissoes.titulo', { nome: usuario.name })} onFechar={onFechar} largo>
      <div className="perm-corpo">
        <p className="suave pequeno"><ShieldCheck size={14} /> {t('equipe.permissoes.explica')}</p>
        {usuario.role === 'admin' ? (
          <p className="sucesso">{t('equipe.permissoes.admin')}</p>
        ) : (
          <div className="perm-colunas">
            {grupo('telas', LayoutGrid)}
            {grupo('funcoes', Wrench)}
          </div>
        )}
        {erro && <div className="erro">{erro}</div>}
        {usuario.role !== 'admin' && (
          <div className="acoes-linha">
            <button type="button" className="btn" onClick={padrao} disabled={!lista.length}>{t('equipe.permissoes.padrao')}</button>
            <button type="button" className="btn btn-ouro" onClick={salvar} disabled={salvando || !lista.length}>{salvando ? t('equipe.permissoes.salvando') : t('equipe.permissoes.salvar')}</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
