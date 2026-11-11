// Процедурна 3D-модель агента підтримки UniPars (за ескізом: чібі-хлопець
// з бірюзовим волоссям, «антеною»-ахоге, чорними окулярами, світними
// схемами на обличчі та в темному костюмі з помаранчевими ґудзиками).
import * as THREE from "three";

const TEAL = new THREE.Color("#2fe0c4");
const TEAL_DEEP = new THREE.Color("#12b8a2");

// ---------- Матеріали ----------
function toonGradient() {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Аніме-контур: обернена оболонка, видавлена вздовж нормалей
function outlineMaterial(thickness = 0.022, color = "#1b2420") {
  return new THREE.ShaderMaterial({
    uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(color) } },
    vertexShader: `uniform float thickness;
      void main() { vec3 p = position + normal * thickness; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }`,
    side: THREE.BackSide,
  });
}

// Детермінований генератор випадкових чисел для однакового малюнка схем
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

// Текстура обличчя 4096×2048: шкіра, брови, рот «:3», схеми; окремо — карта світіння
function faceTextures() {
  const W = 4096, H = 2048;
  const skin = document.createElement("canvas");
  const glow = document.createElement("canvas");
  skin.width = glow.width = W;
  skin.height = glow.height = H;
  const s = skin.getContext("2d");
  const g = glow.getContext("2d");
  s.fillStyle = "#fff6ee";
  s.fillRect(0, 0, W, H);
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);

  const cx = W * 0.25; // фронт сфери (u = 0.25)
  // рум'янець
  for (const dx of [-300, 300]) {
    const grad = s.createRadialGradient(cx + dx, 1240, 10, cx + dx, 1240, 150);
    grad.addColorStop(0, "rgba(255,150,150,0.22)");
    grad.addColorStop(1, "rgba(255,150,150,0)");
    s.fillStyle = grad;
    s.fillRect(cx + dx - 160, 1080, 320, 320);
  }

  // схеми
  const rand = rng(7);
  function trace(x, y, steps, dirX, len) {
    const pts = [[x, y]];
    for (let i = 0; i < steps; i++) {
      const diag = rand() < 0.45;
      x += diag ? dirX * len * (0.5 + rand() * 0.6) : 0;
      y += len * (0.6 + rand() * 0.7);
      pts.push([x, y]);
      if (rand() < 0.3) dirX = -dirX;
    }
    for (const [ctx, color, w, blur] of [[s, "#14cdb2", 20, 0], [g, "#ffffff", 26, 10]]) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
      const [ex, ey] = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(ex, ey, w * 1.9, 0, Math.PI * 2);
      ctx.fill();
      if (rand() < 0.5) {
        const [mx, my] = pts[1];
        ctx.beginPath();
        ctx.arc(mx, my, w * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  // чоло: від лінії волосся вниз між бровами
  for (let i = 0; i < 7; i++) trace(cx - 150 + i * 50 + rand() * 12, 600 + rand() * 30, 3 + Math.floor(rand() * 2), rand() < 0.5 ? -1 : 1, 62);
  // щоки під окулярами
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      trace(cx + side * (170 + i * 42), 1110 + rand() * 30, 2 + Math.floor(rand() * 2), side, 58);
    }
  }

  // брови
  s.strokeStyle = "#23201f";
  s.lineCap = "round";
  s.lineWidth = 20;
  for (const side of [-1, 1]) {
    s.beginPath();
    s.moveTo(cx + side * 150, 905);
    s.quadraticCurveTo(cx + side * 235, 893, cx + side * 320, 905);
    s.stroke();
  }
  // рот «:3»
  s.lineWidth = 14;
  s.strokeStyle = "#3b2b2b";
  s.beginPath();
  s.moveTo(cx - 70, 1325);
  s.quadraticCurveTo(cx - 35, 1365, cx, 1330);
  s.quadraticCurveTo(cx + 35, 1365, cx + 70, 1325);
  s.stroke();

  const map = new THREE.CanvasTexture(skin);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emissive = new THREE.CanvasTexture(glow);
  emissive.anisotropy = 8;
  return { map, emissive };
}

