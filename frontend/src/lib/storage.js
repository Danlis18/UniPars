// Безпечна робота з localStorage (може бути недоступний у приватному режимі)
export const local = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

export function applyTheme(theme) {
  try {
    localStorage.setItem("unipars.theme", theme);
  } catch {}
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function currentTheme() {
  try {
    return localStorage.getItem("unipars.theme") || "system";
  } catch {
    return "system";
  }
}
