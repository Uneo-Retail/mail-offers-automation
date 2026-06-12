import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        pulse_dot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.3" } },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "pulse-dot": "pulse_dot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
