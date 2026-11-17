import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Eye, EyeOff, MailCheck, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase, supabaseUrl, supabaseAnonKey } from "../../lib/supabase.js";
import {
  authErrorText, emailError, emailSuggestion, normalizeEmail, passwordChecks, passwordScore, passwordValid,
} from "./validation.js";

// Довжина коду з листа. Має збігатися з Supabase → Authentication → Providers → Email → Email OTP Length.
const OTP_LENGTH = Math.min(Math.max(Number(import.meta.env.VITE_OTP_LENGTH) || 6, 6), 10);
const RESEND_SECONDS = 60;

function Field({ id, label, error, children, hint }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {error ? <p id={`${id}-err`} className="mt-1 text-xs text-danger">{error}</p> : hint}
    </div>
  );
}

function EmailField({ value, onChange, touched, onBlur, autoFocus }) {
  const err = touched ? emailError(value) : null;
  const suggestion = !err && touched ? emailSuggestion(value) : null;
  return (
    <Field id="l-email" label="Email" error={err} hint={suggestion && (
      <p className="mt-1 text-xs text-muted">
        Можливо, <button type="button" className="text-primary hover:underline font-medium" onClick={() => onChange(suggestion)}>{suggestion}</button>?
      </p>
    )}>
      <input
        id="l-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
        className={`input ${err ? "!border-danger" : ""}`} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        aria-invalid={Boolean(err)} aria-describedby={err ? "l-email-err" : undefined} placeholder="name@gmail.com"
      />
    </Field>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id} type={show ? "text" : "password"} autoComplete={autoComplete} className={`input pr-10 ${invalid ? "!border-danger" : ""}`}
        value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} autoFocus={autoFocus}
      />
      <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-1 top-1 h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-ink"
        aria-label={show ? "Сховати пароль" : "Показати пароль"} aria-pressed={show}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

const STRENGTH = [
  { label: "", cls: "bg-line" },
  { label: "Слабкий", cls: "bg-danger" },
  { label: "Нормальний", cls: "bg-amber-400" },
  { label: "Добрий", cls: "bg-primary" },
  { label: "Надійний", cls: "bg-lime" },
];

function NewPasswordField({ id = "l-pass", label = "Пароль", value, onChange, email, touched }) {
  const checks = passwordChecks(value, email);
  const score = passwordScore(value, email);
  const invalid = touched && !passwordValid(value, email);
  return (
    <Field id={id} label={label}>
      <PasswordInput id={id} value={value} onChange={onChange} autoComplete="new-password" invalid={invalid} describedBy={`${id}-rules`} />
      <div className="mt-2 flex items-center gap-2" aria-hidden>
        <div className="flex-1 grid grid-cols-4 gap-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={`h-1 rounded-full transition-colors duration-300 ${score >= i ? STRENGTH[score].cls : "bg-line"}`} />
          ))}
        </div>
        <span className="text-xs text-muted w-20 text-right">{value ? STRENGTH[score].label : ""}</span>
      </div>
      <ul id={`${id}-rules`} className="mt-2 grid gap-1">
        {checks.map((c) => (
          <li key={c.id} className={`flex items-center gap-1.5 text-xs ${c.ok ? "text-primary" : invalid ? "text-danger" : "text-muted"}`}>
            {c.ok ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
            <span>{c.label}</span>
            <span className="sr-only">{c.ok ? "— виконано" : "— не виконано"}</span>
          </li>
        ))}
      </ul>
    </Field>
  );
}

