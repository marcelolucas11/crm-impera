import { memo, useEffect, useRef } from 'react';
import LOGO_SVG from '../assets/logo-impera-3d.js';
import { useAparencia } from '../aparencia.js';
import { aoMudarAtividade, aoMoverPonteiro, estaAtivo } from '../atividade.js';

// Fundo decorativo: flor-de-lis da Impera em ouro 3D flutuando num campo de estrelas (mesmo visual dos relatórios).
// Só estético — fica atrás de tudo, não recebe cliques e não muda nada do CRM.
// A biblioteca 3D é carregada só quando esta tela abre; sem WebGL, o fundo simplesmente não aparece.
//
// Desempenho (v0.34): no kanban o logo é desenhado UMA vez e fica parado (só redesenha ao mudar o tamanho da janela).
// Antes ele era redesenhado ~20 vezes por segundo enquanto o mouse se mexia, e cada quadro obrigava o navegador a
// refazer o desfoque de todo o vidro por cima dele — era o que mais esquentava o computador.
// Animado (flutuando e seguindo o mouse) só na tela de login, ou no kanban se a pessoa ligar "Fundo animado" em
// Equipe e integrações → Aparência. Animado, ele pausa com janela/painel aberto, rolagem, arrasto e 10 s sem uso.
// Com "reduzir animações" ligado no aparelho, a cena fica sempre parada.
const PRESETS = {
  login: { escala: 4.6, estrelas: 1, y: 0 },
  kanban: { escala: 3.6, estrelas: 0.7, y: -0.1 },
};

const SOBREPOSTOS = '.fundo-modal, .fundo-painel, .modal, .painel';

