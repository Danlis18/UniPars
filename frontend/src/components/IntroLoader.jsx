import { useEffect, useState } from "react";
import { LOGO_PATH } from "./Logo.jsx";

const DURATION = 3600; // мс до початку зникнення

// Анімація логотипу перед відкриттям застосунку (~4 с).
// Лінія «U» малюється, вузол «спалахує», навколо нього обертаються частинки-знання,
// потім з'являється назва, і заставка розчиняється.
export default function IntroLoader({ ready, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const min = reduced ? 300 : DURATION;
    const start = performance.now();
    let t;
    const tick = () => {
      if (ready && performance.now() - start >= min) {
        setLeaving(true);
        t = setTimeout(onDone, 500);
      } else t = setTimeout(tick, 100);
    };
    tick();
    return () => clearTimeout(t);
  }, [ready, onDone, reduced]);

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center bg-bg transition-all duration-500 ${leaving ? "opacity-0 scale-105 pointer-events-none" : "opacity-100"}`}
      role="status"
      aria-label="Завантаження UniPars"
    >
      <style>{CSS}</style>
      <div className="up-intro flex flex-col items-center">
        <div className="up-stage">
          <div className="up-glow" />
          <svg viewBox="0 0 64 64" className="up-logo" aria-hidden>
            <defs>
              <linearGradient id="intro-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#5ff5dc" />
                <stop offset="0.45" stopColor="#14c4a8" />
                <stop offset="1" stopColor="#a3e635" />
              </linearGradient>
              <filter id="intro-shadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="2.2" stdDeviation="1.6" floodColor="#0f8f86" floodOpacity="0.35" />
              </filter>
            </defs>
            {/* Глибина: «тінь»-копія лінії для об'єму */}
            <path d={LOGO_PATH} className="up-path-depth" pathLength="1" />
            <path d={LOGO_PATH} className="up-path" pathLength="1" stroke="url(#intro-g)" filter="url(#intro-shadow)" />
            <path d={LOGO_PATH} className="up-shine" pathLength="1" />
            <circle cx="32" cy="39.5" r="7" className="up-ripple" />
            <circle cx="32" cy="39.5" r="4" className="up-node" />
            <g className="up-orbit">
              <circle cx="32" cy="30" r="1.3" />
              <circle cx="40.5" cy="44" r="1" />
              <circle cx="23.5" cy="44" r="1.1" />
            </g>
          </svg>
        </div>
        <div className="up-word font-display" aria-hidden>
          {"UniPars".split("").map((ch, i) => (
            <span key={i} style={{ animationDelay: `${1450 + i * 70}ms` }}>{ch}</span>
          ))}
        </div>
        <div className="up-tagline">платформа взаємодопомоги студентів</div>
        <div className="up-bar"><div /></div>
      </div>
    </div>
  );
}

const CSS = `
.up-stage { position: relative; width: 156px; height: 156px; perspective: 600px; }
.up-logo { width: 100%; height: 100%; overflow: visible; animation: up-tilt 3.4s cubic-bezier(.4,0,.2,1) both; transform-style: preserve-3d; }
.up-glow { position: absolute; inset: 18%; border-radius: 50%; background: radial-gradient(circle, rgba(47,224,196,.45), transparent 70%);
  filter: blur(14px); opacity: 0; animation: up-glow 3.4s ease-out both; }
.up-path, .up-path-depth, .up-shine { fill: none; stroke-width: 4.6; stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 1; stroke-dashoffset: 1; }
.up-path { animation: up-draw 1.35s cubic-bezier(.65,0,.35,1) .15s forwards; }
.up-path-depth { stroke: #0b5f59; opacity: .35; transform: translate(1.4px, 2px); animation: up-draw 1.35s cubic-bezier(.65,0,.35,1) .22s forwards; }
.up-shine { stroke: rgba(255,255,255,.85); stroke-width: 1.6; stroke-dasharray: .06 1; animation: up-shine 1.6s ease-in-out 1.4s 1 forwards; }
.up-node { fill: #14c4a8; transform-origin: 32px 39.5px; transform: scale(0); animation: up-pop .55s cubic-bezier(.34,1.56,.64,1) 1.25s forwards; }
.up-ripple { fill: none; stroke: #2fe0c4; stroke-width: 1.2; transform-origin: 32px 39.5px; opacity: 0;
  animation: up-ripple 1.1s ease-out 1.35s 2; }
.up-orbit { fill: #2fe0c4; transform-origin: 32px 39.5px; opacity: 0; animation: up-orbit 2.2s linear 1.5s forwards; }
.up-word { margin-top: 10px; font-size: 40px; font-weight: 600; letter-spacing: -0.02em; color: rgb(var(--ink)); display: flex; }
.up-word span { display: inline-block; opacity: 0; transform: translateY(14px) rotateX(70deg); animation: up-letter .6s cubic-bezier(.2,.8,.2,1) forwards; }
.up-word span:nth-child(n+4) { color: rgb(var(--primary)); }
.up-tagline { margin-top: 4px; font-size: 14px; color: rgb(var(--muted)); opacity: 0; animation: up-fade .6s ease 2.1s forwards; }
.up-bar { margin-top: 22px; width: 160px; height: 3px; border-radius: 99px; background: rgb(var(--line)); overflow: hidden; }
.up-bar > div { height: 100%; width: 100%; transform-origin: left; transform: scaleX(0);
  background: linear-gradient(90deg, #2fe0c4, rgb(var(--lime))); animation: up-progress 3.3s cubic-bezier(.4,0,.2,1) .1s forwards; }
@keyframes up-draw { to { stroke-dashoffset: 0; } }
@keyframes up-shine { from { stroke-dashoffset: 1; opacity: 1; } to { stroke-dashoffset: -0.06; opacity: 0; } }
@keyframes up-pop { 0% { transform: scale(0); } 70% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes up-ripple { 0% { opacity: .9; transform: scale(.6); } 100% { opacity: 0; transform: scale(2.6); } }
@keyframes up-orbit { 0% { opacity: 0; transform: rotate(0) scale(.6); } 15% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; transform: rotate(300deg) scale(1.1); } }
@keyframes up-glow { 0% { opacity: 0; transform: scale(.6); } 45% { opacity: 1; transform: scale(1.1); } 100% { opacity: .55; transform: scale(1); } }
@keyframes up-tilt { 0% { transform: rotateY(-35deg) rotateX(12deg) scale(.86); } 55% { transform: rotateY(12deg) rotateX(-4deg) scale(1.02); } 100% { transform: rotateY(0) rotateX(0) scale(1); } }
@keyframes up-letter { to { opacity: 1; transform: none; } }
@keyframes up-fade { to { opacity: 1; } }
@keyframes up-progress { to { transform: scaleX(1); } }
`;
