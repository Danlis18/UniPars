/** @type {import('tailwindcss').Config} */
const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: c("bg"), surface: c("surface"), sunken: c("sunken"), ink: c("ink"), muted: c("muted"),
        line: c("line"), primary: c("primary"), "on-primary": c("on-primary"), lime: c("lime"), "on-lime": c("on-lime"),
        danger: c("danger"), teal: c("teal"),
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "sans-serif"],
        display: ['"Unbounded"', '"Inter"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Consolas", "monospace"],
      },
      maxWidth: { app: "1440px" },
    },
  },
  plugins: [],
};
