"""Монтаж демовідео UniPars із записаних сесій (record.mjs).

python build.py <папка запису> <робоча папка> <папка результату>
Потрібні: ffmpeg, numpy, edge-tts (голос uk-UA-PolinaNeural).
Результат: unipars-demo-voice.mp4, unipars-demo-music.mp4, unipars-voiceover.txt
"""
from __future__ import annotations

import asyncio
import json
import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

RAW, WORK, OUT = (Path(p) for p in sys.argv[1:4])
WORK.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
EV = json.loads((RAW / "events.json").read_text(encoding="utf-8"))
FPS, XF, SR = 30, 0.4, 48000
VOICE = "uk-UA-PolinaNeural"


def M(src: str, label: str) -> float:
    return next(m["t"] for m in EV[src]["marks"] if m["label"] == label)


# Сцени: частини (джерело, від, до, прискорення), підпис сцени, озвучка
SCENES = [
    dict(id="intro", parts=[("logo", 0.3, 2.9, 1)], label="", voice=""),
    dict(id="login", parts=[("danylo", M("danylo", "login") - 0.1, M("danylo", "onboarding") - 0.2, 1)], label="Вхід в акаунт",
         voice="Це UniPars — платформа взаємодопомоги студентів. Данило входить в акаунт: пошта й пароль."),
    dict(id="onboarding", parts=[("danylo", M("danylo", "onboarding") - 0.2, M("danylo", "home"), 1.45)], label="Налаштування: F2 · 1 курс · ФЕП-11",
         voice="Новий акаунт налаштовується за хвилину: факультет, спеціальність F2, перший курс, група ФЕП-11 і предмети курсу."),
    dict(id="home", parts=[("danylo", M("danylo", "home"), M("danylo", "news-closed") - 0.2, 1)], label="Головна: дедлайни й новини",
         voice="На головній — найближчі дедлайни та новини факультету."),
    dict(id="task", parts=[("danylo", M("danylo", "news-closed") + 0.4, M("danylo", "preview-closed") - 0.2, 1.25)], label="Предмет і лабораторна",
         voice="У предметі — лабораторні, практичні, модулі й екзамени. У лабораторній: умова, методичка й схвалені приклади. PDF відкривається просто в браузері."),
    dict(id="ask", parts=[("danylo", M("danylo", "forum") - 0.6, M("danylo", "ask") + 0.8, 1),
                          ("danylo", M("danylo", "ask") + 0.8, M("danylo", "asked") - 2.4, 2.6),
                          ("danylo", M("danylo", "asked") - 2.4, M("danylo", "asked") + 1.3, 1)], label="Форум предмета · Данило",
         voice="Є питання? Данило ставить його на форумі предмета й прив'язує до лабораторної."),
    dict(id="sofia", parts=[("sofiia", M("sofiia", "thread") - 1.0, M("sofiia", "thread") + 0.8, 1),
                            ("sofiia", M("sofiia", "thread") + 0.8, M("sofiia", "answered") - 0.6, 2.4),
                            ("sofiia", M("sofiia", "answered") - 0.6, M("sofiia", "answered") + 1.2, 1)], label="Інший браузер · Софія",
         voice="Софія відповідає зі свого акаунта."),
    dict(id="answer", parts=[("danylo", M("danylo", "reloaded"), M("danylo", "reloaded") + 1.6, 1),
                             ("danylo", M("danylo", "reloaded") + 1.6, M("danylo", "dialog-final") - 1.2, 2.4),
                             ("danylo", M("danylo", "dialog-final") - 1.2, M("danylo", "dialog-final") + 3.0, 1)], label="Данило · відповідь",
         voice="Данило бачить відповідь і дякує. Розмова лишається в предметі для всіх."),
    dict(id="submit", parts=[("danylo", M("danylo", "task2") + 0.3, M("danylo", "pending") + 2.0, 1.2)], label="Подання роботи",
         voice="Свій звіт Данило подає зі сторінки завдання — можна навіть анонімно. Статус: «На розгляді»."),
    dict(id="admin", parts=[("admin", M("admin", "queue") - 0.3, M("admin", "approved") + 1.2, 1.3)], label="Модерація · адміністратор",
         voice="Адміністратор переглядає файл і схвалює."),
    dict(id="notify", parts=[("danylo", M("danylo", "published"), M("danylo", "notifications") + 3.2, 1.1)], label="Опубліковано · сповіщення",
         voice="Робота з'являється біля завдання, а в сповіщеннях — і публікація, і відповідь Софії."),
    dict(id="dm", parts=[("danylo", M("danylo", "profile"), M("danylo", "dm") + 0.5, 1),
                         ("danylo", M("danylo", "dm") + 0.5, M("danylo", "dm-sent") - 0.3, 2.2),
                         ("danylo", M("danylo", "dm-sent") - 0.3, M("danylo", "dm-sent") + 0.9, 1)], label="Особисті повідомлення",
         voice="Однокурсники можуть писати одне одному в особисті повідомлення."),
    dict(id="dm-reply", parts=[("sofiia", M("sofiia", "inbox"), M("sofiia", "dm-open") + 0.4, 1),
                               ("sofiia", M("sofiia", "dm-open") + 0.4, M("sofiia", "dm-replied") - 0.3, 2.2),
                               ("sofiia", M("sofiia", "dm-replied") - 0.3, M("sofiia", "dm-replied") + 0.6, 1),
                               ("danylo", M("danylo", "dm-received") - 0.2, M("danylo", "dm-received") + 2.0, 1)], label="Чат у реальному часі",
         voice="Софія відповідає — і Данило бачить повідомлення одразу."),
    dict(id="buy", parts=[("danylo", M("danylo", "buy") - 0.3, M("danylo", "end") - 0.1, 1)], label="«Купити звіт» · скоро",
         voice="«Купити звіт» — поки анонс: скоро тут можна буде замовити окремий варіант."),
    dict(id="mobile", parts=[("mobile", M("mobile", "home") - 0.3, M("mobile", "end"), 1.8)], label="Мобільна версія",
         voice="І все це — на телефоні."),
    dict(id="outro", parts=[("logo", 0.8, 3.3, 1)], label="", voice="UniPars. Знайти, запитати, поділитися."),
]


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        print(r.stderr[-3000:])
        raise SystemExit(f"ffmpeg error: {' '.join(cmd[:6])}…")


