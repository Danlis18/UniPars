import { lazy, Suspense, useCallback, useState } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider, useSession } from "./session.jsx";
import { API_ORIGIN } from "../lib/api.js";
import { ErrorState, Loading, UiProvider } from "../components/ui.jsx";
import IntroLoader from "../components/IntroLoader.jsx";
import Layout from "../components/Layout.jsx";
import LoginPage from "../features/auth/LoginPage.jsx";
import Onboarding from "../features/auth/Onboarding.jsx";
import { HomePage, SavedPage } from "../features/feed/pages.jsx";
import TaskPage from "../features/tasks/TaskPage.jsx";
import { MySubmissionsPage } from "../features/tasks/SubmissionsPages.jsx";
import { BillingPage, JarPaymentPage, MockCheckoutPage, PaymentReturnPage, RegenerationPage } from "../features/billing/pages.jsx";
import { SubjectPage, SubjectsPage } from "../features/subjects/pages.jsx";
import PostPage from "../features/posts/PostPage.jsx";
import { NotificationsPage, SettingsPage } from "../features/profile/pages.jsx";
import UserProfile from "../features/profile/UserProfile.jsx";
import LegalPage from "../features/legal/LegalPage.jsx";

const LEGAL = ["/privacy", "/terms", "/offer"];

const AIPage = lazy(() => import("../features/ai/AIPage.jsx"));
const AdminPage = lazy(() => import("../features/admin/AdminPage.jsx"));
const MessagesPage = lazy(() => import("../features/messages/MessagesPage.jsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => n < 2 && ![401, 403, 404].includes(e?.status), refetchOnWindowFocus: false },
  },
});

function Gate() {
  const s = useSession();
  if (s.authLoading) return null;
  if (s.configError) return (
    <div className="min-h-dvh grid place-items-center p-4">
      <div className="max-w-lg">
        <ErrorState error={{ message: `Сервер UniPars недоступний. ${s.configError.message}` }} onRetry={() => location.reload()} />
        <p className="text-xs text-muted text-center">
          Адреса backend: <code className="break-all">{API_ORIGIN}/api</code>. Якщо вона неправильна — змініть VITE_API_URL і зробіть Redeploy frontend.
        </p>
      </div>
    </div>
  );
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
  // Публічні сторінки — без входу й без заставки (їх перевіряє Google під час публікації OAuth)
  { path: "/privacy", element: <LegalPage kind="privacy" /> },
  { path: "/terms", element: <LegalPage kind="terms" /> },
  { path: "/offer", element: <LegalPage kind="offer" /> },
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
          { path: "/tasks/:id", element: <TaskPage /> },
          { path: "/submissions", element: <MySubmissionsPage /> },
          { path: "/billing", element: <BillingPage /> },
          { path: "/billing/checkout/:id", element: <MockCheckoutPage /> },
          { path: "/billing/pay/:id", element: <JarPaymentPage /> },
          { path: "/billing/return/:id", element: <PaymentReturnPage /> },
          { path: "/regenerations/:id", element: <RegenerationPage /> },
          // Старі розділи об'єднано з «Предметами»
          { path: "/materials", element: <Navigate to="/subjects" replace /> },
          { path: "/questions", element: <Navigate to="/subjects" replace /> },
          { path: "/p/:id", element: <PostPage /> },
          { path: "/ai", element: <AIPage /> },
          { path: "/saved", element: <SavedPage /> },
          { path: "/notifications", element: <NotificationsPage /> },
          { path: "/messages", element: <MessagesPage /> },
          { path: "/messages/:id", element: <MessagesPage /> },
          { path: "/profile", element: <Navigate to="/u/me" replace /> },
          { path: "/u/:id", element: <UserProfile /> },
          { path: "/settings", element: <SettingsPage /> },
          { path: "/admin", element: <AdminPage /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

function AppWithIntro() {
  const { authLoading } = useSession();
  const [intro, setIntro] = useState(() => !LEGAL.includes(window.location.pathname));
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
