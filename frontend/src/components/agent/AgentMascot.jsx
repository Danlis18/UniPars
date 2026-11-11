import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { BookOpen, HelpCircle, Search, Sparkles, Upload, X } from "lucide-react";
import { buildAgent } from "./buildAgent.js";
import { useSession } from "../../app/session.jsx";

// 3D-агент підтримки в лівому нижньому куті. Рендер із суперсемплінгом
// (pixel ratio до 4×) для чіткої картинки на 4K-екранах.
function AgentCanvas({ size, onActivate, hint }) {
  const mountRef = useRef(null);
  const stateRef = useRef({ hover: false, jump: 0 });

  useEffect(() => {
    const mount = mountRef.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 2, 4));
    renderer.setSize(size.w, size.h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;

    const camera = new THREE.PerspectiveCamera(28, size.w / size.h, 0.1, 50);
    camera.position.set(0, 1.25, 8.9);
    camera.lookAt(0, 1.15, 0);

    scene.add(new THREE.HemisphereLight("#ffffff", "#bfe9dc", 1.1));
    const key = new THREE.DirectionalLight("#fff6ea", 2.2);
    key.position.set(3, 5, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight("#2fe0c4", 2.4);
    rim.position.set(-4, 3, -4);
    scene.add(rim);

    const agent = buildAgent();
    scene.add(agent.root, agent.shadow, agent.halo, agent.particles);

    const pointer = { x: 0, y: 0 };
    const onMove = (e) => {
      const r = mount.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.35;
      pointer.x = Math.max(-1, Math.min(1, (e.clientX - cx) / 500));
      pointer.y = Math.max(-1, Math.min(1, (e.clientY - cy) / 400));
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(mount);

    const clock = new THREE.Clock();
    let raf;
    const yaw = { v: 0 }, pitch = { v: 0 };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      const t = reduced ? 0 : clock.getElapsedTime();
      const st = stateRef.current;

      // стрибок після кліку (затухаюча пружина)
      st.jump = Math.max(0, st.jump - 0.025);
      const jumpY = Math.sin((1 - st.jump) * Math.PI) * 0.45 * (st.jump > 0 ? 1 : 0);
      const bob = Math.sin(t * 2) * 0.05;
      agent.root.position.y = bob + jumpY;
      agent.root.rotation.y = Math.sin(t * 0.6) * 0.12 + (st.jump > 0 ? (1 - st.jump) * Math.PI * 2 : 0);
      agent.shadow.scale.setScalar(1 - (bob + jumpY) * 0.6);
      agent.torso.scale.y = 1 + Math.sin(t * 2) * 0.015;

      // голова стежить за курсором
      yaw.v += (pointer.x * 0.55 - yaw.v) * 0.08;
      pitch.v += (pointer.y * 0.3 - pitch.v) * 0.08;
      agent.head.rotation.y = yaw.v;
      agent.head.rotation.x = pitch.v;
      agent.head.rotation.z = Math.sin(t * 1.3) * 0.04;

      agent.ahoge.rotation.z = Math.sin(t * 3.2) * 0.14 + (st.hover ? Math.sin(t * 14) * 0.1 : 0);
      agent.ahoge.rotation.x = Math.sin(t * 2.1) * 0.06;

      // права рука махає, коли наводять курсор
      const [left, right] = agent.arms;
      left.rotation.z = -0.05 + Math.sin(t * 2) * 0.03;
      const targetWave = st.hover ? 2.4 + Math.sin(t * 9) * 0.35 : 0.05 + Math.sin(t * 2 + 1) * 0.03;
      right.rotation.z += (targetWave - right.rotation.z) * 0.15;

      // частинки-знання по орбітах, голографічне кільце пульсує
      agent.particles.children.forEach((m) => {
        const u = m.userData, a = t * u.speed + u.phase;
        m.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 1.5 + u.phase) * 0.12 + agent.root.position.y, Math.sin(a) * u.r * 0.6);
      });
      agent.halo.scale.setScalar(1 + Math.sin(t * 2.2) * 0.05);
      agent.halo.material.opacity = 0.35 + Math.sin(t * 2.2) * 0.15 + (st.hover ? 0.3 : 0);

      // відблиск пробігає по окулярах при наведенні
      st.glintT = st.hover ? (st.glintT ?? 0) + 0.04 : 0;
      const gx = -0.55 + ((st.glintT % 2.2) / 1.1) * 0.55;
      agent.glint.position.x = gx;
      agent.glintMat.opacity = st.hover && st.glintT % 2.2 < 2.0 ? 0.55 : 0;

      // «живі» схеми на обличчі
      agent.skinMat.emissiveIntensity = 0.9 + Math.sin(t * 2.6) * 0.45 + (st.hover ? 0.4 : 0);
      renderer.render(scene, camera);
    };
    loop();

    stateRef.current.poke = () => (stateRef.current.jump = 1);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      agent.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [size.w, size.h]);

  return (
    <button
      type="button"
      ref={mountRef}
      onClick={() => { stateRef.current.poke?.(); onActivate(); }}
      onPointerEnter={() => (stateRef.current.hover = true)}
      onPointerLeave={() => (stateRef.current.hover = false)}
      className="relative block rounded-3xl focus-visible:outline-2"
      style={{ width: size.w, height: size.h }}
      aria-label={hint}
      title={hint}
    />
  );
}

