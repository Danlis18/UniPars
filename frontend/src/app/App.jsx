import { lazy, Suspense, useCallback, useState } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider, useSession } from "./session.jsx";
import { ErrorState, Loading, UiProvider } from "../components/ui.jsx";
import IntroLoader from "../components/IntroLoader.jsx";
import Layout from "../components/Layout.jsx";
import LoginPage from "../features/auth/LoginPage.jsx";
import Onboarding from "../features/auth/Onboarding.jsx";
import { HomePage, MaterialsPage, QuestionsPage, SavedPage } from "../features/feed/pages.jsx";
import { SubjectPage, SubjectsPage } from "../features/subjects/pages.jsx";
import PostPage from "../features/posts/PostPage.jsx";
import { NotificationsPage, ProfilePage } from "../features/profile/pages.jsx";

const AIPage = lazy(() => import("../features/ai/AIPage.jsx"));
const AdminPage = lazy(() => import("../features/admin/AdminPage.jsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => n < 2 && ![401, 403, 404].includes(e?.status), refetchOnWindowFocus: false },
  },
});

function Gate() {
  const s = useSession();
  if (s.authLoading) return null;
  if (s.configError) return <div className="min-h-dvh grid place-items-center"><ErrorState error={{ message: "Сервер UniPars недоступний. Запустіть backend (див. README)." }} onRetry={() => location.reload()} /></div>;
  if (!s.isAuthed) return <LoginPage />;
  return <Outlet />;
}

function RequireOnboarded() {
  const { needsOnboarding } = useSession();
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;
  return (
    <Suspense fallback={<Loading />}>
      <Layout />
    </Suspense>
  );
}

function Root() {
  return (
    <>
      <ScrollRestoration getKey={(loc) => loc.pathname + loc.search} />
      <Gate />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/onboarding", element: <Onboarding /> },
      {
        element: <RequireOnboarded />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/subjects", element: <SubjectsPage /> },
          { path: "/subjects/:slug", element: <SubjectPage /> },
          { path: "/materials", element: <MaterialsPage /> },
          { path: "/questions", element: <QuestionsPage /> },
          { path: "/p/:id", element: <PostPage /> },
          { path: "/ai", element: <AIPage /> },
          { path: "/saved", element: <SavedPage /> },
          { path: "/notifications", element: <NotificationsPage /> },
          { path: "/profile", element: <ProfilePage /> },
          { path: "/admin", element: <AdminPage /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

function AppWithIntro() {
  const { authLoading } = useSession();
  const [intro, setIntro] = useState(true);
  const done = useCallback(() => setIntro(false), []);
  return (
    <>
      <RouterProvider router={router} />
      {intro && <IntroLoader ready={!authLoading} onDone={done} />}
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <UiProvider>
          <AppWithIntro />
        </UiProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
