import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import axios from "axios";
import DOMPurify from "dompurify";
import Loader from "../primitives/Loader";
import { removeTrailingSegment } from "../constant/Utils";

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
  const redirectedFromSigning = searchParams.get("signed") === "1";

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

  const documentHtml = useMemo(
    () => buildProposalDocument(proposal?.html, proposal?.darkCss),
    [proposal]
  );

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

  const completed = proposal?.status === "completed" || redirectedFromSigning;
  const accepted = proposal?.status === "accepted" || completed;

  const proposalAction = (
    <button
      type="button"
      className="op-btn op-btn-primary w-full"
      disabled={accepting}
      onClick={acceptProposal}
    >
      {accepting
        ? "Preparing agreement..."
        : accepted
          ? "Continue to agreement"
          : "Accept proposal"}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#090909] text-white">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-56 border-r border-white/10 bg-[#090909] z-30 flex-col">
        <div className="px-6 py-6 border-b border-white/10">
          <div className="font-semibold tracking-tight text-lg">
            Kodara <span className="text-[#ef2b2d]">▪</span> Sign
          </div>
          <div className="text-[11px] text-white/40 mt-2 tracking-wide">
            {proposal?.proposalNumber}
          </div>
        </div>

        <div className="flex-1 px-6 py-6 flex flex-col justify-end">
          {!completed ? (
            <>
              <div className="mb-4">
                <div className="text-sm font-medium leading-snug">
                  {accepted
                    ? "Proposal accepted"
                    : `Prepared for ${proposal?.recipientName || "you"}`}
                </div>
                <div className="text-[11px] text-white/40 mt-1 break-all">
                  {proposal?.snapshotHash
                    ? `Snapshot ${proposal.snapshotHash.slice(0, 12)}`
                    : ""}
                </div>
              </div>
              {proposalAction}
              {error ? (
                <div className="mt-3 text-xs leading-relaxed text-red-400">
                  {error}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-sm text-white/55 leading-relaxed">
              Agreement completed. Your copies are being delivered by email.
            </div>
          )}
        </div>
      </aside>

      <header className="lg:hidden h-16 border-b border-white/10 flex items-center justify-between px-5 md:px-8 sticky top-0 bg-[#090909]/95 backdrop-blur z-20">
        <div className="font-semibold tracking-tight text-lg">
          Kodara <span className="text-[#ef2b2d]">▪</span> Sign
        </div>
        <div className="text-xs text-white/45">{proposal?.proposalNumber}</div>
      </header>

      <main className="lg:pl-56">
        <div className="max-w-[1100px] mx-auto px-3 md:px-6 py-4 md:py-5 lg:py-4 pb-32 lg:pb-4">
          {completed ? (
            <div className="mb-4 border border-emerald-500/30 bg-emerald-500/10 rounded-lg px-4 py-3">
              <div className="font-semibold">Agreement completed</div>
              <div className="text-sm text-white/60 mt-1">
                Your proposal was accepted and your agreement was completed. Your copies are being delivered by email.
              </div>
            </div>
          ) : accepted ? (
            <div className="mb-4 border border-white/15 bg-white/5 rounded-lg px-4 py-3">
              <div className="font-semibold">Proposal accepted</div>
              <div className="text-sm text-white/60 mt-1">
                Continue to the agreement to complete the process.
              </div>
            </div>
          ) : null}

          <div className="rounded-xl overflow-hidden border border-white/10 bg-[#111] shadow-2xl">
            <iframe
              title={proposal?.name || "Proposal"}
              sandbox=""
              srcDoc={documentHtml}
              className="block w-full min-h-[calc(100vh-150px)] lg:min-h-[calc(100vh-32px)] bg-[#111]"
            />
          </div>
        </div>
      </main>

      {!completed && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 bg-[#090909]/95 backdrop-blur border-t border-white/10 z-30">
          <div className="max-w-[1100px] mx-auto px-5 md:px-8 py-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">
                {accepted
                  ? "Proposal accepted"
                  : `Prepared for ${proposal?.recipientName || "you"}`}
              </div>
              <div className="text-xs text-white/45 mt-0.5">
                {proposal?.snapshotHash
                  ? `Snapshot ${proposal.snapshotHash.slice(0, 12)}`
                  : ""}
              </div>
            </div>
            <div className="sm:min-w-[190px]">{proposalAction}</div>
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
