// Vista 3D da asa com Three.js (src/vendor, carregado só quando a vista é aberta).
// Cada elemento montado (coordenadas do esboço, mm) é extrudado na direção normal ao plano.
// Em 3D a extrusão usa a envergadura do pacote; em 2D a profundidade é só visual (e é dita como tal).
import { h } from './dom.js';
import { theme } from './plots.js';

let libs = null;
const loadThree = () => (libs ||= Promise.all([import('../vendor/three.module.min.js'), import('../vendor/OrbitControls.js')]).then(([THREE, oc]) => ({ THREE, OrbitControls: oc.OrbitControls })));

/**
 * @param wing  resultado de buildWing (usa wing.plane[i].pts)
 * @param depth profundidade da extrusão em mm
 * @returns elemento com o canvas (desenha sob demanda: só ao girar/zoom/redimensionar)
 */
export function wing3D(wing, depth, opts = {}) {
  const H = opts.height || 420;
  const box = h('div', { class: 'plot view3d', style: { height: `${H}px` } }, h('div', { class: 'muted', style: { padding: '12px' } }, 'Carregando a vista 3D…'));
  loadThree().then(({ THREE, OrbitControls }) => {
    let tries = 0;
    const go = () => {
      if (!box.isConnected) { if (++tries < 120) setTimeout(go, 16); return; }
      box.replaceChildren();
      const th = theme();
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
      renderer.setClearColor(new THREE.Color(th.surface));
      box.append(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(-1, 2, 3); scene.add(sun);

      const group = new THREE.Group();
      wing.plane.forEach((e, i) => {
        const pts = e.pts.map((p) => new THREE.Vector2(p[0], p[1]));
        const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth, bevelEnabled: false, curveSegments: 1 });
        const col = new THREE.Color(th.series[i % 8] || '#cccccc');
        group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide })));
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: th.dark ? 0xffffff : 0x000000, transparent: true, opacity: 0.35 }));
        group.add(edges);
      });
      // centraliza e normaliza a escala
      const bb = new THREE.Box3().setFromObject(group), c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3());
      group.position.sub(c);
      scene.add(group);
      const R = Math.max(size.x, size.y, size.z) || 1;
      const camera = new THREE.PerspectiveCamera(35, 1, R / 100, R * 50);
      camera.position.set(R * 0.9, R * 0.55, R * 1.4);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      const render = () => renderer.render(scene, camera);
      controls.addEventListener('change', render);
      const fit = () => {
        if (!box.isConnected) { ro.disconnect(); controls.dispose(); renderer.dispose(); return; }
        const w = box.clientWidth || 600, hh = box.clientHeight || H;
        renderer.setSize(w, hh); camera.aspect = w / hh; camera.updateProjectionMatrix(); render();
      };
      const ro = new ResizeObserver(fit); ro.observe(box);
      fit();
      box.reset = () => { camera.position.set(R * 0.9, R * 0.55, R * 1.4); controls.target.set(0, 0, 0); controls.update(); render(); };
      box.png = () => renderer.domElement.toDataURL('image/png');
    };
    setTimeout(go, 0);
  }).catch((e) => box.replaceChildren(h('div', { class: 'muted', style: { padding: '12px' } }, `Não foi possível abrir a vista 3D (${e.message}). O navegador precisa de WebGL.`)));
  return box;
}