// ---------- Збірка ----------
export function buildAgent() {
  const gradientMap = toonGradient();
  const outline = outlineMaterial();
  const disposables = [gradientMap, outline];

  const { map, emissive } = faceTextures();
  disposables.push(map, emissive);

  const skinMat = new THREE.MeshPhysicalMaterial({
    color: "#ffffff", map, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color("#ffd9cc"),
    emissive: TEAL, emissiveMap: emissive, emissiveIntensity: 1.2,
  });
  const plainSkin = new THREE.MeshToonMaterial({ color: "#fff3ea", gradientMap });
  const hairMat = new THREE.MeshToonMaterial({ color: "#34e3c6", gradientMap, emissive: TEAL_DEEP, emissiveIntensity: 0.12 });
  const suitMat = new THREE.MeshToonMaterial({ color: "#45484f", gradientMap });
  const pantsMat = new THREE.MeshToonMaterial({ color: "#3a3c42", gradientMap });
  const whiteMat = new THREE.MeshToonMaterial({ color: "#f4f4f2", gradientMap });
  const blackMat = new THREE.MeshToonMaterial({ color: "#16181b", gradientMap });
  const buttonMat = new THREE.MeshPhysicalMaterial({ color: "#f2a21b", roughness: 0.25, clearcoat: 1, metalness: 0.1 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: "#050506", roughness: 0.08, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
  disposables.push(skinMat, plainSkin, hairMat, suitMat, pantsMat, whiteMat, blackMat, buttonMat, glassMat);

  const root = new THREE.Group();
  const add = (parent, geo, mat, { pos, rot, scale, outlined = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    parent.add(m);
    if (outlined) m.add(new THREE.Mesh(geo, outline));
    disposables.push(geo);
    return m;
  };

  // ---------- Тіло ----------
  const body = new THREE.Group();
  root.add(body);
  const torso = add(body, new THREE.CapsuleGeometry(0.42, 0.42, 12, 32), suitMat, { pos: [0, 0.18, 0], scale: [1, 1, 0.78] });
  // сорочка-«V», краватка, комір
  const shirt = new THREE.Shape();
  shirt.moveTo(-0.17, 0.0);
  shirt.lineTo(0.17, 0.0);
  shirt.lineTo(0, -0.3);
  shirt.closePath();
  add(body, new THREE.ShapeGeometry(shirt), whiteMat, { pos: [0, 0.6, 0.315], rot: [-0.25, 0, 0], outlined: false });
  add(body, new THREE.ConeGeometry(0.05, 0.26, 4), blackMat, { pos: [0, 0.42, 0.335], rot: [Math.PI, Math.PI / 4, 0], scale: [1, 1, 0.5], outlined: false });
  for (const side of [-1, 1]) {
    add(body, new THREE.ConeGeometry(0.1, 0.18, 3), whiteMat, { pos: [side * 0.1, 0.58, 0.3], rot: [-0.3, 0, side * 2.6], scale: [1, 1, 0.3], outlined: false });
  }
  for (const y of [0.24, 0.07]) add(body, new THREE.SphereGeometry(0.045, 24, 16), buttonMat, { pos: [0, y, 0.335], outlined: false });

  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.43, 0.48, 0);
    body.add(pivot);
    add(pivot, new THREE.CapsuleGeometry(0.115, 0.38, 8, 24), suitMat, { pos: [side * 0.05, -0.27, 0], rot: [0, 0, side * 0.12] });
    add(pivot, new THREE.SphereGeometry(0.11, 24, 16), plainSkin, { pos: [side * 0.09, -0.58, 0.02] });
    pivot.userData.side = side;
    arms.push(pivot);
  }
  for (const side of [-1, 1]) {
    add(body, new THREE.CapsuleGeometry(0.14, 0.32, 8, 24), pantsMat, { pos: [side * 0.17, -0.45, 0] });
    add(body, new THREE.SphereGeometry(0.16, 24, 16), blackMat, { pos: [side * 0.18, -0.8, 0.06], scale: [1, 0.55, 1.35] });
  }
  add(body, new THREE.CylinderGeometry(0.13, 0.15, 0.2, 24), plainSkin, { pos: [0, 0.64, 0], outlined: false });

  // ---------- Голова ----------
  const head = new THREE.Group();
  head.position.set(0, 1.5, 0);
  root.add(head);
  add(head, new THREE.SphereGeometry(1, 128, 96), skinMat, { scale: [1, 0.9, 0.92] });
  for (const side of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.2, 24, 16), plainSkin, { pos: [side * 0.97, -0.08, 0], scale: [0.55, 1, 0.8] });
  }

  // Волосся: «шапка», потилиця, пасма-шипи, чубчик
  add(head, new THREE.SphereGeometry(1.06, 96, 48, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat, { pos: [0, 0.05, -0.02], rot: [-0.18, 0, 0], scale: [1.02, 0.95, 0.98] });
  add(head, new THREE.SphereGeometry(1.05, 96, 48, Math.PI, Math.PI, 0, Math.PI * 0.72), hairMat, { pos: [0, 0.02, -0.02], scale: [1.02, 0.95, 0.98] });

  const spike = (pos, rot, r = 0.2, h = 0.6) => add(head, new THREE.ConeGeometry(r, h, 24), hairMat, { pos, rot });
  // чубчик над окулярами: пасма вниз
  const bangs = [[-0.62, 0.42, 0.72, 0.35], [-0.36, 0.48, 0.84, 0.15], [-0.1, 0.52, 0.9, -0.05], [0.16, 0.5, 0.88, -0.2], [0.42, 0.46, 0.8, -0.3], [0.66, 0.4, 0.66, -0.45]];
  bangs.forEach(([x, y, z, tilt], i) => spike([x, y + 0.08, z - 0.02], [Math.PI - 0.3, tilt * 0.3, tilt * 0.8], 0.2 + (i % 2) * 0.04, 0.6 + (i % 3) * 0.08));
  // бокові пасма (розтріпані)
  for (const side of [-1, 1]) {
    spike([side * 0.98, 0.25, 0.25], [0.2, 0, side * 2.3], 0.16, 0.55);
    spike([side * 1.02, 0.02, -0.1], [0, 0, side * 2.0], 0.15, 0.5);
    spike([side * 0.9, 0.5, -0.35], [-0.4, 0, side * 1.5], 0.18, 0.55);
  }
  // маківка і потилиця
  spike([0.25, 0.92, -0.2], [-0.5, 0, -0.35], 0.2, 0.45);
  spike([-0.3, 0.88, -0.3], [-0.7, 0, 0.45], 0.2, 0.45);
  spike([0, 0.6, -0.85], [-1.9, 0, 0], 0.22, 0.5);
  spike([0.5, 0.35, -0.82], [-2.0, 0, -0.6], 0.2, 0.45);
  spike([-0.5, 0.35, -0.82], [-2.0, 0, 0.6], 0.2, 0.45);

  // Ахоге — «антена», що гойдається
  const ahoge = new THREE.Group();
  ahoge.position.set(0.05, 0.92, 0.05);
  head.add(ahoge);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, 0.35, 0.02), new THREE.Vector3(-0.08, 0.68, 0.05),
    new THREE.Vector3(-0.38, 0.78, 0.08), new THREE.Vector3(-0.5, 0.55, 0.1), new THREE.Vector3(-0.4, 0.42, 0.1),
  ]);
  const tube = new THREE.TubeGeometry(curve, 96, 0.075, 20, false);
  // звуження до кінчика
  const p = tube.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const seg = Math.floor(i / 21) / 96;
    const c = curve.getPointAt(Math.min(seg, 1));
    v.fromBufferAttribute(p, i).sub(c).multiplyScalar(1 - seg * 0.75).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  tube.computeVertexNormals();
  add(ahoge, tube, hairMat);

  // Окуляри
  const lens = new THREE.Shape();
  const w = 0.6, h = 0.27, r = 0.06;
  lens.moveTo(-w / 2 + r, -h / 2);
  lens.lineTo(w / 2 - r, -h / 2);
  lens.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  lens.lineTo(w / 2, h / 2 - r);
  lens.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  lens.lineTo(-w / 2 + r, h / 2);
  lens.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  lens.lineTo(-w / 2, -h / 2 + r);
  lens.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const lensGeo = new THREE.ExtrudeGeometry(lens, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 4, curveSegments: 12 });
  disposables.push(lensGeo);
  for (const side of [-1, 1]) {
    const l = new THREE.Mesh(lensGeo, glassMat);
    l.position.set(side * 0.36, -0.07, 0.83);
    l.rotation.y = side * 0.28;
    head.add(l);
    const temple = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.7), glassMat);
    temple.position.set(side * 0.86, -0.03, 0.4);
    temple.rotation.y = side * 0.1;
    head.add(temple);
    disposables.push(temple.geometry);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.04), glassMat);
  bridge.position.set(0, -0.0, 0.91);
  head.add(bridge);
  disposables.push(bridge.geometry);

  // М'яка тінь під ногами
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 256;
  const sc = shadowCanvas.getContext("2d");
  const sg = sc.createRadialGradient(128, 128, 10, 128, 128, 128);
  sg.addColorStop(0, "rgba(10,40,30,0.35)");
  sg.addColorStop(1, "rgba(10,40,30,0)");
  sc.fillStyle = sg;
  sc.fillRect(0, 0, 256, 256);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.92;
  disposables.push(shadowTex, shadow.geometry, shadow.material);

  // Додаткові пасма для об'єму (шар над «шапкою»)
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    spike([Math.sin(a) * 0.62, 0.78 + Math.cos(a * 2) * 0.05, Math.cos(a) * 0.55 - 0.1], [-0.35 * Math.cos(a), 0, 0.5 * Math.sin(a)], 0.19, 0.42);
  }

  // Відблиск на окулярах (рухається при наведенні)
  const glintMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.0, depthWrite: false });
  const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.34), glintMat);
  glint.position.set(-0.5, -0.07, 0.92);
  glint.rotation.z = 0.5;
  head.add(glint);
  disposables.push(glintMat, glint.geometry);

  // Голографічне кільце біля ніг і частинки-«знання», що обертаються навколо агента
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.018, 12, 96),
    new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.55 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = -0.9;
  disposables.push(halo.geometry, halo.material);

  const particles = new THREE.Group();
  const pGeo = new THREE.SphereGeometry(0.045, 16, 12);
  const pMats = [new THREE.MeshBasicMaterial({ color: "#2fe0c4" }), new THREE.MeshBasicMaterial({ color: "#bef248" }), new THREE.MeshBasicMaterial({ color: "#ffb547" })];
  disposables.push(pGeo, ...pMats);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(pGeo, pMats[i % 3]);
    m.userData = { r: 1.15 + (i % 3) * 0.12, speed: 0.6 + i * 0.07, phase: (i / 7) * Math.PI * 2, y: 0.2 + (i % 4) * 0.55, s: 0.7 + (i % 3) * 0.25 };
    m.scale.setScalar(m.userData.s);
    particles.add(m);
  }

  return {
    root, shadow, head, body, torso, arms, ahoge, skinMat, glint, glintMat, halo, particles,
    dispose: () => disposables.forEach((d) => d.dispose?.()),
  };
}