def dur(p: Path) -> float:
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]).decode())


# ---------- 1. Озвучка ----------
async def tts() -> None:
    import edge_tts
    for sc in SCENES:
        f = WORK / f"vo_{sc['id']}.mp3"
        if sc["voice"] and not f.exists():
            await edge_tts.Communicate(sc["voice"], VOICE, rate="+6%").save(str(f))

asyncio.run(tts())
for sc in SCENES:
    sc["vo"] = dur(WORK / f"vo_{sc['id']}.mp3") if sc["voice"] else 0.0

# ---------- 2. Кліпи сцен ----------
BG = WORK / "mobile_bg.png"
if not BG.exists():  # фон для мобільної сцени: темний градієнт у фірмових кольорах
    y, x = np.mgrid[0:1080, 0:1920].astype(np.float32)
    g1 = np.exp(-(((x - 1450) / 650) ** 2 + ((y - 250) / 450) ** 2))
    g2 = np.exp(-(((x - 380) / 520) ** 2 + ((y - 900) / 420) ** 2))
    img = np.stack([10 + 10 * g1 + 18 * g2, 18 + 70 * g1 + 40 * g2, 15 + 62 * g1 + 18 * g2], -1).clip(0, 255).astype(np.uint8)
    (WORK / "mobile_bg.rgb").write_bytes(img.tobytes())
    run(["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1920x1080", "-i", str(WORK / "mobile_bg.rgb"), str(BG)])

