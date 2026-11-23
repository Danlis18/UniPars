// 3D-модель агента Парса (src/assets/agent/parse.glb) та її процедурні анімації.
// У файлі моделі є скелет, але немає жодного кліпу — усі рухи рахуються кодом по кістках:
// дихання, погляд за курсором, привітання, стрибок після кліку, «презентація» панелі,
// випадкові дрібні дії в спокої (озирнутися, поправити окуляри, потягнутися…).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// ?url — Vite дає файлу хеш у назві: браузер кешує модель надовго, а нова версія підтягнеться одразу
import MODEL_URL from "../../assets/agent/parse.glb?url";
const TEAL = new THREE.Color("#2fe0c4");

// ---------- Матеріали ----------
// Вставка у стандартний шейдер: позиція вершини в просторі моделі (до скінінгу) для ефектів
function withObjectPos(material, uniforms, fragment) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObj;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObj = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vObj;\n${Object.keys(uniforms).map((k) => `uniform ${typeof uniforms[k].value === "number" ? "float" : "vec3"} ${k};`).join("\n")}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${fragment}`);
  };
  material.customProgramCacheKey = () => material.name;
}

function tuneMaterials(scene) {
  const u = {
    nanoPulse: { value: 1 }, nanoFlow: { value: 0 },
    glint: { value: -2 }, glintAmt: { value: 0 },
    brow: { value: 0 }, smile: { value: 0 },
  };
  const owned = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; // скінінг зсуває вершини — рамка моделі не завжди актуальна
    const name = o.material.name;
    let m = o.material;
    if (name === "Nano.001") {
      // Світні нано-схеми на обличчі: у моделі вони трохи під шкірою — виводимо поверх і даємо «пульс даних»
      m = new THREE.MeshStandardMaterial({ name, color: "#14897a", emissive: TEAL, emissiveIntensity: 1.5, roughness: 0.4, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
      withObjectPos(m, { nanoPulse: u.nanoPulse, nanoFlow: u.nanoFlow }, `
        float band = smoothstep(0.16, 0.0, abs(fract(vObj.y * 1.6 - nanoFlow) - 0.5) - 0.32);
        totalEmissiveRadiance *= nanoPulse * (0.75 + band * 1.6);`);
      o.renderOrder = 2;
    } else if (name === "glasses.001") {
      // Окуляри: темне глянцеве скло з відблиском, що пробігає при наведенні
      // (дзеркальне скло при нахилі голови відбиває «стелю» й біліє — тому відбиття приглушені)
      m = new THREE.MeshPhysicalMaterial({ name, color: "#040607", roughness: 0.3, metalness: 0, specularIntensity: 0.1,
        emissive: "#ffffff", emissiveIntensity: 1, envMapIntensity: 0.05 });
      withObjectPos(m, { glint: u.glint, glintAmt: u.glintAmt }, `
        float g = smoothstep(0.07, 0.0, abs(vObj.x + (vObj.y - 2.74) * 1.4 - glint));
        totalEmissiveRadiance = vec3(g * glintAmt * 0.9);`);
    } else if (name === "mouth_and_eyebrows.001") {
      // Брови (вище за окуляри) піднімаються від подиву/радості, рот трохи ширшає в усмішці
      m = m.clone();
      m.onBeforeCompile = (shader) => {
        shader.uniforms.brow = u.brow;
        shader.uniforms.smile = u.smile;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float brow; uniform float smile;")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            if (position.y > 2.8) transformed.y += brow * 0.07;
            else if (position.y < 2.5) { transformed.x *= 1.0 + smile * 0.18; transformed.y += smile * 0.012 * abs(position.x) * 10.0; }`);
      };
      m.customProgramCacheKey = () => "brow";
    } else if (name === "Hair.001") {
      m = m.clone();
      m.color.set("#1fb8a6").convertSRGBToLinear();
      m.roughness = 0.55;
      m.sheen = 0;
    } else if (name === "Costume") {
      m = m.clone();
      m.color.set("#1c2226").convertSRGBToLinear();
      m.roughness = 0.62;
    } else if (name === "gold") {
      m = m.clone();
      m.metalness = 0.85;
      m.roughness = 0.3;
    } else {
      m = m.clone();
    }
    if (m !== o.material) { owned.push(m); o.material = m; }
  });
  return { uniforms: u, owned };
}

