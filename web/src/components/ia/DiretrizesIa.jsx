// Diretrizes da IA: textos (prompts) que dão o norte para a IA de primeiro contato.
// Cria do zero, cola ou sobe um arquivo (.md / .txt), lê e edita aqui mesmo, liga/desliga, ordena e volta versões anteriores.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenText, Plus, Upload, ChevronUp, ChevronDown, History, Download, Trash2, Save, FileText } from 'lucide-react';
import { api } from '../../api.js';
import { useEvento } from '../../tempoReal.js';
import { tempoDesde } from '../../utils.js';
import Modal from '../Modal.jsx';
import { useAviso, Interruptor } from '../disparos/comum.jsx';

const EXTENSOES = '.md,.markdown,.txt,text/plain,text/markdown';
const numero = (n) => new Intl.NumberFormat('pt-BR').format(n || 0);
// Português: ~4 caracteres por token (só para ter noção do custo)
const tokens = (caracteres) => `~${numero(Math.ceil((caracteres || 0) / 4))} tokens`;
// Título: o primeiro "# Título" do arquivo; se não tiver, o nome do arquivo
function tituloDoArquivo(nome, texto = '') {
  const cabecalho = String(texto).match(/^\s*#{1,2}\s+(.+?)\s*#*\s*$/m)?.[1];
  if (cabecalho) return cabecalho.slice(0, 120);
  const base = nome.replace(/\.(md|markdown|txt)$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 120);
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Diretriz';
}

export default function DiretrizesIa({ admin }) {
  const aviso = useAviso();
  const [lista, setLista] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [aberta, setAberta] = useState(null); // { id?, titulo, conteudo, ativa, arquivo? } | null
  const arquivoRef = useRef(null);

  const carregar = useCallback(() => api('/ia/diretrizes').then((d) => { setLista(d.diretrizes); setResumo(d.resumo); }).catch((e) => aviso(e.message, 'erro')), [aviso]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento('ia', (d) => { if (d?.diretrizes || d?.reconectou) carregar(); });

  const alternar = async (dir, ativa) => {
    try {
      const r = await api(`/ia/diretrizes/${dir.id}`, { method: 'PUT', body: { ativa } });
      setLista((l) => l.map((x) => (x.id === dir.id ? r.diretriz : x)));
      setResumo(r.resumo);
    } catch (e) { aviso(e.message, 'erro'); }
  };

  const mover = async (indice, passo) => {
    const nova = [...lista];
    const [item] = nova.splice(indice, 1);
    nova.splice(indice + passo, 0, item);
    setLista(nova);
    try { setLista((await api('/ia/diretrizes/ordem', { method: 'PUT', body: { ids: nova.map((x) => x.id) } })).diretrizes); } catch (e) { aviso(e.message, 'erro'); carregar(); }
  };

  const subirArquivos = async (e) => {
    const arquivos = [...(e.target.files || [])];
    e.target.value = '';
    if (!arquivos.length) return;
    const lidos = [];
    for (const f of arquivos) {
      if (f.size > 400 * 1024) { aviso(`"${f.name}" é grande demais (máx. 400 KB).`, 'erro'); continue; }
      lidos.push({ nome: f.name, texto: await f.text() });
    }
    // Um arquivo: abre para revisar antes de salvar. Vários: salva todos de uma vez
    if (lidos.length === 1) {
      setAberta({ titulo: tituloDoArquivo(lidos[0].nome, lidos[0].texto), conteudo: lidos[0].texto, ativa: true, arquivo: lidos[0].nome });
      return;
    }
    let ok = 0;
    for (const l of lidos) {
      try {
        await api('/ia/diretrizes', { method: 'POST', body: { titulo: tituloDoArquivo(l.nome, l.texto), conteudo: l.texto, arquivo: l.nome } });
        ok++;
      } catch (err) { aviso(`${l.nome}: ${err.message}`, 'erro'); }
    }
    if (ok) aviso(`${ok} diretriz(es) adicionada(s)`);
    carregar();
  };

  const aoSalvar = (r) => {
    setLista((l) => (l.some((x) => x.id === r.diretriz.id) ? l.map((x) => (x.id === r.diretriz.id ? r.diretriz : x)) : [...l, r.diretriz]));
    if (r.resumo) setResumo(r.resumo);
  };
  const aoApagar = (id, r) => { setLista((l) => l.filter((x) => x.id !== id)); if (r?.resumo) setResumo(r.resumo); };

  return (
    <section className="cartao-secao">
      <div className="dp-secao-topo">
        <h2><BookOpenText size={16} /> Diretrizes (prompts)</h2>
        {admin && (
          <div className="ia-dir-botoes">
            <button type="button" className="btn btn-pequeno" onClick={() => arquivoRef.current?.click()}><Upload size={13} /> Subir arquivo</button>
            <button type="button" className="btn btn-pequeno btn-ouro" onClick={() => setAberta({ titulo: '', conteudo: '', ativa: true })}><Plus size={13} /> Nova</button>
            <input ref={arquivoRef} type="file" accept={EXTENSOES} multiple hidden onChange={subirArquivos} />
          </div>
        )}
      </div>
      <p className="suave pequeno">
        Textos que dão o norte para a IA: roteiro de SDR, como tratar cada tipo de lead, respostas para dúvidas frequentes. As ativas entram no prompt
        na ordem abaixo, junto com as respostas do formulário do lead. As regras de segurança e o formato de resposta do sistema sempre valem por cima.
      </p>
      {resumo && (
        <p className="pequeno ia-dir-resumo">
          {resumo.ativas} ativa(s) · {numero(resumo.caracteres_ativos)} de {numero(resumo.limite_caracteres_ativos)} caracteres ({tokens(resumo.caracteres_ativos)})
        </p>
      )}

      {!lista ? <div className="carregando" /> : !lista.length ? (
        <div className="vazio">Nenhuma diretriz ainda. {admin ? 'Crie uma, cole um texto ou suba um arquivo .md ou .txt.' : ''}</div>
      ) : (
        <ul className="ia-dir-lista">
          {lista.map((dir, i) => (
            <li key={dir.id} className={`ia-dir-item ${dir.ativa ? '' : 'inativa'}`}>
              <Interruptor ligado={dir.ativa} disabled={!admin} aoMudar={(v) => alternar(dir, v)} />
              <button type="button" className="ia-dir-abrir" onClick={() => setAberta(dir)}>
                <b>{dir.titulo}</b>
                <span className="suave pequeno">
                  {numero(dir.caracteres)} caracteres · editada {tempoDesde(dir.atualizada_em)}{dir.atualizada_por_nome ? ` por ${dir.atualizada_por_nome}` : ''}
                  {dir.arquivo ? <> · <FileText size={11} /> {dir.arquivo}</> : null}
                  {dir.versoes ? ` · ${dir.versoes} versão(ões) anterior(es)` : ''}
                </span>
              </button>
              {admin && lista.length > 1 && (
                <span className="ia-dir-ordem">
                  <button type="button" className="btn btn-pequeno" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir"><ChevronUp size={13} /></button>
                  <button type="button" className="btn btn-pequeno" disabled={i === lista.length - 1} onClick={() => mover(i, 1)} aria-label="Descer"><ChevronDown size={13} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Fora do cartão: o efeito de vidro dos cartões prenderia a janela dentro da seção */}
      {aberta && createPortal(
        <EditorDiretriz inicial={aberta} admin={admin} aoFechar={() => setAberta(null)} aoSalvar={aoSalvar} aoApagar={aoApagar} />,
        document.body
      )}
    </section>
  );
}

function EditorDiretriz({ inicial, admin, aoFechar, aoSalvar, aoApagar }) {
  const aviso = useAviso();
  const [id, setId] = useState(inicial.id || null);
  const [titulo, setTitulo] = useState(inicial.titulo || '');
  const [conteudo, setConteudo] = useState(inicial.conteudo || '');
  const [base, setBase] = useState({ titulo: inicial.id ? inicial.titulo : null, conteudo: inicial.id ? inicial.conteudo : null });
  const [salvando, setSalvando] = useState(false);
  const [versoes, setVersoes] = useState(null);
  const [vendo, setVendo] = useState(null);
  const limite = 40000;
  const alterado = !id || titulo !== base.titulo || conteudo !== base.conteudo;

  const fechar = useCallback(() => {
    if (admin && alterado && (titulo.trim() || conteudo.trim()) && !confirm('Descartar as alterações não salvas?')) return;
    aoFechar();
  }, [admin, alterado, titulo, conteudo, aoFechar]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = id
        ? await api(`/ia/diretrizes/${id}`, { method: 'PUT', body: { titulo, conteudo } })
        : await api('/ia/diretrizes', { method: 'POST', body: { titulo, conteudo, ativa: inicial.ativa ?? true, arquivo: inicial.arquivo } });
      setId(r.diretriz.id);
      setTitulo(r.diretriz.titulo);
      setConteudo(r.diretriz.conteudo);
      setBase({ titulo: r.diretriz.titulo, conteudo: r.diretriz.conteudo });
      setVersoes(null);
      aoSalvar(r);
      aviso('Diretriz salva. A IA já usa a nova versão na próxima resposta.');
    } catch (e) { aviso(e.message, 'erro'); } finally { setSalvando(false); }
  };

  const apagar = async () => {
    if (!confirm(`Apagar a diretriz "${titulo}"? Esta ação não pode ser desfeita.`)) return;
    try {
      const r = await api(`/ia/diretrizes/${id}`, { method: 'DELETE' });
      aoApagar(id, r);
      aviso('Diretriz apagada', 'info');
      aoFechar();
    } catch (e) { aviso(e.message, 'erro'); }
  };

  const abrirHistorico = async () => {
    if (versoes) { setVersoes(null); setVendo(null); return; }
    try { setVersoes((await api(`/ia/diretrizes/${id}/versoes`)).versoes); } catch (e) { aviso(e.message, 'erro'); }
  };

  const restaurar = async (v) => {
    if (alterado && !confirm('Você tem alterações não salvas que serão perdidas. Restaurar mesmo assim?')) return;
    try {
      const r = await api(`/ia/diretrizes/${id}/versoes/${v.id}/restaurar`, { method: 'POST' });
      setTitulo(r.diretriz.titulo);
      setConteudo(r.diretriz.conteudo);
      setBase({ titulo: r.diretriz.titulo, conteudo: r.diretriz.conteudo });
      setVersoes(null);
      setVendo(null);
      aoSalvar(r);
      aviso('Versão restaurada (a anterior ficou guardada no histórico)');
    } catch (e) { aviso(e.message, 'erro'); }
  };

  const baixar = () => {
    const blob = new Blob([conteudo], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(titulo || 'diretriz').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || 'diretriz'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Modal titulo={id ? (admin ? 'Editar diretriz' : 'Diretriz') : 'Nova diretriz'} onFechar={fechar} largo>
      <div className="ia-dir-editor">
        <label>Título
          <input value={titulo} maxLength={120} disabled={!admin} placeholder="Ex.: Roteiro SDR — primeiro contato" onChange={(e) => setTitulo(e.target.value)} />
        </label>
        <label>Texto (o que a IA deve seguir)
          <textarea className="ia-dir-texto" rows={22} value={conteudo} readOnly={!admin} spellCheck={false}
            placeholder={'Escreva ou cole aqui. Pode usar Markdown (## títulos, - listas, tabelas).\n\nEx.:\n## Lead que preencheu parcial\n- Retome o interesse sem cobrar e pergunte o que faltou, uma coisa por vez.'}
            onChange={(e) => setConteudo(e.target.value)} />
        </label>
        <div className="ia-dir-rodape">
          <span className={`pequeno ${conteudo.length > limite ? 'ia-dir-excesso' : 'suave'}`}>
            {numero(conteudo.length)} / {numero(limite)} caracteres ({tokens(conteudo.length)})
          </span>
          <span className="ia-dir-acoes">
            {id && <button type="button" className="btn btn-pequeno" onClick={abrirHistorico}><History size={13} /> {versoes ? 'Fechar histórico' : 'Histórico'}</button>}
            {conteudo && <button type="button" className="btn btn-pequeno" onClick={baixar}><Download size={13} /> Baixar .md</button>}
            {admin && id && <button type="button" className="btn btn-pequeno btn-perigo-leve" onClick={apagar}><Trash2 size={13} /> Apagar</button>}
            {admin && <button type="button" className="btn btn-ouro" disabled={salvando || !alterado || !titulo.trim() || conteudo.length > limite} onClick={salvar}><Save size={14} /> {salvando ? 'Salvando…' : 'Salvar'}</button>}
          </span>
        </div>

        {versoes && (
          <div className="ia-dir-historico">
            {!versoes.length ? <p className="suave pequeno">Ainda não há versões anteriores: elas aparecem aqui a cada vez que você salva uma alteração.</p> : (
              <ul>
                {versoes.map((v) => (
                  <li key={v.id}>
                    <span className="pequeno">
                      <b>{new Date(v.salva_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</b>
                      {v.salva_por_nome ? ` · ${v.salva_por_nome}` : ''} · {numero(v.conteudo.length)} caracteres{v.titulo !== titulo ? ` · "${v.titulo}"` : ''}
                    </span>
                    <span className="ia-dir-acoes">
                      <button type="button" className="btn btn-pequeno" onClick={() => setVendo(vendo?.id === v.id ? null : v)}>{vendo?.id === v.id ? 'Ocultar' : 'Ver'}</button>
                      {admin && <button type="button" className="btn btn-pequeno" onClick={() => restaurar(v)}>Restaurar</button>}
                    </span>
                    {vendo?.id === v.id && <pre className="ia-dir-previa">{v.conteudo}</pre>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