clips = []
for sc in SCENES:
    parts = []
    for i, (src, a, b, sp) in enumerate(sc["parts"]):
        p = WORK / f"part_{sc['id']}_{i}.mp4"
        if src == "mobile":
            # телефон у центрі кадру з рамкою
            vf = (f"[1:v]trim={a:.3f}:{b:.3f},setpts=(PTS-STARTPTS)/{sp},fps={FPS},scale=-2:940:flags=lanczos,"
                  f"pad=iw+28:ih+28:14:14:color=0x05110d,format=yuv420p[ph];[0:v][ph]overlay=(W-w)/2:(H-h)/2+6,format=yuv420p")
            run(["ffmpeg", "-y", "-loop", "1", "-i", str(BG), "-i", str(RAW / f"{src}.webm"), "-filter_complex", vf,
                 "-t", f"{(b - a) / sp:.3f}", "-r", str(FPS), "-c:v", "libx264", "-crf", "15", "-preset", "fast", "-an", str(p)])
        else:
            vf = f"trim={a:.3f}:{b:.3f},setpts=(PTS-STARTPTS)/{sp},fps={FPS},scale=1920:1080:flags=lanczos,unsharp=5:5:0.35,format=yuv420p"
            run(["ffmpeg", "-y", "-i", str(RAW / f"{src}.webm"), "-vf", vf, "-c:v", "libx264", "-crf", "15", "-preset", "fast", "-an", str(p)])
        parts.append(p)
    # склеюємо частини сцени; якщо озвучка довша — тримаємо останній кадр
    listf = WORK / f"list_{sc['id']}.txt"
    listf.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    raw_d = sum((b - a) / sp for _, a, b, sp in sc["parts"])
    need = max(raw_d, sc["vo"] + 1.1 + (XF if sc["voice"] else 0))
    out = WORK / f"scene_{sc['id']}.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listf), "-vf", f"tpad=stop_mode=clone:stop_duration={max(0, need - raw_d):.3f},fps={FPS}",
         "-c:v", "libx264", "-crf", "15", "-preset", "fast", str(out)])
    sc["dur"] = dur(out)
    sc["raw_d"] = raw_d
    clips.append(out)

# Таймлайн з урахуванням переходів
t = 0.0
for i, sc in enumerate(SCENES):
    sc["start"] = t
    t += sc["dur"] - (XF if i < len(SCENES) - 1 else 0)
TOTAL = t
print(f"тривалість: {TOTAL:.1f} с")

# ---------- 3. Склейка з переходами ----------
video = WORK / "video_nosubs.mp4"
inputs, chain, prev = [], [], "0:v"
for c in clips:
    inputs += ["-i", str(c)]
for i in range(1, len(clips)):
    off = SCENES[i]["start"]
    trans = "fadeblack" if SCENES[i]["id"] in ("sofia", "admin", "mobile", "outro") else "fade"
    chain.append(f"[{prev}][{i}:v]xfade=transition={trans}:duration={XF}:offset={off:.3f}[v{i}]")
    prev = f"v{i}"
run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(chain), "-map", f"[{prev}]", "-c:v", "libx264", "-crf", "16",
     "-preset", "medium", "-pix_fmt", "yuv420p", str(video)])

# ---------- 4. Субтитри ----------
def ts(x: float) -> str:
    x = max(0.0, x)
    return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"


