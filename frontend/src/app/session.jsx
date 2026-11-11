import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, configureApi, setActiveUniversity } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import { applyTheme, local } from "../lib/storage.js";

const SessionContext = createContext(null);
const DEMO_KEY = "unipars.demoUser";

export function SessionProvider({ children }) {
  const qc = useQueryClient();
  const [sbSession, setSbSession] = useState(undefined); // undefined = ще завантажується
  const [demoUser, setDemoUser] = useState(() => local.get(DEMO_KEY));

  const config = useQuery({ queryKey: ["config"], queryFn: () => api("/config"), staleTime: Infinity, retry: 1 });
  const isDemo = config.data?.mode === "demo";

  useEffect(() => {
    if (!supabase) return setSbSession(null);
    supabase.auth.getSession().then(({ data }) => setSbSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setSbSession(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  const token = isDemo ? (demoUser ? `demo:${demoUser}` : null) : sbSession?.access_token ?? null;

  const signOut = useCallback(async () => {
    local.remove(DEMO_KEY);
    setDemoUser(null);
    if (supabase && sbSession) await supabase.auth.signOut();
    setActiveUniversity(null);
    qc.clear();
  }, [qc, sbSession]);

  useEffect(() => {
    configureApi({
      getToken: async () => {
        if (isDemo) return demoUser ? `demo:${demoUser}` : null;
        if (!supabase) return null;
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      },
      onAuthError: () => {
        if (isDemo) {
          local.remove(DEMO_KEY);
          setDemoUser(null);
        }
      },
    });
  }, [isDemo, demoUser]);

  const me = useQuery({
    queryKey: ["me", token],
    queryFn: () => api("/me"),
    enabled: Boolean(token) && config.isSuccess,
    staleTime: 60_000,
  });

  const activeUniversityId = me.data?.active_university_id ?? null;
  setActiveUniversity(activeUniversityId); // синхронно, до запитів дочірніх компонентів

  useEffect(() => {
    // Тема з профілю застосовується, лише якщо на цьому пристрої її ще не обирали
    let hasLocal = false;
    try { hasLocal = localStorage.getItem("unipars.theme") !== null; } catch {}
    if (me.data?.theme && !hasLocal) applyTheme(me.data.theme);
  }, [me.data?.theme]);

  const switchUniversity = useCallback(
    async (id) => {
      const updated = await api("/me", { method: "PATCH", body: { active_university_id: id } });
      setActiveUniversity(id);
      qc.setQueryData(["me", token], updated);
      await qc.invalidateQueries({ predicate: (q) => !["me", "config"].includes(q.queryKey[0]) });
    },
    [qc, token],
  );

  const loginDemo = useCallback((id) => {
    local.set(DEMO_KEY, id);
    setDemoUser(id);
  }, []);

  const value = useMemo(() => {
    const membership = me.data?.memberships?.find((m) => m.university_id === activeUniversityId) ?? null;
    const role = me.data?.is_platform_admin ? "admin" : membership?.role ?? null;
    return {
      config: config.data,
      configError: config.error,
      isDemo,
      authLoading: config.isLoading || (!isDemo && sbSession === undefined) || (Boolean(token) && me.isLoading),
      isAuthed: Boolean(token) && Boolean(me.data),
      me: me.data,
      meError: me.error,
      refreshMe: () => qc.invalidateQueries({ queryKey: ["me"] }),
      activeUniversityId,
      membership,
      role,
      isStaff: role === "admin" || role === "moderator",
      isAdmin: role === "admin",
      needsOnboarding: Boolean(me.data) && (!membership || !membership.onboarded),
      switchUniversity,
      signOut,
      loginDemo,
    };
  }, [config.data, config.error, config.isLoading, isDemo, sbSession, token, me.data, me.error, me.isLoading,
      activeUniversityId, switchUniversity, signOut, loginDemo, qc]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
