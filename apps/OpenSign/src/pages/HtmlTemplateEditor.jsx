import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import Parse from "parse";
import axios from "axios";
import DOMPurify from "dompurify";
import Loader from "../primitives/Loader";
import ModalUi from "../primitives/ModalUi";
import { removeTrailingSegment } from "../constant/Utils";
import { withSessionValidation } from "../utils";

const EMPTY_TEMPLATE = {
  Name: "",
  HtmlContent: "",
  DarkCss: "",
  LightCss: ""
};

const EMPTY_SEND_FORM = {
  recipientName: "",
  recipientEmail: "",
  contractTemplateId: ""
};

const buildPreview = (html, css) => {
  const safeHtml = DOMPurify.sanitize(html || "", {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed"],
    FORBID_ATTR: ["srcdoc"]
  });
  const safeCss = String(css || "").replace(/<\/style/gi, "<\\/style");
  const csp =
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;min-height:100%;}${safeCss}</style></head><body>${safeHtml}</body></html>`;
};

const authHeaders = () => ({
  sessiontoken: Parse.User.current().getSessionToken()
});

const customApiUrl = (path = "") => {
  const baseApi = localStorage.getItem("baseUrl") || "";
  return `${removeTrailingSegment(baseApi)}${path}`;
};

export default function HtmlTemplateEditor() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [templates, setTemplates] = useState([]);
  const [previewTheme, setPreviewTheme] = useState("dark");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [renderingTheme, setRenderingTheme] = useState("");
  const [renderedPdf, setRenderedPdf] = useState(null);
  const [message, setMessage] = useState("");
  const [isSendModal, setIsSendModal] = useState(false);
  const [contractTemplates, setContractTemplates] = useState([]);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [sendForm, setSendForm] = useState(EMPTY_SEND_FORM);
  const [sendingProposal, setSendingProposal] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [sendError, setSendError] = useState("");

  const preview = useMemo(
    () =>
      buildPreview(
        form.HtmlContent,
        previewTheme === "dark" ? form.DarkCss : form.LightCss
      ),
    [form, previewTheme]
  );

  const loadTemplates = async () => {
    const response = await axios.get(customApiUrl("/htmltemplates"), {
      headers: authHeaders()
    });
    const rows = response?.data?.templates || [];
    setTemplates(
      rows.map((row) => ({
        objectId: row.objectId,
        Name: row.Name || "Untitled HTML template",
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : null
      }))
    );
  };

  const loadTemplate = async (id) => {
    setRenderedPdf(null);
    setIsDirty(false);
    if (!id) {
      setForm(EMPTY_TEMPLATE);
      return;
    }
    const response = await axios.get(
      customApiUrl(`/htmltemplates/${encodeURIComponent(id)}`),
      { headers: authHeaders() }
    );
    const row = response?.data?.template;
    if (!row?.objectId) {
      throw new Error("Unable to load HTML template.");
    }
    setForm({
      Name: row.Name || "",
      HtmlContent: row.HtmlContent || "",
      DarkCss: row.DarkCss || "",
      LightCss: row.LightCss || ""
    });
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setMessage("");
        setSendResult(null);
        await Promise.all([loadTemplates(), loadTemplate(templateId)]);
      } catch (err) {
        console.error("HTML template load error", err);
        if (mounted) {
          setMessage(
            err?.response?.data?.error || err?.message || "Unable to load HTML template."
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const updateField = (field, value) => {
    setRenderedPdf(null);
    setIsDirty(true);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveTemplate = withSessionValidation(async (event) => {
    event.preventDefault();
    if (!form.Name.trim()) {
      setMessage("Template name is required.");
      return;
    }
    if (!form.HtmlContent.trim()) {
      setMessage("HTML is required.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await axios.post(
        customApiUrl("/savehtmltemplate"),
        {
          templateId: templateId || undefined,
          Name: form.Name,
          HtmlContent: form.HtmlContent,
          DarkCss: form.DarkCss,
          LightCss: form.LightCss
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...authHeaders()
          }
        }
      );
      const savedId = response?.data?.objectId;
      if (!savedId) {
        throw new Error("Template save did not return an objectId.");
      }

      setRenderedPdf(null);
      setIsDirty(false);
      setMessage("Saved.");

      if (!templateId) {
        navigate(`/html-template/${savedId}`, { replace: true });
      } else {
        try {
          await loadTemplates();
        } catch (listError) {
          console.error("HTML template list refresh error", listError);
        }
      }
    } catch (err) {
      console.error("HTML template save error", err);
      setMessage(
        err?.response?.data?.error || err?.message || "Unable to save HTML template."
      );
    } finally {
      setSaving(false);
    }
  });

  const renderPdf = withSessionValidation(async (theme) => {
    if (!templateId) {
      setMessage("Save the template before rendering a PDF.");
      return;
    }
    if (isDirty) {
      setMessage("Save your changes before rendering a PDF.");
      return;
    }
    setRenderingTheme(theme);
    setRenderedPdf(null);
    setMessage("");
    try {
      const response = await axios.post(
        customApiUrl("/htmltemplatetopdf"),
        { templateId, theme },
        {
          headers: {
            "Content-Type": "application/json",
            ...authHeaders()
          }
        }
      );
      if (!response?.data?.url) {
        throw new Error("Renderer did not return a PDF URL.");
      }
      setRenderedPdf({ theme, url: response.data.url });
      setMessage(`${theme === "dark" ? "Dark" : "Light"} PDF rendered.`);
    } catch (err) {
      console.error("HTML template render error", err);
      setMessage(
        err?.response?.data?.error || err?.message || "Unable to render PDF."
      );
    } finally {
      setRenderingTheme("");
    }
  });

  const openSendProposal = withSessionValidation(async () => {
    if (!templateId) {
      setMessage("Save the template before sending a proposal.");
      return;
    }
    if (isDirty) {
      setMessage("Save your changes before sending a proposal.");
      return;
    }
    setIsSendModal(true);
    setSendForm(EMPTY_SEND_FORM);
    setSendResult(null);
    setSendError("");
    setLoadingContracts(true);
    try {
      const response = await axios.get(customApiUrl("/contracttemplates"), {
        headers: authHeaders()
      });
      setContractTemplates(response?.data?.templates || []);
    } catch (err) {
      setSendError(
        err?.response?.data?.error || err?.message || "Unable to load contract templates."
      );
    } finally {
      setLoadingContracts(false);
    }
  });

  const sendProposal = withSessionValidation(async (event) => {
    event.preventDefault();
    if (
      !sendForm.recipientName.trim() ||
      !sendForm.recipientEmail.trim() ||
      !sendForm.contractTemplateId
    ) {
      setSendError("Recipient name, email, and contract template are required.");
      return;
    }
    setSendingProposal(true);
    setSendError("");
    setSendResult(null);
    try {
      const response = await axios.post(
        customApiUrl("/proposals"),
        {
          htmlTemplateId: templateId,
          contractTemplateId: sendForm.contractTemplateId,
          recipientName: sendForm.recipientName,
          recipientEmail: sendForm.recipientEmail
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...authHeaders()
          }
        }
      );
      setSendResult(response?.data || null);
    } catch (err) {
      setSendError(
        err?.response?.data?.error || err?.message || "Unable to send proposal."
      );
    } finally {
      setSendingProposal(false);
    }
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1800px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold">HTML templates</h1>
          <p className="text-sm opacity-70 mt-1">
            One HTML source, with independent dark and light stylesheets.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {templateId ? (
            <button
              type="button"
              className="op-btn op-btn-primary"
              disabled={isDirty || saving}
              onClick={openSendProposal}
            >
              Send proposal
            </button>
          ) : null}
          <button
            type="button"
            className="op-btn"
            onClick={() => navigate("/html-template")}
          >
            New HTML template
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_minmax(360px,1fr)] gap-4">
        <aside className="bg-base-100 rounded-box p-3 border border-base-content/10 min-w-0">
          <div className="font-medium mb-2">HTML templates</div>
          <div className="space-y-1">
            {templates.length === 0 ? (
              <p className="text-sm opacity-60 py-2">No HTML templates yet.</p>
            ) : (
              templates.map((item) => (
                <button
                  key={item.objectId}
                  type="button"
                  className={`w-full text-left rounded px-3 py-2 text-sm hover:bg-base-200 ${
                    item.objectId === templateId ? "bg-base-200" : ""
                  }`}
                  onClick={() => navigate(`/html-template/${item.objectId}`)}
                >
                  <span className="block truncate font-medium">{item.Name}</span>
                  <span className="block text-xs opacity-55 mt-0.5">
                    {item.updatedAt?.toLocaleString?.() || ""}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <form
          onSubmit={saveTemplate}
          className="bg-base-100 rounded-box p-4 border border-base-content/10 min-w-0"
        >
          <label className="block mb-4">
            <span className="block text-sm font-medium mb-1">Template name</span>
            <input
              className="op-input op-input-bordered w-full"
              value={form.Name}
              onChange={(event) => updateField("Name", event.target.value)}
              placeholder="Proposal template"
            />
          </label>

          {[
            ["HtmlContent", "HTML", "<main>...</main>"],
            ["DarkCss", "Dark CSS", "body { background: #111; color: #fff; }"],
            ["LightCss", "Light CSS", "body { background: #fff; color: #111; }"]
          ].map(([field, label, placeholder]) => (
            <label key={field} className="block mb-4">
              <span className="block text-sm font-medium mb-1">{label}</span>
              <textarea
                className="op-textarea op-textarea-bordered w-full font-mono text-xs min-h-44"
                spellCheck={false}
                value={form[field]}
                onChange={(event) => updateField(field, event.target.value)}
                placeholder={placeholder}
              />
            </label>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="op-btn op-btn-primary"
              type="submit"
              disabled={saving || Boolean(renderingTheme)}
            >
              {saving ? "Saving..." : "Save template"}
            </button>
            {isDirty ? <span className="text-sm opacity-60">Unsaved changes</span> : null}
            {message ? <span className="text-sm opacity-75">{message}</span> : null}
          </div>
        </form>

        <section className="bg-base-100 rounded-box p-4 border border-base-content/10 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <div className="font-medium">Preview</div>
              <div className="text-xs opacity-60">
                Scripts and remote resource loads are disabled.
              </div>
            </div>
            <div className="join">
              <button
                type="button"
                className={`op-btn op-btn-sm join-item ${
                  previewTheme === "dark" ? "op-btn-primary" : ""
                }`}
                onClick={() => setPreviewTheme("dark")}
              >
                Dark
              </button>
              <button
                type="button"
                className={`op-btn op-btn-sm join-item ${
                  previewTheme === "light" ? "op-btn-primary" : ""
                }`}
                onClick={() => setPreviewTheme("light")}
              >
                Light
              </button>
            </div>
          </div>
          <iframe
            title={`${previewTheme} template preview`}
            sandbox=""
            srcDoc={preview}
            className="w-full min-h-[760px] rounded border border-base-content/10 bg-white"
          />
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              className="op-btn op-btn-sm"
              disabled={!templateId || isDirty || saving || Boolean(renderingTheme)}
              onClick={() => renderPdf("dark")}
            >
              {renderingTheme === "dark" ? "Rendering..." : "Render dark PDF"}
            </button>
            <button
              type="button"
              className="op-btn op-btn-sm"
              disabled={!templateId || isDirty || saving || Boolean(renderingTheme)}
              onClick={() => renderPdf("light")}
            >
              {renderingTheme === "light" ? "Rendering..." : "Render light PDF"}
            </button>
            {renderedPdf?.url ? (
              <a
                className="op-btn op-btn-sm op-btn-primary"
                href={renderedPdf.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open {renderedPdf.theme} PDF
              </a>
            ) : null}
          </div>
        </section>
      </div>

      {isSendModal ? (
        <ModalUi
          isOpen
          title="Send proposal"
          handleClose={() => !sendingProposal && setIsSendModal(false)}
        >
          <div className="px-6 pb-6 min-w-[min(560px,90vw)]">
            {sendResult?.shareUrl ? (
              <div>
                <div className="font-semibold text-lg mb-2">Proposal created</div>
                <p className="text-sm opacity-70 mb-4">
                  {sendResult.emailSent
                    ? "The proposal email was sent."
                    : "The proposal was created, but email delivery was not confirmed. You can send the secure link manually."}
                </p>
                <div className="rounded border border-base-content/15 bg-base-200 p-3 mb-4">
                  <div className="text-xs opacity-60 mb-1">{sendResult.proposalNumber}</div>
                  <div className="text-sm break-all">{sendResult.shareUrl}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="op-btn op-btn-primary"
                    onClick={() => window.open(sendResult.shareUrl, "_blank", "noopener,noreferrer")}
                  >
                    Open proposal
                  </button>
                  <button
                    type="button"
                    className="op-btn"
                    onClick={() => navigator.clipboard?.writeText(sendResult.shareUrl)}
                  >
                    Copy link
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={sendProposal}>
                <p className="text-sm opacity-70 mb-4">
                  Sending freezes the current saved HTML and both stylesheets, generates the dark and print PDFs, and creates an immutable proposal snapshot.
                </p>
                <label className="block mb-3">
                  <span className="block text-sm font-medium mb-1">Client name</span>
                  <input
                    className="op-input op-input-bordered w-full"
                    value={sendForm.recipientName}
                    onChange={(event) =>
                      setSendForm((current) => ({
                        ...current,
                        recipientName: event.target.value
                      }))
                    }
                    required
                  />
                </label>
                <label className="block mb-3">
                  <span className="block text-sm font-medium mb-1">Client email</span>
                  <input
                    type="email"
                    className="op-input op-input-bordered w-full"
                    value={sendForm.recipientEmail}
                    onChange={(event) =>
                      setSendForm((current) => ({
                        ...current,
                        recipientEmail: event.target.value
                      }))
                    }
                    required
                  />
                </label>
                <label className="block mb-4">
                  <span className="block text-sm font-medium mb-1">Agreement template</span>
                  <select
                    className="op-select op-select-bordered w-full"
                    value={sendForm.contractTemplateId}
                    onChange={(event) =>
                      setSendForm((current) => ({
                        ...current,
                        contractTemplateId: event.target.value
                      }))
                    }
                    required
                    disabled={loadingContracts}
                  >
                    <option value="">
                      {loadingContracts ? "Loading..." : "Choose a one-signer OpenSign template"}
                    </option>
                    {contractTemplates.map((template) => (
                      <option key={template.objectId} value={template.objectId}>
                        {template.Name}
                      </option>
                    ))}
                  </select>
                  {!loadingContracts && contractTemplates.length === 0 ? (
                    <span className="block text-xs opacity-60 mt-1">
                      No eligible one-signer PDF contract templates were found.
                    </span>
                  ) : null}
                </label>
                {sendError ? (
                  <div className="text-sm text-red-500 mb-3">{sendError}</div>
                ) : null}
                <button
                  type="submit"
                  className="op-btn op-btn-primary"
                  disabled={sendingProposal || loadingContracts || contractTemplates.length === 0}
                >
                  {sendingProposal ? "Freezing and sending..." : "Send proposal"}
                </button>
              </form>
            )}
          </div>
        </ModalUi>
      ) : null}
    </div>
  );
}