def ass(with_subs: bool) -> Path:
    lines = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 0", "",
             "[V4+ Styles]",
             "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
             "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
             "Style: Label,Segoe UI Semibold,36,&H00FFFFFF,&H00FFFFFF,&H400E1F18,&H400E1F18,1,0,0,0,100,100,0,0,3,14,0,8,60,60,22,1",
             "Style: Sub,Segoe UI,46,&H00FFFFFF,&H00FFFFFF,&H40000000,&H40000000,0,0,0,0,100,100,0,0,3,16,0,2,220,220,64,1",
             "Style: Big,Segoe UI Semibold,62,&H00FFFFFF,&H00FFFFFF,&H5A0E1F18,&H5A0E1F18,1,0,0,0,100,100,0,0,3,24,0,5,100,100,0,1",
             "Style: Title,Segoe UI Semibold,54,&H00DCF55F,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,2,100,100,150,1",
             "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    for i, sc in enumerate(SCENES):
        a = sc["start"] + (XF if i else 0) + 0.15
        b = sc["start"] + sc["dur"] - 0.25
        if sc["id"] == "start":
            lines.append(f"Dialogue: 1,{ts(a)},{ts(b)},Big,,0,0,0,,{{\\fad(350,250)}}З чого почати\\N{{\\fs46}}Предмети  →  Завдання  →  Матеріали")
        elif sc["label"]:
            lines.append(f"Dialogue: 0,{ts(a)},{ts(b)},Label,,0,0,0,,{{\\fad(300,200)}}{sc['label']}")
        if sc["id"] == "outro":
            lines.append(f"Dialogue: 0,{ts(a + 0.6)},{ts(b)},Title,,0,0,0,,{{\\fad(400,400)}}Знайти. Запитати. Поділитися.")
        if with_subs and sc["voice"] and sc["id"] != "outro":
            # субтитри з тексту озвучки: по реченнях, рівномірно за тривалістю голосу
            import re
            sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", sc["voice"]) if s.strip()]
            v0, total = a + 0.15, sc["vo"] or (b - a)
            weights = [len(s) for s in sents]
            for j, (s, w) in enumerate(zip(sents, weights)):
                d = max(1.6, total * w / sum(weights))
                end = b if j == len(sents) - 1 else v0 + d  # речення не накладаються одне на одне
                lines.append(f"Dialogue: 0,{ts(v0)},{ts(min(end, b))},Sub,,0,0,0,,{{\\fad(150,150)}}{s}")
                v0 += d
    p = WORK / ("subs_music.ass" if with_subs else "subs_voice.ass")
    p.write_text("\n".join(lines), encoding="utf-8-sig")
    return p


# ---------- 5. Музика (синтез, без сторонніх ліцензій) і кліки ----------
def music(seconds: float) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    bpm, beat = 84, 60 / 84
    chords = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]]  # Am F C G
    f = lambda m: 440 * 2 ** ((m - 69) / 12)  # noqa: E731
    out = np.zeros(n, np.float32)
    bar = beat * 4
    for k in range(int(seconds / bar) + 1):
        ch = chords[k % 4]
        s0, s1 = int(k * bar * SR), min(n, int((k + 1) * bar * SR + 0.6 * SR))
        if s0 >= n:
            break
        tt = t[s0:s1] - k * bar
        env = np.minimum(1, tt / 0.9) * np.exp(-np.maximum(0, tt - bar) * 2.5)
        pad = sum(np.sin(2 * np.pi * f(m) * tt + 0.3 * np.sin(2 * np.pi * 0.25 * tt)) * (0.5 if j else 0.8) for j, m in enumerate(ch))
        out[s0:s1] += 0.055 * env * pad
        bass = np.sin(2 * np.pi * f(ch[0] - 12) * tt) * np.exp(-tt * 0.9)
        out[s0:s1] += 0.06 * bass
        for st in range(8):  # мʼяке арпеджіо восьмими
            a0 = s0 + int(st * beat / 2 * SR)
            if a0 >= n:
                break
            L = min(int(0.9 * SR), n - a0)
            tn = np.arange(L) / SR
            note = ch[[0, 1, 2, 3, 2, 1, 2, 3][st]] + 12
            out[a0:a0 + L] += 0.028 * np.sin(2 * np.pi * f(note) * tn) * np.exp(-tn * 4.5) * (0.6 + 0.4 * (st % 2 == 0))
    fade = np.minimum(1, t / 2.5) * np.minimum(1, (seconds - t) / 3.0)
    out *= fade
    # проста реверберація
    for d, g in ((0.11, 0.35), (0.23, 0.22), (0.37, 0.14)):
        k = int(d * SR)
        out[k:] += g * out[:-k]
    return out / (np.abs(out).max() + 1e-9) * 0.5


