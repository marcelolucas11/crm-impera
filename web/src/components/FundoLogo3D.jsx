import { memo, useEffect, useRef } from 'react';
import LOGO_SVG from '../assets/logo-impera-3d.js';

// Fundo decorativo: flor-de-lis da Impera em ouro 3D flutuando num campo de estrelas (mesmo visual dos relatórios).
// Só estético — fica atrás de tudo, não recebe cliques e não muda nada do CRM.
// O mouse inclina o logo de leve no próprio eixo. Com "reduzir animações" ligado no aparelho, a cena fica parada.
// A biblioteca 3D é carregada só quando esta tela abre; sem WebGL, o fundo simplesmente não aparece.
const PRESETS = {
  login: { escala: 4.6, estrelas: 1, y: 0 },
  kanban: { escala: 3.6, estrelas: 0.7, y: -0.1 },
};

function FundoLogo3D({ modo = 'kanban' }) {
  const ref = useRef(null);

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
      const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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
      const ouro = new THREE.MeshPhysicalMaterial({ color: 0xE5A50A, metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.25, side: THREE.DoubleSide });
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
        n = Math.round(n * cfg.estrelas);
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
      const aoMover = (e) => { acordar(); alvoX = e.clientX / window.innerWidth - 0.5; alvoY = e.clientY / window.innerHeight - 0.5; };

      let quadro = 0, rodando = false, ultimo = 0;
      // Economia: sem mexer no CRM por 10 s (ou com a janela em segundo plano) a cena pausa; volta ao mexer o mouse/teclado
      let ativo = true, ocioso = 0;
      const acordar = () => {
        clearTimeout(ocioso);
        ocioso = setTimeout(() => { ativo = false; }, 10000);
        if (!ativo) { ativo = true; pedir(); }
      };
      const aoPerderFoco = () => { clearTimeout(ocioso); ativo = false; };
      const desenhar = (t) => {
        rodando = false;
        if (!reduzir && t - ultimo < 48) { pedir(); return; } // ~20 quadros/s: suave e leve para o computador
        ultimo = t;
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
        renderer.render(cena, camera);
        if (!reduzir) pedir();
      };
      const pedir = () => {
        if (rodando || document.hidden || !ativo) return;
        rodando = true; quadro = requestAnimationFrame(desenhar);
      };
      const aoRedimensionar = () => { tamanhoTela(); if (reduzir) desenhar(performance.now()); };
      const aoVisibilidade = () => { if (!document.hidden && !reduzir) pedir(); };

      window.addEventListener('resize', aoRedimensionar);
      document.addEventListener('visibilitychange', aoVisibilidade);
      if (!reduzir) {
        window.addEventListener('pointermove', aoMover, { passive: true });
        window.addEventListener('pointerdown', acordar, { passive: true });
        window.addEventListener('keydown', acordar);
        window.addEventListener('wheel', acordar, { passive: true });
        window.addEventListener('focus', acordar);
        window.addEventListener('blur', aoPerderFoco);
        acordar();
      }
      if (reduzir) desenhar(performance.now()); else pedir();
      cv.classList.add('pronto');

      limpar = () => {
        cancelAnimationFrame(quadro);
        window.removeEventListener('resize', aoRedimensionar);
        document.removeEventListener('visibilitychange', aoVisibilidade);
        window.removeEventListener('pointermove', aoMover);
        window.removeEventListener('pointerdown', acordar);
        window.removeEventListener('keydown', acordar);
        window.removeEventListener('wheel', acordar);
        window.removeEventListener('focus', acordar);
        window.removeEventListener('blur', aoPerderFoco);
        clearTimeout(ocioso);
        descartaveis.forEach((d) => d.dispose?.());
        renderer.dispose();
        renderer.forceContextLoss();
      };
    })();

    return () => { cancelado = true; limpar(); };
  }, [modo]);

  return <canvas ref={ref} className={`fundo-3d fundo-3d-${modo}`} aria-hidden="true" />;
}

export default memo(FundoLogo3D);