// ---------- Кістки: обертання в осях моделі (X — праворуч від глядача, Y — догори, Z — до глядача) ----------
const BONES = ["Torso", "Neck", "Head", "ForearmL", "LowerArmL", "HandL", "ForearmR", "LowerArmR", "HandR", "ThighL", "CalfL", "ThighR", "CalfR"];

function rigFrom(scene) {
  scene.updateMatrixWorld(true);
  const rig = {};
  scene.traverse((o) => {
    if (!o.isBone || !BONES.includes(o.name)) return;
    const parentRest = new THREE.Quaternion();
    o.parent.getWorldQuaternion(parentRest);
    rig[o.name] = { bone: o, rest: o.quaternion.clone(), parentRest, parentRestInv: parentRest.clone().invert(), pos: o.position.clone() };
  });
  return rig;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
// Повертає кістку на (x, y, z) радіан навколо осей моделі, зберігаючи ієрархію: дочірні кістки рухаються разом із батьківською
function pose(rig, name, x = 0, y = 0, z = 0) {
  const r = rig[name];
  if (!r) return;
  _q.setFromEuler(_e.set(x, y, z, "YXZ"));
  r.bone.quaternion.copy(r.parentRestInv).multiply(_q).multiply(r.parentRest).multiply(r.rest);
}

// ---------- Плавність ----------
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOutBack = (v) => { const c = 1.9; v = clamp01(v) - 1; return 1 + (c + 1) * v * v * v + c * v * v; };
// «вікно» дії: плавний вхід і вихід
const env = (p, a = 0.18, b = 0.22) => smooth(p / a) * smooth((1 - p) / b);
const lerp = (a, b, k) => a + (b - a) * k;
const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));

