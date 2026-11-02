// Idiomas do CRM (PT-BR, ES, EN). Sem biblioteca externa.
// Uso nos componentes:  const t = useT();  ...  t('topo.sair')
// Variáveis: t('chave', { nome: 'Ana' }) troca {nome} no texto.
// Se faltar a tradução no idioma escolhido, cai no português (e, em último caso, mostra a própria chave).
// O idioma fica salvo neste navegador (cada pessoa escolhe o seu).
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import pt from './pt.js';
import es from './es.js';
import en from './en.js';

export const IDIOMAS = [
  { id: 'pt', rotulo: 'Português (BR)', curto: 'PT', html: 'pt-BR' },
  { id: 'es', rotulo: 'Español', curto: 'ES', html: 'es' },
  { id: 'en', rotulo: 'English', curto: 'EN', html: 'en' },
];
const DICIONARIOS = { pt, es, en };
const CHAVE = 'crm-idioma';

function idiomaInicial() {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (DICIONARIOS[salvo]) return salvo;
  } catch { /* navegador sem armazenamento: usa o padrão */ }
  return 'pt';
}

function traduzir(idioma, chave, vars) {
  let texto = DICIONARIOS[idioma]?.[chave] ?? pt[chave] ?? chave;
  if (vars) texto = texto.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return texto;
}

const Contexto = createContext({ idioma: 'pt', setIdioma: () => {}, t: (c, v) => traduzir('pt', c, v) });

export function IdiomaProvider({ children }) {
  const [idioma, setIdiomaEstado] = useState(idiomaInicial);
  const setIdioma = useCallback((novo) => {
    if (!DICIONARIOS[novo]) return;
    setIdiomaEstado(novo);
    try { localStorage.setItem(CHAVE, novo); } catch { /* ignora */ }
  }, []);
  useEffect(() => {
    document.documentElement.lang = IDIOMAS.find((i) => i.id === idioma)?.html || 'pt-BR';
  }, [idioma]);
  const t = useCallback((chave, vars) => traduzir(idioma, chave, vars), [idioma]);
  return <Contexto.Provider value={{ idioma, setIdioma, t }}>{children}</Contexto.Provider>;
}

export const useT = () => useContext(Contexto).t;
export const useIdioma = () => useContext(Contexto);
