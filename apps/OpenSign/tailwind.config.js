/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {}
  },
  plugins: [
    require("daisyui"),
    function ({ addUtilities, addVariant }) {
      // ✅ Variants that match html[data-theme="..."] (or any ancestor with data-theme)
      addVariant("opensigncss", '[data-theme="opensigncss"] &');
      addVariant("opensigndark", '[data-theme="opensigndark"] &');

      addUtilities({
        // Prevent iOS long-press popup
        ".touch-callout-none": {
          "-webkit-touch-callout": "none"
        },
        // VS Code-style disabled button for all themes
        ".op-btn-vscode-disabled": {
          "background-color": "#3C3C3C !important",
          color: "#CCCCCC !important",
          "border-color": "#565656 !important",
          cursor: "not-allowed !important",
          opacity: "1 !important",
          "&:hover": {
            "background-color": "#3C3C3C !important",
            color: "#CCCCCC !important",
            "border-color": "#565656 !important",
            transform: "none !important"
          }
        },
        // Dark mode icon improvements using DaisyUI theme detection
        '[data-theme="opensigndark"] .icon-improved': {
          color: "#CCCCCC !important"
        },
        '[data-theme="opensigndark"] .icon-muted': {
          color: "#999999 !important"
        },
        '[data-theme="opensigndark"] .icon-disabled': {
          color: "#858585 !important"
        },
        // Gray text improvements for dark mode
        '[data-theme="opensigndark"] .text-gray-500': {
          color: "#CCCCCC !important"
        },
        '[data-theme="opensigndark"] .text-gray-400': {
          color: "#999999 !important"
        },
        '[data-theme="opensigndark"] .text-gray-600': {
          color: "#CCCCCC !important"
        },
        // CSS variable utilities that work with arbitrary values
        ".icon-themed": {
          color: "var(--icon-color)"
        },
        ".icon-themed-muted": {
          color: "var(--icon-color-muted)"
        },
        ".icon-themed-disabled": {
          color: "var(--icon-color-disabled)"
        },
        ".btn-themed-disabled": {
          "background-color": "var(--btn-disabled-bg)",
          color: "var(--btn-disabled-color)",
          "border-color": "var(--btn-disabled-border)",
          cursor: "not-allowed",
          "&:hover": {
            "background-color": "var(--btn-disabled-bg)",
            color: "var(--btn-disabled-color)",
            "border-color": "var(--btn-disabled-border)",
            transform: "none"
          }
        }
      });
    }
  ],
  daisyui: {
    // themes: true,
    themes: [
      {
        opensigndark: {
          primary: "#EF2B2D",
          "primary-content": "#FFFFFF",

          secondary: "#111111",
          "secondary-content": "#F1F0EC",

          accent: "#FF4547",
          "accent-content": "#FFFFFF",

          neutral: "#2A2A2A",
          "neutral-content": "#D6D3CC",

          "base-100": "#050505",
          "base-200": "#0B0B0B",
          "base-300": "#151515",
          "base-content": "#F1F0EC",

          info: "#2563EB", // For info panels like "Out for signature"
          success: "#22C55E", // Optional: for completed docs or alerts
          warning: "#FBBF24",
          error: "#EF4444",

          "--rounded-box": "0rem",
          "--rounded-btn": "0rem",
          "--rounded-badge": "0rem",
          "--tab-border": "2px",
          "--tab-radius": "0rem",

          // Custom CSS variables for icon and button states
          "--icon-color": "#CCCCCC",
          "--icon-color-muted": "#999999",
          "--icon-color-disabled": "#858585",
          "--btn-disabled-bg": "#3C3C3C",
          "--btn-disabled-color": "#CCCCCC",
          "--btn-disabled-border": "#565656",

          // Optional polish
          "--navbar-padding": "0.8rem",
          "--border-color": "#292929",
          "--tooltip-color": "#111111"
        }
      },
      {
        opensigncss: {
          primary: "#EF2B2D",
          "primary-content": "#FFFFFF",
          secondary: "#171717",
          "secondary-content": "#F1F0EC",
          accent: "#D82124",
          "accent-content": "#FFFFFF",
          neutral: "#D8D4CB",
          "neutral-content": "#111111",
          "base-100": "#F4F1EB",
          "base-200": "#E8E4DC",
          "base-300": "#D8D4CB",
          "base-content": "#111111",
          info: "#00b6ff",
          "info-content": "#f5f5f4",
          success: "#00a96e",
          "success-content": "#f5f5f4",
          warning: "#ffbe00",
          "warning-content": "#ccd9e8",
          error: "#ffa1a7",
          "error-content": "#16090a",
          "--rounded-box": "0rem",
          "--rounded-btn": "0rem",
          "--rounded-badge": "0rem",
          "--tab-border": "2px",
          "--tab-radius": "0rem"
        }
      }
    ],
    prefix: "op-"
  }
};
