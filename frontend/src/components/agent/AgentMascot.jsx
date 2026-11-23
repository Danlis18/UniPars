import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { BookOpen, HelpCircle, KeyRound, Search, Sparkles, Upload, X } from "lucide-react";
import { SoonChip } from "../../features/ai/ComingSoon.jsx";
import { loadParse } from "./parseModel.js";
import { useSession } from "../../app/session.jsx";

// 3D-агент підтримки в лівому нижньому куті — модель Парса (parse.glb) з анімаціями з parseModel.js.
// Рендер із суперсемплінгом (pixel ratio до 3×) для чіткої картинки на 4K-екранах.
function AgentCanvas({ size, onActivate, hint, open }) {
  const mountRef = useRef(null);
  const stateRef = useRef({ hover: false, open: false });
  stateRef.current.open = open;

  useEffect(() => {
    // 3D запускається, коли браузер вільний (після першого показу сайту) — не гальмує завантаження
    let cancelled = false;
    let cleanup = () => {};
    const start = async () => {
      if (cancelled) return;
      const mount = mountRef.current;
      if (!mount) return;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      // Програмний рендер (без GPU) — малюємо статичний кадр, щоб не навантажувати процесор
      const gl = renderer.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
      const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
      const still = reduced || software;

      let agent;
      try {
        agent = await loadParse({ intro: !still });
      } catch {
        renderer.dispose();
        return; // модель не завантажилась (офлайн) — просто без агента, кнопка допомоги лишається
      }
      if (cancelled) { agent.dispose(); renderer.dispose(); return; }

      renderer.setPixelRatio(software ? 1 : Math.min((window.devicePixelRatio || 1) * 1.5, 3));
      renderer.setSize(size.w, size.h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.style.pointerEvents = "none";
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;

      // кадр: модель ~4.6 одиниці заввишки; у стрибку камера трохи підіймається слідом
      const camera = new THREE.PerspectiveCamera(27, size.w / size.h, 0.1, 60);
      const aim = (lift) => { camera.position.set(0, 2.55 + lift * 0.6, 11.2); camera.lookAt(0, 2.45 + lift * 0.6, 0); };
      aim(0);

      scene.add(new THREE.HemisphereLight("#ffffff", "#bfe9dc", 1.1));
      const key = new THREE.DirectionalLight("#fff6ea", 2.2);
      key.position.set(3, 5, 5);
      scene.add(key);
      const rim = new THREE.DirectionalLight("#2fe0c4", 2.4);
      rim.position.set(-4, 3, -4);
      scene.add(rim);
      scene.add(agent.root, agent.shadow, agent.halo, agent.particles);

      const pointer = { x: 0, y: 0 };
      const onMove = (e) => {
        const r = mount.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height * 0.3;
        pointer.x = Math.max(-1, Math.min(1, (e.clientX - cx) / 500));
        pointer.y = Math.max(-1, Math.min(1, (e.clientY - cy) / 400));
      };
      window.addEventListener("pointermove", onMove, { passive: true });

      let visible = true;
      const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
      io.observe(mount);

      let raf;
      let last = 0;
      let prev = performance.now();
      const frame = (dt) => {
        const st = stateRef.current;
        agent.update(dt, { hover: st.hover, open: st.open, pointer });
        aim(agent.root.position.y);
        renderer.render(scene, camera);
      };
      const loop = (now) => {
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden) { prev = now; return; }
        if (now - last < 1000 / 50) return; // не більше 50 кадрів/с
        last = now;
        frame((now - prev) / 1000);
        prev = now;
      };
      if (still) frame(1 / 60);
      else raf = requestAnimationFrame(loop);

      stateRef.current.poke = () => { if (still) frame(1 / 60); else agent.play("jump"); };
      stateRef.current.redraw = () => { if (still) frame(1 / 60); };
      cleanup = () => {
        cancelAnimationFrame(raf);
        io.disconnect();
        window.removeEventListener("pointermove", onMove);
        agent.dispose();
        env.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    };
    // Спершу сторінка завантажує свої дані, потім — у вільний момент — агент
    const ric = window.requestIdleCallback;
    let idle = null;
    const delay = setTimeout(() => { idle = ric ? ric(start, { timeout: 3000 }) : setTimeout(start, 0); }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(delay);
      if (idle !== null) { if (ric) window.cancelIdleCallback(idle); else clearTimeout(idle); }
      cleanup();
    };
  }, [size.w, size.h]);

  return (
    <button
      type="button"
      ref={mountRef}
      onClick={() => { stateRef.current.poke?.(); onActivate(); }}
      onPointerEnter={() => { stateRef.current.hover = true; stateRef.current.redraw?.(); }}
      onPointerLeave={() => (stateRef.current.hover = false)}
      className="relative block rounded-3xl focus-visible:outline-2"
      // м'яке бірюзове світіння за спиною — темний костюм не зливається з темною темою
      style={{ width: size.w, height: size.h, background: "radial-gradient(52% 44% at 50% 52%, rgba(47,224,196,0.16), rgba(47,224,196,0) 72%)" }}
      aria-label={hint}
      title={hint}
    />
  );
}

const TIPS = [
  { icon: Search, title: "Знайти приклад", text: "Предмети → розділ (лабораторні, практичні…) → потрібне завдання.", to: "/subjects" },
  { icon: Upload, title: "Подати свою роботу", text: "На сторінці завдання — «Подати свій варіант». Після перевірки її побачать інші.", to: "/submissions" },
  { icon: HelpCircle, title: "Поставити питання", text: "Предмет → вкладка «Питання». Можна прив'язати до конкретної роботи.", to: "/subjects" },
  { icon: BookOpen, title: "Підписатися на предмети", text: "Дедлайни ваших предметів з'являться на головній.", to: "/subjects" },
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
      {!config?.ai_enabled ? (
        <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5 mb-2 bg-white/30 dark:bg-white/5 border border-white/30 dark:border-white/10">
          <span className="w-9 h-9 rounded-xl grid place-items-center text-[#0b2a1f] shrink-0" style={{ background: "linear-gradient(135deg,#2fe0c4,#bef248)" }}><KeyRound size={17} /></span>
          <span className="flex-1 min-w-0 text-sm"><b>AI-помічник</b><span className="block text-xs text-muted">Відкриється незабаром</span></span>
          <SoonChip />
        </div>
      ) : (
      <form onSubmit={ask} className="flex gap-2 mb-2">
        <input ref={inputRef} className="input h-10 rounded-full bg-surface/70" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Запитай про завдання…" aria-label="Запитання до AI" />
        <button className="btn-accent h-10 w-10 p-0 shrink-0" aria-label="Запитати AI" disabled={!q.trim()}><Sparkles size={16} /></button>
      </form>
      )}
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
      <AgentCanvas size={size} open={state === "open"} onActivate={() => (state === "open" ? close() : open())} hint="Агент підтримки UniPars — натисніть, щоб отримати допомогу" />
      {state !== "closed" && <HelpPanel anchor={anchor} state={state} onClose={close} compact={compact} />}
    </div>
  );
}