// Код із листа: окремі клітинки, але одне поле вводу — працюють вставка, автозаповнення з SMS/пошти та читачі екрана
function OtpInput({ value, onChange, onComplete, disabled, invalid }) {
  const ref = useRef(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => { ref.current?.focus(); }, []);
  const set = (raw) => {
    const v = raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
    onChange(v);
    if (v.length === OTP_LENGTH) onComplete?.(v);
  };
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref} id="l-otp" value={value} onChange={(e) => set(e.target.value)} disabled={disabled}
        inputMode="numeric" autoComplete="one-time-code" pattern="\d*" maxLength={OTP_LENGTH}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        aria-label={`Код підтвердження, ${OTP_LENGTH} цифр`} aria-invalid={invalid}
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
      />
      <div className="flex justify-between gap-1.5" aria-hidden>
        {Array.from({ length: OTP_LENGTH }, (_, i) => {
          const active = focused && (i === value.length || (i === OTP_LENGTH - 1 && value.length === OTP_LENGTH));
          return (
            <div key={i} className={`flex-1 max-w-12 h-14 rounded-xl border bg-surface grid place-items-center font-display text-2xl tabular-nums transition-all duration-150
              ${invalid ? "border-danger" : active ? "border-primary ring-2 ring-primary/30" : value[i] ? "border-primary/60" : "border-line"}`}>
              {value[i] || (active ? <span className="w-px h-6 bg-primary animate-pulse" /> : "")}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function useCooldown(initial = 0) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, () => setLeft(RESEND_SECONDS)];
}

function Alert({ msg }) {
  if (!msg) return null;
  return <div className={`text-sm rounded-xl px-3 py-2 ${msg.error ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"}`} role="alert">{msg.text}</div>;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function GoogleButton({ onError }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin, queryParams: { prompt: "select_account" } },
    });
    // за успіху браузер уже переходить на Google
    if (error) {
      setBusy(false);
      onError(authErrorText(error));
    }
  };
  return (
    <button type="button" onClick={go} disabled={busy}
      className="btn w-full border border-line bg-surface hover:bg-sunken gap-2.5 font-medium">
      <GoogleIcon /> {busy ? "Переходимо до Google…" : "Продовжити з Google"}
    </button>
  );
}

// Кнопка Google з'являється, лише коли провайдер увімкнено в Supabase
function useGoogleEnabled() {
  const q = useQuery({
    queryKey: ["auth-settings"],
    queryFn: async () => {
      const r = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey } });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
  return Boolean(q.data?.external?.google);
}

function SocialLogin({ onError }) {
  if (!useGoogleEnabled()) return null;
  return <><GoogleButton onError={onError} /><Divider /></>;
}

function Divider() {
  return (
    <div className="flex items-center gap-3 my-4 text-xs text-muted" aria-hidden>
      <div className="h-px flex-1 bg-line" /> або <div className="h-px flex-1 bg-line" />
    </div>
  );
}

function SignInForm({ email, setEmail, onNeedVerify, go, signIn }) {
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (emailError(email) || !password) return;
    setBusy(true);
    setMsg(null);
    const addr = normalizeEmail(email);
    const { error } = signIn ? await signIn(addr, password) : await supabase.auth.signInWithPassword({ email: addr, password });
    if (error && (error.code === "email_not_confirmed" || /not confirmed/i.test(error.message))) {
      // пошту не підтвердили — одразу надсилаємо новий код і показуємо поле для нього
      await supabase.auth.resend({ type: "signup", email: addr });
      setBusy(false);
      return onNeedVerify("signup", "Пошту ще не підтверджено — ми надіслали новий код.");
    }
    setBusy(false);
    if (error) setMsg({ error: true, text: authErrorText(error) });
  };
  return (
    <>
      <h1 className="font-display text-2xl mb-1">З поверненням</h1>
      <p className="text-sm text-muted mb-5">Увійдіть, щоб продовжити</p>
      {!signIn && <SocialLogin onError={(text) => setMsg({ error: true, text })} />}
      <form onSubmit={submit} className="space-y-3" noValidate>
        <EmailField value={email} onChange={setEmail} touched={touched} onBlur={() => email && setTouched(true)} />
        <Field id="l-pass" label="Пароль" error={touched && !password ? "Вкажіть пароль" : null}>
          <PasswordInput id="l-pass" value={password} onChange={setPassword} autoComplete="current-password" invalid={touched && !password} />
        </Field>
        <div className="flex justify-end -mt-1">
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => go("forgot")}>Забули пароль?</button>
        </div>
        <Alert msg={msg} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Входимо…" : "Увійти"}</button>
      </form>
      <p className="mt-5 text-sm text-muted text-center">
        Немає акаунта? <button className="text-primary font-medium hover:underline" onClick={() => go("signup")}>Зареєструватися</button>
      </p>
    </>
  );
}