def click_track(seconds: float) -> np.ndarray:
    n = int(seconds * SR)
    out = np.zeros(n, np.float32)
    L = int(0.03 * SR)
    tt = np.arange(L) / SR
    rng = np.random.default_rng(1)
    clk = (0.6 * np.sin(2 * np.pi * 2300 * tt) + 0.4 * rng.standard_normal(L)) * np.exp(-tt * 260)
    for i, sc in enumerate(SCENES):
        pos = sc["start"]
        for src, a, b, sp in sc["parts"]:
            for c in EV[src]["clicks"]:
                if a <= c < b:
                    x = pos + (c - a) / sp
                    s = int(x * SR)
                    if 0 <= s < n - L and (i == 0 or x > sc["start"] + XF):
                        out[s:s + L] += 0.35 * clk
            pos += (b - a) / sp
    return out


def wav(p: Path, a: np.ndarray) -> None:
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())


wav(WORK / "music.wav", music(TOTAL))
wav(WORK / "clicks.wav", click_track(TOTAL))

# Доріжка голосу: кожна фраза на початку своєї сцени
vo_inputs, vo_filters = [], []
k = 0
for i, sc in enumerate(SCENES):
    if sc["voice"]:
        vo_inputs += ["-i", str(WORK / f"vo_{sc['id']}.mp3")]
        delay = int((sc["start"] + (XF if i else 0) + 0.3) * 1000)
        vo_filters.append(f"[{k}:a]aresample={SR},adelay={delay}|{delay}[a{k}]")
        k += 1
run(["ffmpeg", "-y", *vo_inputs, "-filter_complex", ";".join(vo_filters) + ";" + "".join(f"[a{j}]" for j in range(k)) +
     f"amix=inputs={k}:normalize=0,apad,atrim=0:{TOTAL:.3f}[v]", "-map", "[v]", "-ac", "1", "-ar", str(SR), str(WORK / "voice.wav")])

# ---------- 6. Фінальні версії ----------
def final(name: str, subs: Path, with_voice: bool) -> None:
    sub = subs.as_posix().replace(":", "\\:")
    if with_voice:
        af = ("[1:a]volume=0.55[m];[3:a]volume=1.0,asplit=2[vo][key];"
              "[m][key]sidechaincompress=threshold=0.02:ratio=9:attack=60:release=450[md];"
              "[2:a]volume=0.8[c];[md][vo][c]amix=inputs=3:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]")
        ins = ["-i", str(video), "-i", str(WORK / "music.wav"), "-i", str(WORK / "clicks.wav"), "-i", str(WORK / "voice.wav")]
    else:
        af = "[1:a]volume=0.8[m];[2:a]volume=0.8[c];[m][c]amix=inputs=2:normalize=0,loudnorm=I=-18:TP=-1.5:LRA=11[a]"
        ins = ["-i", str(video), "-i", str(WORK / "music.wav"), "-i", str(WORK / "clicks.wav")]
    run(["ffmpeg", "-y", *ins, "-filter_complex", f"[0:v]ass='{sub}'[v];{af}", "-map", "[v]", "-map", "[a]",
         "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
         "-ar", str(SR), "-movflags", "+faststart", str(OUT / name)])


final("unipars-demo-voice.mp4", ass(False), True)
final("unipars-demo-music.mp4", ass(True), False)

# ---------- 7. Текст озвучки з таймкодами ----------
txt = ["UniPars — текст озвучки демовідео", f"Голос: {VOICE} (синтез). Тривалість відео: {int(TOTAL // 60)}:{int(TOTAL % 60):02d}", ""]
for i, sc in enumerate(SCENES):
    a = sc["start"] + (XF if i else 0)
    head = f"[{int(a // 60)}:{a % 60:04.1f}–{int((a + sc['dur']) // 60)}:{(a + sc['dur']) % 60:04.1f}] {sc['label'] or ('Заставка' if i == 0 else 'Фінал')}"
    txt += [head, sc["voice"] or "(музика)", ""]
(OUT / "unipars-voiceover.txt").write_text("\n".join(txt), encoding="utf-8")
(WORK / "timeline.json").write_text(json.dumps([{k: sc[k] for k in ("id", "start", "dur", "vo", "raw_d")} for sc in SCENES], ensure_ascii=False, indent=1), encoding="utf-8")
print("готово:", ", ".join(p.name for p in OUT.iterdir()))
