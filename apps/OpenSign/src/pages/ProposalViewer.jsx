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

export default function ProposalViewer() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const signed = searchParams.get("signed") === "1";

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
        window.location.assign(signingUrl);
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

  const accepted = proposal?.status === "accepted";

  return (
    <div className="min-h-screen bg-[#090909] text-white">
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-5 md:px-8 sticky top-0 bg-[#090909]/95 backdrop-blur z-20">
        <div className="font-semibold tracking-tight text-lg">
          Kodara <span className="text-[#ef2b2d]">▪</span> Sign
        </div>
        <div className="text-xs text-white/45">{proposal?.proposalNumber}</div>
      </header>

      <main className="max-w-[1100px] mx-auto px-3 md:px-6 py-5 md:py-8 pb-32">
        {signed ? (
          <div className="mb-5 border border-emerald-500/30 bg-emerald-500/10 rounded-lg px-4 py-3">
            <div className="font-semibold">Agreement completed</div>
            <div className="text-sm text-white/60 mt-1">
              Your proposal was accepted and your agreement was completed.
            </div>
          </div>
        ) : accepted ? (
          <div className="mb-5 border border-white/15 bg-white/5 rounded-lg px-4 py-3">
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
            className="block w-full min-h-[calc(100vh-150px)] bg-[#111]"
          />
        </div>
      </main>

      {!signed && (
        <div className="fixed bottom-0 inset-x-0 bg-[#090909]/95 backdrop-blur border-t border-white/10 z-30">
          <div className="max-w-[1100px] mx-auto px-5 md:px-8 py-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">
                {accepted ? "Proposal accepted" : `Prepared for ${proposal?.recipientName || "you"}`}
              </div>
              <div className="text-xs text-white/45 mt-0.5">
                {proposal?.snapshotHash
                  ? `Snapshot ${proposal.snapshotHash.slice(0, 12)}`
                  : ""}
              </div>
            </div>
            <button
              type="button"
              className="op-btn op-btn-primary min-w-[190px]"
              disabled={accepting}
              onClick={acceptProposal}
            >
              {accepting
                ? "Preparing agreement..."
                : accepted
                  ? "Continue to agreement"
                  : "Accept proposal"}
            </button>
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
