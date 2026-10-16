import { useEffect, useRef, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { rota } from '../base.js';
import { iniciais } from '../utils.js';

export const urlFotoUsuario = (id, versao) => rota(`/api/users/${id}/foto?v=${encodeURIComponent(versao || '')}`);

// Foto de uma pessoa da equipe (a enviada no cadastro) ou as iniciais. Sem pessoa: círculo tracejado para escolher.
// usuario: { id, name, foto } — foto é a versão (data em que mudou) ou null
export function FotoUsuario({ usuario, tamanho = 24, className = '', titulo }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [usuario?.id, usuario?.foto]);
  const estilo = { width: tamanho, height: tamanho, flexBasis: tamanho, fontSize: Math.max(9, Math.round(tamanho * 0.38)) };
  if (!usuario) {
    return (
      <span className={`foto-usuario foto-usuario-vazia ${className}`} style={estilo} title={titulo || 'Sem responsável'} aria-hidden="true">
        <UserPlus size={Math.round(tamanho * 0.52)} strokeWidth={2} />
      </span>
    );
  }
  const comFoto = Boolean(usuario.foto && !falhou);
  return (
    <span className={`foto-usuario ${comFoto ? 'com-foto' : ''} ${className}`} style={estilo} title={titulo ?? usuario.name} aria-hidden="true">
      {comFoto
        ? <img src={urlFotoUsuario(usuario.id, usuario.foto)} alt="" draggable={false} onError={() => setFalhou(true)} />
        : iniciais(usuario.name)}
    </span>
  );
}

// Recorta no meio (quadrado) e reduz para 256 px em JPEG — a foto fica leve (uns 20–40 KB) e nítida no cartão
export function prepararFoto(arquivo, lado = 256) {
  return new Promise((resolve, reject) => {
    if (!arquivo || !/^image\//.test(arquivo.type)) { reject(new Error('Escolha uma imagem (JPG, PNG ou WebP)')); return; }
    if (arquivo.size > 15 * 1024 * 1024) { reject(new Error('Imagem grande demais (máximo 15 MB)')); return; }
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const menor = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = lado;
      canvas.height = lado;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, lado, lado);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - menor) / 2, (img.naturalHeight - menor) / 2, menor, menor, 0, 0, lado, lado);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não deu para abrir essa imagem')); };
    img.src = url;
  });
}

// Campo para escolher a foto: mostra a prévia redonda; valor = data URL (ou '' sem foto)
export function CampoFoto({ valor, aoMudar, aoErro, nome = '', tamanho = 44, rotulo = 'Foto' }) {
  const entrada = useRef(null);
  const escolher = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    try { aoMudar(await prepararFoto(arquivo)); } catch (err) { aoErro?.(err.message); }
  };
  return (
    <span className="campo-foto">
      <button type="button" className="campo-foto-botao" onClick={() => entrada.current?.click()} title={valor ? 'Trocar a foto' : 'Adicionar uma foto'}
        style={{ width: tamanho, height: tamanho }}>
        {valor ? <img src={valor} alt="" /> : <span className="campo-foto-vazio">{nome ? iniciais(nome) : <UserPlus size={Math.round(tamanho * 0.42)} />}</span>}
        <span className="campo-foto-mais">+</span>
      </button>
      <span className="campo-foto-textos">
        <small>{rotulo}</small>
        {valor
          ? <button type="button" className="link link-sem-margem" onClick={() => aoMudar('')}>Remover</button>
          : <button type="button" className="link link-sem-margem" onClick={() => entrada.current?.click()}>Escolher…</button>}
      </span>
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={escolher} />
    </span>
  );
}