function SignUpForm({ email, setEmail, onNeedVerify, go }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const nameErr = touched && name.trim().length < 2 ? "Вкажіть ім'я (від 2 символів)" : null;
  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (name.trim().length < 2 || emailError(email) || !passwordValid(password, email)) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: { data: { display_name: name.trim().slice(0, 60) }, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) return setMsg({ error: true, text: authErrorText(error) });
    // Supabase не повідомляє явно про зайнятий email — у такому разі identities порожній
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return setMsg({ error: true, text: "Цей email уже зареєстровано. Увійдіть або відновіть пароль." });
    }
    if (!data.session) onNeedVerify("signup");
  };
  return (
    <>
      <h1 className="font-display text-2xl mb-1">Створити акаунт</h1>
      <p className="text-sm text-muted mb-5">Для студентів факультету електроніки ЛНУ ім. Івана Франка</p>
      <SocialLogin onError={(text) => setMsg({ error: true, text })} />
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field id="l-name" label="Ім'я та прізвище" error={nameErr}>
          <input id="l-name" autoComplete="name" className={`input ${nameErr ? "!border-danger" : ""}`} value={name} maxLength={60}
            onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(nameErr)} placeholder="Олена Коваль" />
        </Field>
        <EmailField value={email} onChange={setEmail} touched={touched} onBlur={() => email && setTouched(true)} />
        <NewPasswordField value={password} onChange={setPassword} email={email} touched={touched} />
        <Alert msg={msg} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Створюємо…" : "Створити акаунт"}</button>
        <p className="text-xs text-muted text-center">
          Ми надішлемо {OTP_LENGTH}-значний код на пошту. Створюючи акаунт, ви погоджуєтеся з{" "}
          <Link to="/terms" className="text-primary hover:underline">умовами користування</Link> та{" "}
          <Link to="/privacy" className="text-primary hover:underline">політикою конфіденційності</Link>.
        </p>
      </form>
      <p className="mt-5 text-sm text-muted text-center">
        Вже є акаунт? <button className="text-primary font-medium hover:underline" onClick={() => go("signin")}>Увійти</button>
      </p>
    </>
  );
}

function ForgotForm({ email, setEmail, onNeedVerify, go }) {
  const [touched, setTouched] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (emailError(email)) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo: window.location.origin });
    setBusy(false);
    if (error) return setMsg({ error: true, text: authErrorText(error) });
    onNeedVerify("recovery");
  };
  return (
    <>
      <BackButton onClick={() => go("signin")} />
      <h1 className="font-display text-2xl mb-1">Відновлення пароля</h1>
      <p className="text-sm text-muted mb-5">Вкажіть email акаунта — ми надішлемо код для встановлення нового пароля.</p>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <EmailField value={email} onChange={setEmail} touched={touched} onBlur={() => email && setTouched(true)} autoFocus />
        <Alert msg={msg} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Надсилаємо…" : "Надіслати код"}</button>
      </form>
    </>
  );
}

function BackButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="mb-4 -ml-1 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft size={16} /> Назад
    </button>
  );
}

