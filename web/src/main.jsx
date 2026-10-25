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
import App from './App.jsx';
import LiquidGlassFx from './components/LiquidGlassFx.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LiquidGlassFx />
    <App />
  </StrictMode>
);