const TIPS = [
  { icon: Search, title: "Знайти матеріал", text: "Матеріали → фільтри за предметом, типом, курсом.", to: "/materials" },
  { icon: HelpCircle, title: "Поставити запитання", text: "Опиши умову, що вже пробував і який крок незрозумілий.", to: "/questions?compose=question" },
  { icon: Upload, title: "Поділитися матеріалом", text: "PDF, DOCX, PPTX, зображення або ZIP до 25 МБ.", to: "/?compose=material" },
  { icon: BookOpen, title: "Підписатися на предмети", text: "Стрічка «Для мене» підлаштується під них.", to: "/subjects" },
];

// Панель допомоги: рендериться в <body> через портал (поверх усього інтерфейсу),
// скляна, з «пружинною» анімацією появи та згортання до агента, як в iOS/macOS.
const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";

function HelpPanel({ anchor, state, onClose, compact }) {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { config } = useSession();
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(340, window.innerWidth - 24);
      if (compact || window.innerWidth < 768) {
        setPos({ left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)), bottom: window.innerHeight - r.top + 10, width: w, origin: "18% 100%" });
      } else {
        setPos({ left: r.right + 8, bottom: Math.max(12, window.innerHeight - r.bottom + 16), width: w, origin: "0% 85%" });
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, compact]);

  useEffect(() => {
    if (state === "open") setTimeout(() => inputRef.current?.focus(), 120);
    const onKey = (e) => e.key === "Escape" && onClose();
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !anchor.current?.contains(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [state, onClose, anchor]);

  if (!pos) return null;
  const shown = state === "open";
  const go = (to) => { onClose(); nav(to); };
  const ask = (e) => {
    e.preventDefault();
    go(`/ai?q=${encodeURIComponent(q.trim())}`);
    setQ("");
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Допомога UniPars"
      className="glass fixed z-[90] rounded-[28px] p-4 text-ink"
      style={{
        left: pos.left, bottom: pos.bottom, width: pos.width, transformOrigin: pos.origin,
        transform: shown ? "scale(1) translateY(0)" : "scale(0.35) translateY(24px)",
        opacity: shown ? 1 : 0,
        filter: shown ? "blur(0)" : "blur(10px)",
        transition: `transform ${shown ? 520 : 340}ms ${SPRING}, opacity ${shown ? 260 : 220}ms ease, filter ${shown ? 360 : 240}ms ease`,
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-2xl grid place-items-center text-[#0b2a1f] shadow-lg" style={{ background: "linear-gradient(135deg,#2fe0c4,#bef248)" }}>
            <Sparkles size={18} />
          </span>
          <div>
            <div className="font-display text-sm">Привіт! Я Парс</div>
            <div className="text-xs text-muted">Агент підтримки UniPars</div>
          </div>
        </div>
        <button className="icon-btn -mr-2 -mt-1" onClick={onClose} aria-label="Закрити"><X size={16} /></button>
      </div>
      <form onSubmit={ask} className="flex gap-2 mb-2">
        <input ref={inputRef} className="input h-10 rounded-full bg-surface/70" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Запитай про завдання…" aria-label="Запитання до AI" />
        <button className="btn-accent h-10 w-10 p-0 shrink-0" aria-label="Запитати AI" disabled={!q.trim()}><Sparkles size={16} /></button>
      </form>
      {!config?.ai_enabled && <div className="text-xs text-muted mb-2 px-1">AI ще не підключено — але я покажу, де що знайти.</div>}
      <ul className="space-y-0.5">
        {TIPS.map(({ icon: Icon, title, text, to }, i) => (
          <li key={title} style={{ transition: `opacity 300ms ease ${shown ? 120 + i * 45 : 0}ms, transform 420ms ${SPRING} ${shown ? 100 + i * 45 : 0}ms`,
            opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(8px)" }}>
            <button onClick={() => go(to)} className="w-full text-left flex gap-3 rounded-2xl p-2.5 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
              <Icon size={18} className="text-teal mt-0.5 shrink-0" />
              <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted">{text}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

export default function AgentMascot({ compact = false }) {
  const [state, setState] = useState("closed"); // closed | open | closing
  const anchor = useRef(null);
  const size = compact ? { w: 84, h: 104 } : { w: 150, h: 186 };
  // Спершу монтуємо в «згорнутому» стані, потім вмикаємо анімацію появи
  const open = () => { setState("mounting"); setTimeout(() => setState("open"), 20); };
  const close = useCallback(() => {
    setState((s) => (s === "open" ? "closing" : s));
    setTimeout(() => setState((s) => (s === "closing" ? "closed" : s)), 360);
  }, []);

  return (
    <div ref={anchor} className="relative">
      <AgentCanvas size={size} onActivate={() => (state === "open" ? close() : open())} hint="Агент підтримки UniPars — натисніть, щоб отримати допомогу" />
      {state !== "closed" && <HelpPanel anchor={anchor} state={state} onClose={close} compact={compact} />}
    </div>
  );
}
