import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { supabase } from "../../lib/supabase.js";
import { useSession } from "../../app/session.jsx";
import { Logo } from "../../components/Logo.jsx";
import { DemoBadge, ErrorState, Loading } from "../../components/ui.jsx";

function DemoLogin() {
  const { loginDemo } = useSession();
  const users = useQuery({ queryKey: ["demo-users"], queryFn: () => api("/demo/users") });
  if (users.isLoading) return <Loading />;
  if (users.isError) return <ErrorState error={users.error} onRetry={users.refetch} />;
  return (
    <>
      <div className="flex items-center gap-2 mb-1"><h1 className="font-display text-xl">Демо-режим</h1><DemoBadge /></div>
      <p className="text-sm text-muted mb-4">
        Supabase не підключено, тому працюють демонстраційні дані. Оберіть демо-користувача — так можна перевірити ролі та ізоляцію університетів.
      </p>
      <ul className="space-y-2">
        {users.data.map((u) => (
          <li key={u.id}>
            <button className="w-full text-left card p-3 hover:border-primary" onClick={() => loginDemo(u.id)}>
              <div className="font-semibold">{u.display_name}</div>
              <div className="text-xs text-muted">{u.note} · {u.university}</div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function SupabaseLogin() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error, data } = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } });
    setBusy(false);
    if (error) setMsg({ error: true, text: error.message });
    else if (mode === "signup" && !data.session) setMsg({ text: "Перевірте пошту, щоб підтвердити реєстрацію." });
  };
  return (
    <>
      <h1 className="font-display text-xl mb-4">{mode === "signin" ? "Вхід" : "Реєстрація"}</h1>
      <form onSubmit={submit} className="space-y-3">
        {mode === "signup" && <div><label className="label" htmlFor="l-name">Ім'я</label><input id="l-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>}
        <div><label className="label" htmlFor="l-email">Email</label><input id="l-email" type="email" autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="label" htmlFor="l-pass">Пароль</label><input id="l-pass" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {msg && <div className={`text-sm ${msg.error ? "text-danger" : "text-primary"}`} role="alert">{msg.text}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Зачекайте…" : mode === "signin" ? "Увійти" : "Створити акаунт"}</button>
      </form>
      <button className="mt-4 text-sm text-primary hover:underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "Немає акаунта? Зареєструватися" : "Вже є акаунт? Увійти"}
      </button>
    </>
  );
}

export default function LoginPage() {
  const { isDemo } = useSession();
  return (
    <div className="min-h-dvh grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[#0f2a20] text-white relative overflow-hidden">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-[radial-gradient(circle,#2fe0c455,transparent_70%)]" />
        <div className="absolute -bottom-40 -left-24 w-[28rem] h-[28rem] rounded-full bg-[radial-gradient(circle,#bef24833,transparent_70%)]" />
        <Logo onDark />
        <div>
          <h2 className="font-display text-4xl leading-tight mb-4 relative">Знайти. Запитати.<br /><span className="text-brand-light">Поділитися.</span></h2>
          <p className="opacity-80 max-w-md">Конспекти, лабораторні, підготовка до іспитів і відповіді однокурсників — в одному місці, впорядковано за предметами та темами.</p>
        </div>
        <div className="text-sm opacity-70">UniPars — платформа взаємодопомоги студентів</div>
      </div>
      <div className="grid place-items-center p-4">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8"><Logo /></div>
          {isDemo ? <DemoLogin /> : supabase ? <SupabaseLogin /> : (
            <div className="text-sm text-danger">Вкажіть VITE_SUPABASE_URL і VITE_SUPABASE_ANON_KEY у frontend/.env</div>
          )}
        </div>
      </div>
    </div>
  );
}