// ---------- Короткі дії (кліпи) ----------
// Кожна дія отримує прогрес p ∈ [0, 1] і додає зміщення до пози.
const CLIPS = {
  // стрибок після кліку: присід → стрибок із обертом → приземлення з пружинкою
  jump: { dur: 1.25, run(p, o) {
    const crouch = smooth(p / 0.16) * (1 - smooth((p - 0.16) / 0.08)) + smooth((p - 0.72) / 0.08) * (1 - smooth((p - 0.8) / 0.2));
    const air = clamp01((p - 0.22) / 0.52);
    o.lift += Math.sin(air * Math.PI) * 1.1;
    o.spin += smooth(air) * Math.PI * 2;
    o.squash += crouch * 0.12 - Math.sin(air * Math.PI) * 0.08 * (air > 0 && air < 1 ? 1 : 0);
    o.crouch += crouch;
    const up = Math.sin(air * Math.PI);
    // «ура»: руки в сторони й передпліччя вгору (прямо вгору їх сховала б велика голова)
    o.armL.z += up * 1.4; o.armR.z -= up * 1.4;
    o.elbowL.z += up * 0.95; o.elbowR.z -= up * 0.95;
    o.brow += up; o.smile += up;
  } },
  // озирнутися ліворуч-праворуч
  lookAround: { dur: 3.2, run(p, o) {
    const w = env(p, 0.12, 0.15);
    o.headYaw += Math.sin(p * Math.PI * 2) * 0.75 * w;
    o.headPitch -= 0.12 * w;
    o.torsoYaw += Math.sin(p * Math.PI * 2) * 0.18 * w;
  } },
  // поправити окуляри правою рукою
  glasses: { dur: 2.2, run(p, o) {
    const w = env(p, 0.25, 0.3);
    o.armR.x -= 1.55 * w; o.armR.z -= 0.55 * w; o.armR.y -= 0.35 * w;
    o.elbowR.x -= 1.85 * w; o.elbowR.y += 0.4 * w;
    const push = smooth((p - 0.4) / 0.12) * (1 - smooth((p - 0.55) / 0.12));
    o.elbowR.x -= push * 0.25;
    o.headPitch -= (0.12 + push * 0.12) * w;
    o.glint += push;
  } },
  // потягнутися: руки широко в сторони, голова назад, навшпиньки
  stretch: { dur: 2.6, run(p, o) {
    const w = env(p, 0.3, 0.3);
    o.armL.z += 1.45 * w; o.armR.z -= 1.45 * w;
    o.armL.x += 0.2 * w; o.armR.x += 0.2 * w;
    o.elbowL.z += 0.25 * w; o.elbowR.z -= 0.25 * w;
    o.headPitch -= 0.3 * w;
    o.lift += 0.08 * w;
    o.squash -= 0.04 * w;
    o.torsoRoll += Math.sin(p * Math.PI * 2) * 0.08 * w;
  } },
  // кивнути двічі
  nod: { dur: 1.3, run(p, o) {
    const w = env(p, 0.15, 0.2);
    o.headPitch += Math.max(0, Math.sin(p * Math.PI * 4)) * 0.3 * w;
    o.smile += w;
  } },
  // знизати плечима «хм?»
  shrug: { dur: 1.8, run(p, o) {
    const w = env(p, 0.2, 0.3);
    o.armL.z += 0.45 * w; o.armR.z -= 0.45 * w;
    o.elbowL.x -= 1.2 * w; o.elbowR.x -= 1.2 * w;
    o.elbowL.z -= 0.6 * w; o.elbowR.z += 0.6 * w;
    o.headRoll += 0.22 * w;
    o.brow += w;
    o.lift += 0.03 * w;
  } },
  // радісний підскок на місці
  hop: { dur: 1.1, run(p, o) {
    for (let i = 0; i < 2; i++) {
      const a = clamp01((p - i * 0.42) / 0.38);
      const h = Math.sin(a * Math.PI);
      o.lift += h * 0.32;
      o.squash -= h * 0.05;
    }
    const w = env(p, 0.1, 0.2);
    o.armL.z += 0.5 * w; o.armR.z -= 0.5 * w;
    o.smile += w;
  } },
  // поява: вистрибує з «порталу» під ногами
  intro: { dur: 1.4, run(p, o) {
    o.scale *= easeOutBack(clamp01(p / 0.55));
    o.lift += Math.sin(clamp01(p / 0.6) * Math.PI) * 0.6;
    o.spin += (1 - smooth(p / 0.6)) * -Math.PI;
    const wave = smooth((p - 0.45) / 0.15) * (1 - smooth((p - 0.85) / 0.15));
    o.armR.z -= wave * 1.25; o.elbowR.z -= wave * (0.95 + Math.sin(p * 40) * 0.42);
    o.smile += wave; o.brow += wave;
  } },
};
const IDLE = ["lookAround", "glasses", "stretch", "nod", "shrug", "hop"];

function freshPose() {
  const v = () => ({ x: 0, y: 0, z: 0 });
  return { lift: 0, spin: 0, squash: 0, crouch: 0, scale: 1, torsoYaw: 0, torsoPitch: 0, torsoRoll: 0,
    headYaw: 0, headPitch: 0, headRoll: 0, armL: v(), armR: v(), elbowL: v(), elbowR: v(), brow: 0, smile: 0, glint: 0 };
}

