import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import './styles.css';
import './whatsapp.css';
import './design.css';
import './liquid-glass.css';
import './followup.css'; // ficha do lead (marcadores e follow-up) e a tela IA → Follow-up e lembretes
import './modo-live.css';
import './celular.css'; // app no celular/tablet (PWA), lista de reuniões e notificações
import './modoLive.js'; // liga o Modo Live antes do 1º desenho, se ficou ligado
import App from './App.jsx';
import { IdiomaProvider } from './i18n/index.jsx';
import LiquidGlassFx from './components/LiquidGlassFx.jsx';
import { registrarServiceWorker } from './pwa.js';

// App instalado (PWA): service worker das notificações e da página sem internet
registrarServiceWorker();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <IdiomaProvider>
      <LiquidGlassFx />
      <App />
    </IdiomaProvider>
  </StrictMode>
);
