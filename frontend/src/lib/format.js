export function timeAgo(iso) {
  const t = new Date(iso).getTime();
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "щойно";
  if (s < 3600) return `${Math.floor(s / 60)} хв`;
  if (s < 86400) return `${Math.floor(s / 3600)} год`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} д`;
  return new Date(t).toLocaleDateString("uk-UA", { day: "numeric", month: "short", year: s > 86400 * 300 ? "numeric" : undefined });
}

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function initials(name = "?") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}

const PALETTE = ["#1f4d3a", "#0f8f86", "#7a5c1e", "#5b4a8a", "#a23b5b", "#2f6b9a", "#6b7a1e"];
export function colorFor(id = "") {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