// ---------- Завантаження й аніматор ----------
// intro: false — без появи (для статичного кадру, коли анімації вимкнені)
export async function loadParse({ intro = true } = {}) {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const model = gltf.scene;
  const { uniforms, owned } = tuneMaterials(model);
  const rig = rigFrom(model);
  const root = new THREE.Group(); // опора — між стопами, щоб присідання/розтяг ішли від підлоги
  root.add(model);

  // м'яка тінь і голографічне кільце під ногами
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0, "rgba(10,40,30,0.38)");
  g.addColorStop(1, "rgba(10,40,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const shadowTex = new THREE.CanvasTexture(c);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.022, 12, 120), new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.5, depthWrite: false }));
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.02;
  // частинки-«знання» на орбітах
  const particles = new THREE.Group();
  const pGeo = new THREE.SphereGeometry(0.06, 16, 12);
  const pMats = ["#2fe0c4", "#bef248", "#ffb547"].map((col) => new THREE.MeshBasicMaterial({ color: col }));
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(pGeo, pMats[i % 3]);
    m.userData = { r: 1.75 + (i % 3) * 0.18, speed: 0.55 + i * 0.07, phase: (i / 7) * Math.PI * 2, y: 0.5 + (i % 4) * 0.95 };
    m.scale.setScalar(0.75 + (i % 3) * 0.25);
    particles.add(m);
  }

  // стан аніматора
  const s = {
    clip: intro ? { name: "intro", t: 0 } : null, nextIdle: 5 + Math.random() * 3, lastIdle: "",
    yaw: 0, pitch: 0, wave: 0, present: 0, hoverT: 0, time: 0,
  };
  const P = freshPose();

  function play(name) {
    if (!CLIPS[name]) return;
    s.clip = { name, t: 0 };
  }

  // input: { hover, open, pointer: {x, y} у межах −1…1 }
  function update(dt, input) {
    dt = Math.min(dt, 0.05);
    s.time += dt;
    const t = s.time;
    Object.assign(P, freshPose());

    // базовий цикл спокою: дихання, легке погойдування, руки «живуть»
    const breath = Math.sin(t * 2.1);
    P.lift += breath * 0.025;
    P.squash += breath * 0.012;
    P.torsoRoll += Math.sin(t * 0.9) * 0.025;
    P.torsoYaw += Math.sin(t * 0.55) * 0.08;
    P.headRoll += Math.sin(t * 1.1 + 1) * 0.035;
    P.armL.z += 0.06 + Math.sin(t * 2.1 + 0.6) * 0.04;
    P.armR.z -= 0.06 + Math.sin(t * 2.1 + 0.9) * 0.04;
    P.armL.x += Math.sin(t * 1.05) * 0.05;
    P.armR.x -= Math.sin(t * 1.05) * 0.05;
    P.elbowL.x -= 0.12; P.elbowR.x -= 0.12;

    // привітання, доки курсор над агентом; «презентація» — доки відкрита панель
    s.wave = damp(s.wave, input.hover && !input.open ? 1 : 0, 7, dt);
    s.present = damp(s.present, input.open ? 1 : 0, 6, dt);
    s.hoverT = input.hover ? s.hoverT + dt : 0;
    if (s.wave > 0.001) {
      const w = s.wave;
      // плече майже горизонтально вбік (голова велика — інакше рука ховається за нею), передпліччя вгору й махає
      P.armR.z -= 1.25 * w; P.armR.x -= 0.15 * w;
      P.elbowR.z -= (0.95 + Math.sin(t * 10) * 0.42) * w;
      P.torsoRoll -= 0.07 * w; // голова відхиляється від руки — долоню видно
      P.headRoll -= 0.1 * w;
      P.brow += 0.8 * w;
      P.smile += w;
      P.glint += smooth((s.hoverT % 2.4) / 0.9) * (s.hoverT % 2.4 < 1.0 ? 1 : 0) * w;
    }
    if (s.present > 0.001) {
      const w = s.present;
      // ліва рука (з боку панелі) жестом «ось тут» — відкрита долоня в бік панелі
      P.armL.z += 1.25 * w; P.armL.x -= 0.55 * w;
      P.elbowL.z += 0.25 * w; P.elbowL.x -= 0.35 * w;
      P.torsoYaw += 0.32 * w;
      P.headYaw += 0.35 * w;
      P.smile += w;
      P.brow += 0.4 * w;
    }

    // одна активна дія (клік або випадкова дія в спокої)
    if (s.clip) {
      const clip = CLIPS[s.clip.name];
      s.clip.t += dt;
      const p = s.clip.t / clip.dur;
      if (p >= 1) s.clip = null;
      else clip.run(p, P);
    } else if (!input.hover && !input.open) {
      s.nextIdle -= dt;
      if (s.nextIdle <= 0) {
        const pool = IDLE.filter((n) => n !== s.lastIdle);
        const name = pool[Math.floor(Math.random() * pool.length)];
        s.lastIdle = name;
        play(name);
        s.nextIdle = 6 + Math.random() * 6;
      }
    } else {
      s.nextIdle = Math.max(s.nextIdle, 3);
    }

    // погляд за курсором (плавно)
    const look = 1 - s.present * 0.6;
    s.yaw = damp(s.yaw, input.pointer.x * 0.6 * look, 6, dt);
    s.pitch = damp(s.pitch, input.pointer.y * 0.32 * look, 6, dt);
    P.headYaw += s.yaw;
    P.headPitch += s.pitch;
    P.torsoYaw += s.yaw * 0.25;

    apply(t);
  }

  function apply(t) {
    // корпус і голова
    pose(rig, "Torso", P.torsoPitch, P.torsoYaw, P.torsoRoll);
    pose(rig, "Neck", P.headPitch * 0.35, P.headYaw * 0.35, P.headRoll * 0.4);
    pose(rig, "Head", P.headPitch * 0.65, P.headYaw * 0.65, P.headRoll * 0.6);
    // руки: плече — зміщення від опущеного положення, лікоть — згин відносно плеча
    pose(rig, "ForearmL", P.armL.x, P.armL.y, P.armL.z);
    pose(rig, "ForearmR", P.armR.x, P.armR.y, P.armR.z);
    pose(rig, "LowerArmL", P.elbowL.x, P.elbowL.y, P.elbowL.z);
    pose(rig, "LowerArmR", P.elbowR.x, P.elbowR.y, P.elbowR.z);
    // ноги: присід (стегна вперед, гомілки назад)
    const k = P.crouch;
    pose(rig, "ThighL", -0.55 * k, 0, 0.04 * k);
    pose(rig, "ThighR", -0.55 * k, 0, -0.04 * k);
    pose(rig, "CalfL", 1.0 * k, 0, 0);
    pose(rig, "CalfR", 1.0 * k, 0, 0);

    // усе тіло: підйом, оберт, розтяг/стиск від підлоги
    const sq = P.squash;
    root.position.y = Math.max(0, P.lift) - k * 0.12;
    root.rotation.y = P.spin;
    root.scale.set((1 + sq * 0.6) * P.scale, (1 - sq) * P.scale, (1 + sq * 0.6) * P.scale);

    const air = Math.max(0, root.position.y);
    shadow.scale.setScalar(Math.max(0.35, 1 - air * 0.35) * P.scale);
    shadow.material.opacity = Math.max(0.3, 1 - air * 0.5);
    halo.scale.setScalar((1 + Math.sin(t * 2.2) * 0.04) * Math.max(0.01, P.scale));
    halo.material.opacity = 0.28 + Math.sin(t * 2.2) * 0.1 + s.wave * 0.25 + s.present * 0.2;
    particles.children.forEach((m) => {
      const d = m.userData, a = t * d.speed + d.phase;
      m.position.set(Math.cos(a) * d.r, d.y + Math.sin(t * 1.5 + d.phase) * 0.18 + air * 0.6, Math.sin(a) * d.r * 0.55);
    });
    particles.scale.setScalar(Math.max(0.01, P.scale));

    // обличчя: пульс нано-схем, брови, усмішка, відблиск на окулярах
    uniforms.nanoPulse.value = 0.9 + Math.sin(t * 2.6) * 0.35 + s.wave * 0.5 + s.present * 0.4;
    uniforms.nanoFlow.value = t * 0.45;
    uniforms.brow.value = Math.min(1, P.brow);
    uniforms.smile.value = Math.min(1, P.smile);
    const gl = Math.min(1, P.glint);
    uniforms.glintAmt.value = gl > 0.02 && gl < 0.98 ? 1 : 0;
    uniforms.glint.value = lerp(-0.8, 0.8, gl);
  }

  function dispose() {
    model.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    owned.forEach((m) => m.dispose());
    shadowTex.dispose(); shadow.geometry.dispose(); shadow.material.dispose();
    halo.geometry.dispose(); halo.material.dispose();
    pGeo.dispose(); pMats.forEach((m) => m.dispose());
  }

  return { root, shadow, halo, particles, update, play, dispose, height: 4.6 };
}
