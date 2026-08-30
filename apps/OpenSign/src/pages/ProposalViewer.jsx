import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import axios from "axios";
import DOMPurify from "dompurify";
import Loader from "../primitives/Loader";
import SourceCodeNotice from "../components/SourceCodeNotice";
import { removeTrailingSegment } from "../constant/Utils";

const INEZ_PROPOSAL_NUMBER = "KOD-2026-3A7533";
const INEZ_PROPOSAL_VIEWER_CSS = `
@media screen {
  .page {
    width: 100% !important;
    max-width: none !important;
  }
}
`;

const buildProposalDocument = (html, css) => {
  const safeHtml = DOMPurify.sanitize(html || "", {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed"],
    FORBID_ATTR: ["srcdoc"]
  });
  const safeCss = String(css || "").replace(/<\/style/gi, "<\\/style");
  const csp =
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;min-height:100%;}${safeCss}</style></head><body>${safeHtml}</body></html>`;
};

const directSigningUrl = (signingUrl) => {
  const marker = "/login/";
  if (!signingUrl?.includes(marker)) return signingUrl;
  try {
    const encoded = signingUrl.split(marker)[1]?.split(/[?#]/)[0] || "";
    let normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    normalized += "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(normalized);
    const [documentId, , contactBookId] = decoded.split("/");
    if (!documentId || !contactBookId) return signingUrl;
    return `${window.location.origin}/load/recipientSignPdf/${encodeURIComponent(documentId)}/${encodeURIComponent(contactBookId)}?sendmail=false`;
  } catch (error) {
    console.error("Unable to decode proposal signing handoff", error);
    return signingUrl;
  }
};

export default function ProposalViewer() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState("dark");
  const redirectedFromSigning = searchParams.get("signed") === "1";
  const isDarkMode = theme === "dark";

  const apiBase = () => {
    const baseApi = localStorage.getItem("baseUrl") || "";
    return removeTrailingSegment(baseApi);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const response = await axios.get(
          `${apiBase()}/proposal-public/${encodeURIComponent(token)}`
        );
        if (mounted) setProposal(response?.data?.proposal || null);
      } catch (err) {
        if (mounted) {
          setError(
            err?.response?.data?.error || err?.message || "Unable to load proposal."
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token]);

  const isInezPresentationHotfix =
    proposal?.proposalNumber === INEZ_PROPOSAL_NUMBER;

  const documentHtml = useMemo(() => {
    const activeCss = isDarkMode
      ? proposal?.darkCss
      : proposal?.lightCss || proposal?.darkCss;
    const viewerCss = isInezPresentationHotfix
      ? `${activeCss || ""}\n${INEZ_PROPOSAL_VIEWER_CSS}`
      : activeCss;
    return buildProposalDocument(proposal?.html, viewerCss);
  }, [proposal, isInezPresentationHotfix, isDarkMode]);

  const acceptProposal = async () => {
    setAccepting(true);
    setError("");
    try {
      const response = await axios.post(
        `${apiBase()}/proposal-public/${encodeURIComponent(token)}/accept`,
        {}
      );
      const signingUrl = response?.data?.signingUrl;
      if (signingUrl) {
        window.location.assign(directSigningUrl(signingUrl));
        return;
      }
      setProposal((current) => ({ ...current, status: "accepted" }));
    } catch (err) {
      setError(
        err?.response?.data?.error || err?.message || "Unable to accept proposal."
      );
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090909] flex items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error && !proposal) {
    return (
      <div className="min-h-screen bg-[#090909] text-white flex items-center justify-center p-6">
        <div className="max-w-lg text-center">
          <h1 className="text-2xl font-semibold mb-3">Proposal unavailable</h1>
          <p className="text-white/60">{error}</p>
        </div>
      </div>
    );
  }

  // One-off presentation hotfix for the already-sent Inez proposal. The sender
  // pre-signed through the recipient flow, which set the proposal to accepted
  // before the recipient reviewed it. Keep the stored proposal/audit/PDF intact
  // while presenting the recipient with the intended first-visit experience.
  const serverCompleted = proposal?.status === "completed";
  const completed =
    serverCompleted || (!isInezPresentationHotfix && redirectedFromSigning);
  const signatureSubmitted =
    isInezPresentationHotfix && redirectedFromSigning && !serverCompleted;
  const accepted = isInezPresentationHotfix
    ? false
    : proposal?.status === "accepted" || completed;
  const showAction = !completed && !signatureSubmitted;

  const sidebarStatus = signatureSubmitted
    ? "Signature submitted"
    : isInezPresentationHotfix
      ? `Prepared for ${proposal?.recipientName || "you"}`
      : accepted
        ? "Proposal accepted"
        : `Prepared for ${proposal?.recipientName || "you"}`;

  const mutedTextClass = isDarkMode ? "text-white/60" : "text-black/60";
  const subtleTextClass = isDarkMode ? "text-white/45" : "text-black/45";
  const faintTextClass = isDarkMode ? "text-white/40" : "text-black/40";
  const shellBorderClass = isDarkMode ? "border-white/10" : "border-black/10";
  const infoPanelClass = isDarkMode
    ? "border-white/15 bg-white/5"
    : "border-black/10 bg-black/[0.03]";

  const themeToggle = (
    <button
      type="button"
      onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
      aria-label={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
      title={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
      className={`inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        isDarkMode
          ? "border-white/15 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white"
          : "border-black/10 bg-black/[0.03] text-black/70 hover:bg-black/[0.07] hover:text-black"
      }`}
    >
      {isDarkMode ? "Light mode" : "Dark mode"}
    </button>
  );

  const proposalAction = (
    <button
      type="button"
      className="op-btn op-btn-primary w-full"
      disabled={accepting}
      onClick={acceptProposal}
    >
      {accepting
        ? "Preparing agreement..."
        : isInezPresentationHotfix
          ? "Accept proposal"
          : accepted
            ? "Continue to agreement"
            : "Accept proposal"}
    </button>
  );

  return (
    <div
      className={`min-h-screen transition-colors duration-200 ${
        isDarkMode ? "bg-[#090909] text-white" : "bg-[#f4f4f5] text-[#18181b]"
      }`}
    >
      <aside
        className={`hidden lg:flex fixed inset-y-0 left-0 w-56 border-r z-30 flex-col transition-colors duration-200 ${
          isDarkMode ? "border-white/10 bg-[#090909]" : "border-black/10 bg-white"
        }`}
      >
        <div className={`px-6 py-6 border-b ${shellBorderClass}`}>
          <div className="font-semibold tracking-tight text-lg">
            Kodara <span className="text-[#ef2b2d]">▪</span> Sign
          </div>
          <div className={`text-[11px] mt-2 tracking-wide ${faintTextClass}`}>
            {proposal?.proposalNumber}
          </div>
          <div className="mt-4">{themeToggle}</div>
        </div>

        <div className="flex-1 px-6 py-6 flex flex-col justify-end">
          {!completed ? (
            <>
              <div className="mb-4">
                <div className="text-sm font-medium leading-snug">
                  {sidebarStatus}
                </div>
                <div className={`text-[11px] mt-1 break-all ${faintTextClass}`}>
                  {proposal?.snapshotHash
                    ? `Snapshot ${proposal.snapshotHash.slice(0, 12)}`
                    : ""}
                </div>
              </div>
              {showAction ? proposalAction : null}
              {error ? (
                <div className="mt-3 text-xs leading-relaxed text-red-400">
                  {error}
                </div>
              ) : null}
            </>
          ) : (
            <div className={`text-sm leading-relaxed ${mutedTextClass}`}>
              Agreement completed. Your copies are being delivered by email.
            </div>
          )}
          <div className="mt-5">
            <SourceCodeNotice variant="sidebar" theme={theme} />
          </div>
        </div>
      </aside>

      <header
        className={`lg:hidden min-h-16 border-b flex items-center justify-between gap-3 px-5 md:px-8 py-3 sticky top-0 backdrop-blur z-20 transition-colors duration-200 ${
          isDarkMode
            ? "border-white/10 bg-[#090909]/95"
            : "border-black/10 bg-white/95"
        }`}
      >
        <div className="font-semibold tracking-tight text-lg shrink-0">
          Kodara <span className="text-[#ef2b2d]">▪</span> Sign
        </div>
        <div className="flex items-center justify-end gap-3 min-w-0">
          {themeToggle}
          <div className="text-right min-w-0">
            <div className={`text-xs truncate ${subtleTextClass}`}>
              {proposal?.proposalNumber}
            </div>
            <SourceCodeNotice variant="compact" theme={theme} />
          </div>
        </div>
      </header>

      <main className="lg:pl-56">
        <div className="max-w-[1100px] mx-auto px-3 md:px-6 py-4 md:py-5 lg:py-4 pb-32 lg:pb-4">
          {completed ? (
            <div className="mb-4 border border-emerald-500/30 bg-emerald-500/10 rounded-lg px-4 py-3">
              <div className="font-semibold">Agreement completed</div>
              <div className={`text-sm mt-1 ${mutedTextClass}`}>
                Your proposal was accepted and your agreement was completed. Your copies are being delivered by email.
              </div>
            </div>
          ) : signatureSubmitted ? (
            <div className="mb-4 border border-emerald-500/30 bg-emerald-500/10 rounded-lg px-4 py-3">
              <div className="font-semibold">Signature submitted</div>
              <div className={`text-sm mt-1 ${mutedTextClass}`}>
                Your signature was submitted successfully. The completed agreement will be delivered by email when all signatures are finalized.
              </div>
            </div>
          ) : isInezPresentationHotfix ? (
            <div className={`mb-4 border rounded-lg px-4 py-3 ${infoPanelClass}`}>
              <div className="font-semibold">Proposal ready for your review</div>
              <div className={`text-sm mt-1 ${mutedTextClass}`}>
                Review the proposal below. When you are ready, accept it to continue to the agreement.
              </div>
            </div>
          ) : accepted ? (
            <div className={`mb-4 border rounded-lg px-4 py-3 ${infoPanelClass}`}>
              <div className="font-semibold">Proposal accepted</div>
              <div className={`text-sm mt-1 ${mutedTextClass}`}>
                Continue to the agreement to complete the process.
              </div>
            </div>
          ) : null}

          <div
            className={`rounded-xl overflow-hidden border transition-colors duration-200 ${
              isDarkMode
                ? "border-white/10 bg-[#111] shadow-2xl"
                : "border-black/10 bg-white shadow-xl"
            }`}
          >
            <iframe
              title={proposal?.name || "Proposal"}
              sandbox=""
              srcDoc={documentHtml}
              className={`block w-full min-h-[calc(100vh-150px)] lg:min-h-[calc(100vh-32px)] transition-colors duration-200 ${
                isDarkMode ? "bg-[#111]" : "bg-white"
              }`}
            />
          </div>
        </div>
      </main>

      {!completed && (
        <div
          className={`lg:hidden fixed bottom-0 inset-x-0 backdrop-blur border-t z-30 transition-colors duration-200 ${
            isDarkMode
              ? "bg-[#090909]/95 border-white/10"
              : "bg-white/95 border-black/10"
          }`}
        >
          <div className="max-w-[1100px] mx-auto px-5 md:px-8 py-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">
                {sidebarStatus}
              </div>
              <div className={`text-xs mt-0.5 ${subtleTextClass}`}>
                {proposal?.snapshotHash
                  ? `Snapshot ${proposal.snapshotHash.slice(0, 12)}`
                  : ""}
              </div>
            </div>
            {showAction ? (
              <div className="sm:min-w-[190px]">{proposalAction}</div>
            ) : null}
          </div>
          {error ? (
            <div className="max-w-[1100px] mx-auto px-5 md:px-8 pb-3 text-sm text-red-400">
              {error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
