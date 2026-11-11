import { useEffect, useRef, useState } from "react";
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
    scene.add(agent.root, agent.shadow);

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

export default function AgentMascot({ compact = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { config } = useSession();
  const size = compact ? { w: 84, h: 104 } : { w: 150, h: 186 };

  const ask = (e) => {
    e.preventDefault();
    setOpen(false);
    nav(`/ai?q=${encodeURIComponent(q.trim())}`);
    setQ("");
  };

  return (
    <div className="relative">
      <AgentCanvas size={size} onActivate={() => setOpen((o) => !o)} hint="Агент підтримки UniPars — натисніть, щоб отримати допомогу" />
      {open && (
        <div
          role="dialog"
          aria-label="Допомога UniPars"
          className={`absolute z-40 w-[300px] card shadow-2xl p-4 ${compact ? "bottom-full mb-2 left-0" : "bottom-4 left-full ml-2"}`}
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="font-display text-sm">Привіт! Я Парс 👋</div>
              <div className="text-xs text-muted">Агент підтримки UniPars</div>
            </div>
            <button className="icon-btn -mr-2 -mt-1" onClick={() => setOpen(false)} aria-label="Закрити"><X size={16} /></button>
          </div>
          <form onSubmit={ask} className="flex gap-2 mb-3">
            <input className="input h-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Запитай AI про завдання…" />
            <button className="btn-primary h-9 px-3" aria-label="Запитати AI"><Sparkles size={16} /></button>
          </form>
          {!config?.ai_enabled && <div className="text-xs text-muted mb-2">AI ще не підключено — але я покажу, де що знайти.</div>}
          <ul className="space-y-1">
            {TIPS.map(({ icon: Icon, title, text, to }) => (
              <li key={title}>
                <button onClick={() => { setOpen(false); nav(to); }} className="w-full text-left flex gap-3 rounded-xl p-2 hover:bg-sunken">
                  <Icon size={18} className="text-primary mt-0.5 shrink-0" />
                  <span><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted">{text}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