function FundoLogo3D({ modo = 'kanban' }) {
  const ref = useRef(null);
  const { fundoAnimado } = useAparencia();
  const querAnimado = modo === 'login' || fundoAnimado;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const cfg = PRESETS[modo] || PRESETS.kanban;
    let cancelado = false;
    let limpar = () => {};

    (async () => {
      let THREE, SVGLoader, RoomEnvironment;
      try {
        THREE = await import('three');
        ({ SVGLoader } = await import('three/examples/jsm/loaders/SVGLoader.js'));
        ({ RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js'));
      } catch {
        return;
      }
      if (cancelado) return;

      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: true, powerPreference: 'low-power' });
      } catch {
        return;
      }
      const animado = querAnimado && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Parado: desenha uma vez só, então pode ter a nitidez de antes. Animado: 1 pixel por ponto (4× menos trabalho na tela Retina)
      renderer.setPixelRatio(animado ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const cena = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const ambiente = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      cena.environment = ambiente;
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);

      // Logo extrudado em ouro metálico
      const dados = new SVGLoader().parse(LOGO_SVG);
      const formas = [];
      dados.paths.forEach((p) => SVGLoader.createShapes(p).forEach((s) => formas.push(s)));
      const geo = new THREE.ExtrudeGeometry(formas, { depth: 70, bevelEnabled: true, bevelThickness: 14, bevelSize: 7, bevelSegments: 5, curveSegments: 18 });
      geo.center(); geo.scale(1, -1, 1); geo.computeVertexNormals();
      // Parado: o material completo (verniz/clearcoat), já que é um quadro só. Animado: material padrão, mesmo ouro sem o
      // verniz, bem mais leve por quadro.
      const ouro = animado
        ? new THREE.MeshStandardMaterial({ color: 0xE5A50A, metalness: 1, roughness: 0.2, envMapIntensity: 1.35, side: THREE.DoubleSide })
        : new THREE.MeshPhysicalMaterial({ color: 0xE5A50A, metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.25, side: THREE.DoubleSide });
      const logo = new THREE.Mesh(geo, ouro);
      const s = cfg.escala / 1000; logo.scale.set(s, s, s);
      const pivo = new THREE.Group(); pivo.add(logo); cena.add(pivo);

      // Luzes: chave quente e contra-luz azulada
      const luzChave = new THREE.DirectionalLight(0xfff1d0, 2.2); luzChave.position.set(3, 4, 5); cena.add(luzChave);
      const luzContra = new THREE.DirectionalLight(0x6fa0ff, 1.6); luzContra.position.set(-4, -1, -3); cena.add(luzContra);
      const brilho = new THREE.PointLight(0xFFE2A0, 2.5, 14, 2); brilho.position.set(1.5, 2, 4); cena.add(brilho);

      // Estrelas: camada distante, camada próxima que cintila e poeira dourada perto do logo
      const ponto = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      })();
      let semente = 11; const rnd = () => (semente = (semente * 16807) % 2147483647) / 2147483647;
      const descartaveis = [geo, ouro, ponto, ambiente, pmrem];
      const estrelas = (n, rMin, rMax, tamanho, opacidade) => {
        n = Math.round(n * cfg.estrelas * (animado ? 0.6 : 1)); // animado: menos estrelas (cada uma custa a cada quadro)
        const pos = new Float32Array(n * 3), cor = new Float32Array(n * 3);
        const tons = [[1, 1, 1], [1, 0.92, 0.75], [0.75, 0.85, 1], [1, 0.8, 0.45]];
        for (let i = 0; i < n; i++) {
          const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin), q = Math.sqrt(1 - u * u);
          pos.set([r * q * Math.cos(t), r * u, r * q * Math.sin(t) - 10], i * 3);
          const c = tons[(rnd() * tons.length) | 0], b = 0.45 + rnd() * 0.55; cor.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cor, 3));
        const m = new THREE.PointsMaterial({ size: tamanho, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: opacidade, depthWrite: false, blending: THREE.AdditiveBlending, map: ponto });
        descartaveis.push(g, m);
        const p = new THREE.Points(g, m); cena.add(p); return p;
      };
      const longe = estrelas(2600, 60, 160, 0.55, 0.9);
      const perto = estrelas(500, 18, 55, 0.32, 0.95);
      const poeira = estrelas(160, 4, 12, 0.07, 0.6);
      poeira.material.color = new THREE.Color(0xF4C247);

      const tamanhoTela = () => {
        const w = window.innerWidth, h = window.innerHeight;
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      };
      tamanhoTela();

      // Mouse: alvo suavizado (o logo segue devagar, giro pequeno)
      let mx = 0, my = 0, alvoX = 0, alvoY = 0;

      let quadro = 0, rodando = false, ultimo = 0, pausaAte = 0, arrastando = false;
      const posar = (t) => {
        const tempo = t * 0.001;
        mx += (alvoX - mx) * 0.035; my += (alvoY - my) * 0.035;
        pivo.position.y = Math.sin(tempo * 0.5) * 0.07 + cfg.y;
        pivo.rotation.y = Math.sin(tempo * 0.18) * 0.14 + mx * 0.32;
        pivo.rotation.x = Math.sin(tempo * 0.27) * 0.04 + my * 0.16;
        pivo.rotation.z = Math.sin(tempo * 0.16) * 0.02;
        camera.position.set(mx * 0.3, -my * 0.2, 9.5);
        camera.lookAt(0, pivo.position.y * 0.6, 0);
        longe.rotation.y = tempo * 0.004; perto.rotation.y = tempo * 0.009;
        poeira.rotation.y = -tempo * 0.04; poeira.rotation.x = tempo * 0.015;
        perto.material.opacity = 0.75 + Math.sin(tempo * 1.6) * 0.18;
      };
      // Quadro parado: a mesma pose do primeiro quadro animado (o logo fica onde sempre aparecia)
      const desenharParado = () => { posar(0); renderer.render(cena, camera); };

      const pausado = () => document.hidden || !estaAtivo() || arrastando || performance.now() < pausaAte
        || Boolean(document.querySelector(SOBREPOSTOS));
      const desenhar = (t) => {
        rodando = false;
        if (pausado()) return; // volta quando a pessoa mexer de novo (aoMudarAtividade/aoMoverPonteiro)
        if (t - ultimo < 48) { pedir(); return; } // ~20 quadros/s
        ultimo = t;
        posar(t);
        renderer.render(cena, camera);
        pedir();
      };
      const pedir = () => {
        if (!animado || rodando) return;
        rodando = true; quadro = requestAnimationFrame(desenhar);
      };

      let redimensionar = 0;
      const aoRedimensionar = () => {
        clearTimeout(redimensionar);
        redimensionar = setTimeout(() => { tamanhoTela(); if (animado) pedir(); else desenharParado(); }, 150);
      };
      window.addEventListener('resize', aoRedimensionar);

      const desligar = [];
      if (animado) {
        const pausarUmPouco = () => { pausaAte = performance.now() + 400; };
        const aoArrastar = () => { arrastando = true; };
        const aoSoltar = () => { arrastando = false; pedir(); };
        document.addEventListener('scroll', pausarUmPouco, { capture: true, passive: true });
        document.addEventListener('dragstart', aoArrastar);
        document.addEventListener('dragend', aoSoltar);
        document.addEventListener('drop', aoSoltar);
        desligar.push(
          () => document.removeEventListener('scroll', pausarUmPouco, { capture: true }),
          () => document.removeEventListener('dragstart', aoArrastar),
          () => document.removeEventListener('dragend', aoSoltar),
          () => document.removeEventListener('drop', aoSoltar),
          aoMudarAtividade((ativo) => { if (ativo) pedir(); }),
          aoMoverPonteiro((e) => {
            if (!e) return;
            alvoX = e.clientX / window.innerWidth - 0.5; alvoY = e.clientY / window.innerHeight - 0.5;
            pedir();
          }),
        );
        desenharParado(); // primeiro quadro na hora, mesmo antes de a pessoa mexer
        pedir();
      } else {
        desenharParado();
      }
      cv.classList.add('pronto');
      document.documentElement.classList.add('com-fundo-3d');

      limpar = () => {
        cancelAnimationFrame(quadro);
        clearTimeout(redimensionar);
        window.removeEventListener('resize', aoRedimensionar);
        desligar.forEach((fn) => fn());
        document.documentElement.classList.remove('com-fundo-3d');
        descartaveis.forEach((d) => d.dispose?.());
        renderer.dispose();
        renderer.forceContextLoss();
      };
    })();

    return () => { cancelado = true; limpar(); };
  }, [modo, querAnimado]);

  return <canvas ref={ref} className={`fundo-3d fundo-3d-${modo}`} aria-hidden="true" />;
}

export default memo(FundoLogo3D);
