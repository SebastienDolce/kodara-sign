import { useLocation } from "react-router";

const SOURCE_URL = "https://github.com/SebastienDolce/kodara-sign";

export default function SourceCodeNotice() {
  const { pathname } = useLocation();
  const isProposal = pathname.startsWith("/proposal/");

  return (
    <a
      href={SOURCE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Kodara Sign source code licensed under AGPL-3.0"
      className={`fixed z-[9999] rounded border border-white/15 bg-black/80 px-2.5 py-1.5 text-[11px] font-medium text-white/70 backdrop-blur hover:border-white/30 hover:text-white ${
        isProposal
          ? "top-20 right-3 lg:top-auto lg:bottom-3"
          : "bottom-3 left-3"
      }`}
    >
      Source code · AGPL-3.0
    </a>
  );
}