function VerifyForm({ email, purpose, notice, go }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [msg, setMsg] = useState(notice ? { text: notice } : null);
  const [busy, setBusy] = useState(false);
  const [cooldown, startCooldown] = useCooldown(RESEND_SECONDS);
  const recovery = purpose === "recovery";
  const addr = normalizeEmail(email);

  const verify = async (token = code) => {
    setTouched(true);
    if (token.length !== OTP_LENGTH) return setMsg({ error: true, text: `Введіть усі ${OTP_LENGTH} цифр коду` });
    if (recovery && !passwordValid(password, email)) return;
    setBusy(true);
    setMsg(null);
    let { error } = await supabase.auth.verifyOtp({ email: addr, token, type: recovery ? "recovery" : "email" });
    if (error && !recovery && error.code !== "over_request_rate_limit") {
      // старіші проєкти Supabase очікують тип «signup» для коду підтвердження реєстрації
      ({ error } = await supabase.auth.verifyOtp({ email: addr, token, type: "signup" }));
    }
    if (!error && recovery) ({ error } = await supabase.auth.updateUser({ password }));
    setBusy(false);
    if (error) {
      setCode("");
      setMsg({ error: true, text: authErrorText(error) });
    }
    // за успіху з'являється сесія, і застосунок сам переходить далі
  };

  const resend = async () => {
    setMsg(null);
    const { error } = recovery
      ? await supabase.auth.resetPasswordForEmail(addr, { redirectTo: window.location.origin })
      : await supabase.auth.resend({ type: "signup", email: addr, options: { emailRedirectTo: window.location.origin } });
    if (error) return setMsg({ error: true, text: authErrorText(error) });
    startCooldown();
    setCode("");
    setMsg({ text: "Новий код надіслано" });
  };

  return (
    <>
      <BackButton onClick={() => go(recovery ? "forgot" : "signup")} />
      <div className="w-12 h-12 rounded-2xl bg-primary/15 text-primary grid place-items-center mb-4"><MailCheck size={24} aria-hidden /></div>
      <h1 className="font-display text-2xl mb-1">{recovery ? "Новий пароль" : "Підтвердіть пошту"}</h1>
      <p className="text-sm text-muted mb-5">
        Ми надіслали {OTP_LENGTH}-значний код на <b className="text-ink break-all">{addr}</b>.
        {recovery ? " Введіть його та придумайте новий пароль." : " Введіть його нижче."}
      </p>
      <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-4" noValidate>
        <OtpInput value={code} onChange={setCode} disabled={busy} invalid={Boolean(msg?.error) && !code}
          onComplete={recovery ? undefined : (v) => verify(v)} />
        {recovery && <NewPasswordField id="l-newpass" label="Новий пароль" value={password} onChange={setPassword} email={email} touched={touched} />}
        <Alert msg={msg} />
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Перевіряємо…" : recovery ? "Зберегти пароль і увійти" : "Підтвердити"}
        </button>
      </form>
      <div className="mt-5 text-sm text-muted text-center">
        Не отримали лист? Перевірте «Спам» або{" "}
        {cooldown > 0
          ? <span className="tabular-nums">надішліть знову через {cooldown} с</span>
          : <button className="text-primary font-medium hover:underline" onClick={resend}>надішліть код ще раз</button>}
      </div>
      {!recovery && (
        <p className="mt-2 text-xs text-muted text-center">
          Помилилися в адресі? <button className="text-primary hover:underline" onClick={() => go("signup")}>Змінити email</button>
        </p>
      )}
    </>
  );
}

// Тестове середовище (демо-режим, DEMO_SEED=showcase): та сама форма входу, перевірка — тестовими акаунтами backend
export function TestEnvSignIn({ signIn }) {
  const [email, setEmail] = useState("");
  return <SignInForm email={email} setEmail={setEmail} onNeedVerify={() => {}} go={() => {}} signIn={signIn} />;
}

export default function SupabaseAuth() {
  const [step, setStep] = useState("signin");
  const [email, setEmail] = useState("");
  const [verify, setVerify] = useState({ purpose: "signup", notice: null });
  const needVerify = (purpose, notice = null) => {
    setVerify({ purpose, notice });
    setStep("verify");
  };
  const props = { email, setEmail, onNeedVerify: needVerify, go: setStep };
  return (
    <div key={step} className="page-in">
      {step === "signin" && <SignInForm {...props} />}
      {step === "signup" && <SignUpForm {...props} />}
      {step === "forgot" && <ForgotForm {...props} />}
      {step === "verify" && <VerifyForm email={email} purpose={verify.purpose} notice={verify.notice} go={setStep} />}
    </div>
  );
}
