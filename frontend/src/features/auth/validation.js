// Перевірки на клієнті: швидкий зворотний зв'язок до запиту на сервер.
// Мінімальні вимоги (8 символів, літери й цифри) дублюються в налаштуваннях Supabase Auth.

export function normalizeEmail(v) {
  return (v || "").trim().toLowerCase();
}

// Практична перевірка адреси: латинська локальна частина, домен із крапкою і TLD від 2 літер.
const EMAIL_RE = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_%+-])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function emailError(raw) {
  const v = normalizeEmail(raw);
  if (!v) return "Вкажіть email";
  if (/\s/.test(v)) return "Email не може містити пробілів";
  if (!v.includes("@")) return "У адресі бракує символу @";
  if (/[а-яіїєґё]/i.test(v)) return "Email пишеться латиницею";
  if (v.includes("..")) return "Дві крапки поспіль — так не буває";
  if (v.length > 254 || !EMAIL_RE.test(v)) return "Перевірте адресу: наприклад, name@gmail.com";
  return null;
}

// Часті описки в популярних доменах → підказка «Можливо, …?»
const DOMAIN_TYPOS = {
  "gmail.com": ["gmial.com", "gmai.com", "gmaill.com", "gamil.com", "gnail.com", "gmail.co", "gmail.con", "gmail.cm", "gmail.om", "gmal.com", "gmail.ru", "gmail.ua", "gmali.com", "gmeil.com"],
  "ukr.net": ["ukr.ner", "urk.net", "ukr.nte", "ukr.met", "ukrnet.com", "ukr.com"],
  "outlook.com": ["outlok.com", "outloo.com", "outlook.co", "outllook.com"],
  "hotmail.com": ["hotmal.com", "hotmial.com", "hotmail.co", "hotmai.com"],
  "yahoo.com": ["yaho.com", "yahooo.com", "yahoo.co"],
  "icloud.com": ["iclod.com", "icloud.co", "icoud.com", "iclould.com"],
  "lnu.edu.ua": ["lnu.edu.au", "lnu.edu.ue", "lnu.edu", "inu.edu.ua", "lnu.eud.ua"],
};
const TYPO_TO_DOMAIN = Object.fromEntries(Object.entries(DOMAIN_TYPOS).flatMap(([d, typos]) => typos.map((t) => [t, d])));

export function emailSuggestion(raw) {
  const v = normalizeEmail(raw);
  const at = v.lastIndexOf("@");
  if (at < 1) return null;
  const fixed = TYPO_TO_DOMAIN[v.slice(at + 1)];
  return fixed ? `${v.slice(0, at + 1)}${fixed}` : null;
}

// Найпоширеніші паролі зі злитих баз (у нижньому регістрі) + українська розкладка
const COMMON = new Set([
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234", "11223344", "12121212",
  "password", "password1", "password123", "passw0rd", "qwerty123", "qwertyui", "qwertyuiop", "qwerty12", "1q2w3e4r",
  "1q2w3e4r5t", "1qaz2wsx", "zaq12wsx", "asdfghjk", "asdf1234", "abc12345", "abcd1234", "iloveyou", "sunshine1",
  "football", "baseball", "superman", "princess", "starwars", "whatever", "trustno1", "letmein1", "welcome1",
  "admin123", "administrator", "monkey123", "dragon123", "master123", "qwe12345", "q1w2e3r4", "aa123456",
  "йцукенгш", "йцукен123", "пароль123", "привіт123", "україна1", "ukraine1", "ukraine123", "slavaukraini",
  "unipars1", "unipars123", "student1", "student123", "lviv1234", "lnu12345",
]);

const SEQUENCES = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm", "йцукенгшщзхї", "фівапролджє"];

function isSequential(p) {
  const s = p.toLowerCase();
  return SEQUENCES.some((seq) => seq.includes(s) || [...seq].reverse().join("").includes(s));
}

export function passwordChecks(password, email = "") {
  const p = password || "";
  const lower = p.toLowerCase();
  const local = normalizeEmail(email).split("@")[0] || "";
  return [
    { id: "len", ok: p.length >= 8 && p.length <= 72, label: p.length > 72 ? "Не довше 72 символів" : "Щонайменше 8 символів" },
    { id: "letter", ok: /\p{L}/u.test(p), label: "Містить літеру" },
    { id: "digit", ok: /\d/.test(p), label: "Містить цифру" },
    {
      id: "weak",
      ok: p.length > 0 && !COMMON.has(lower) && new Set(lower).size >= 4 && !isSequential(p) && !(local.length >= 4 && lower.includes(local)),
      label: "Не надто простий (не «12345678», не ваш email)",
    },
  ];
}

export function passwordValid(password, email) {
  return passwordChecks(password, email).every((c) => c.ok);
}

// 0–4: для індикатора. Обов'язкові правила дають до 2 балів, решта — довжина й різноманітність символів.
export function passwordScore(password, email) {
  if (!password) return 0;
  if (!passwordValid(password, email)) return 1;
  let s = 2;
  if (password.length >= 12) s++;
  if (/[^\p{L}\d]/u.test(password) || (/\p{Lu}/u.test(password) && /\p{Ll}/u.test(password))) s++;
  return Math.min(s, 4);
}

// Повідомлення Supabase Auth → зрозумілий український текст
export function authErrorText(error) {
  const m = (error?.message || "").toLowerCase();
  const code = error?.code || "";
  if (code === "invalid_credentials" || m.includes("invalid login credentials")) return "Неправильний email або пароль";
  if (code === "email_not_confirmed" || m.includes("email not confirmed")) return "Пошту ще не підтверджено";
  if (code === "user_already_exists" || m.includes("already registered")) return "Цей email уже зареєстровано. Увійдіть або відновіть пароль.";
  if (code === "weak_password" || m.includes("password should")) return "Пароль надто простий: мінімум 8 символів, літери й цифри";
  if (code === "otp_expired" || m.includes("token has expired") || (m.includes("token") && m.includes("invalid"))) return "Код неправильний або застарів. Перевірте цифри чи надішліть новий.";
  if (code === "over_email_send_rate_limit" || m.includes("rate limit") || m.includes("security purposes")) return "Забагато спроб. Зачекайте хвилину й спробуйте ще раз.";
  if (code === "validation_failed" && m.includes("provider")) return "Вхід через Google ще не налаштовано";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) return "Вхід через Google ще не налаштовано";
  if (m.includes("failed to fetch") || m.includes("network")) return "Немає з'єднання з сервером. Перевірте інтернет.";
  if (code === "same_password") return "Новий пароль має відрізнятися від старого";
  return error?.message || "Щось пішло не так. Спробуйте ще раз.";
}
