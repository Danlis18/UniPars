import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { supabase } from "../../lib/supabase.js";
import { useSession } from "../../app/session.jsx";
import SupabaseAuth, { TestEnvSignIn } from "./AuthForms.jsx";
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

function TestEnvLogin() {
  const { loginDemo } = useSession();
  const signIn = async (email, password) => {
    try {
      const { user_id } = await api("/demo/login", { method: "POST", body: { email, password } });
      loginDemo(user_id);
      return { error: null };
    } catch (e) {
      return { error: { message: e.message } };
    }
  };
  return <TestEnvSignIn signIn={signIn} />;
}

export default function LoginPage() {
  const { isDemo, config } = useSession();
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
        <div className="text-sm opacity-70 flex flex-wrap gap-x-4 gap-y-1">
          <span>UniPars — платформа взаємодопомоги студентів</span>
          <a href="/privacy" className="hover:underline">Конфіденційність</a>
          <a href="/terms" className="hover:underline">Умови</a>
          <a href="/offer" className="hover:underline">Оферта</a>
        </div>
      </div>
      <div className="grid place-items-center p-4">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8"><Logo /></div>
          {isDemo ? (config?.demo_auth === "password" ? <TestEnvLogin /> : <DemoLogin />) : supabase ? <SupabaseAuth /> : (
            <div className="text-sm text-danger">Вкажіть VITE_SUPABASE_URL і VITE_SUPABASE_ANON_KEY у frontend/.env</div>
          )}
        </div>
      </div>
    </div>
  );
}
