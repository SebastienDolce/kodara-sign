import { useLocation } from "react-router";

const SOURCE_URL = "https://github.com/SebastienDolce/kodara-sign";

export default function SourceCodeNotice({ variant = "floating" }) {
  const { pathname } = useLocation();
  const isProposal = pathname.startsWith("/proposal/");

  // Proposal pages render their own non-overlay notice inside the proposal UI.
  if (variant === "floating" && isProposal) return null;

  const variantClass =
    variant === "sidebar"
      ? "block w-full border-t border-white/10 pt-4 text-[10px] leading-tight text-white/45 hover:text-white/75"
      : variant === "compact"
        ? "inline-block text-[9px] leading-tight text-white/40 hover:text-white/70"
        : "fixed bottom-3 left-3 z-[9999] rounded border border-white/15 bg-black/80 px-2.5 py-1.5 text-[11px] leading-tight text-white/70 backdrop-blur hover:border-white/30 hover:text-white";

  return (
    <a
      href={SOURCE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Kodara Sign, modified from OpenSign in August 2026; source code licensed under AGPL-3.0"
      className={variantClass}
    >
      <span className="block font-medium">Modified OpenSign · Aug 2026</span>
      <span className="block mt-0.5">Source code · AGPL-3.0</span>
    </a>
  );
}
