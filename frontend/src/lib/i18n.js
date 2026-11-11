import uk from "../locales/uk.js";

const LOCALES = { uk };
let current = "uk";

export function setLocale(code) {
  if (LOCALES[code]) current = code;
}

// t("nav.home") → "Головна"; відсутній ключ повертається як є
export function t(key) {
  return key.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), LOCALES[current]) ?? key;
}
