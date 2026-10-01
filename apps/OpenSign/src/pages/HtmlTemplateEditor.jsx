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
  recipients: [
    { name: "", email: "" },
    { name: "", email: "" }
  ],
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

  const updateSendRecipient = (index, field, value) => {
    setSendForm((current) => ({
      ...current,
      recipients: current.recipients.map((recipient, recipientIndex) =>
        recipientIndex === index ? { ...recipient, [field]: value } : recipient
      )
    }));
  };

  const sendProposal = withSessionValidation(async (event) => {
    event.preventDefault();
    const normalizedRecipients = sendForm.recipients.map((recipient) => ({
      name: recipient.name.trim(),
      email: recipient.email.trim()
    }));
    const primaryRecipient = normalizedRecipients[0];
    const secondaryRecipient = normalizedRecipients[1];
    const secondaryStarted = Boolean(
      secondaryRecipient.name || secondaryRecipient.email
    );

    if (
      !primaryRecipient.name ||
      !primaryRecipient.email ||
      !sendForm.contractTemplateId
    ) {
      setSendError("Recipient 1 name, email, and contract template are required.");
      return;
    }
    if (
      secondaryStarted &&
      (!secondaryRecipient.name || !secondaryRecipient.email)
    ) {
      setSendError("Recipient 2 needs both a name and email address.");
      return;
    }

    const recipients = secondaryStarted
      ? [primaryRecipient, secondaryRecipient]
      : [primaryRecipient];
    const uniqueEmails = new Set(
      recipients.map((recipient) => recipient.email.toLowerCase())
    );
    if (uniqueEmails.size !== recipients.length) {
      setSendError("Recipients must use different email addresses.");
      return;
    }

    const selectedTemplate = contractTemplates.find(
      (template) => template.objectId === sendForm.contractTemplateId
    );
    if (
      recipients.length > 1 &&
      Number(selectedTemplate?.signerRoleCount || 0) !== 1
    ) {
      setSendError(
        "Two-recipient proposals require an agreement template with exactly one signer role."
      );
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
          recipients
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

  const secondRecipientStarted = Boolean(
    sendForm.recipients?.[1]?.name?.trim() ||
      sendForm.recipients?.[1]?.email?.trim()
  );

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
                    ? (sendResult.recipientLinks?.length || 0) > 1
                      ? "The proposal emails were sent to both authorized recipients. Either person can accept; the first to accept becomes the agreement signer."
                      : "The proposal email was sent."
                    : "The proposal was created, but email delivery was not confirmed for every recipient. You can send the secure recipient link manually."}
                </p>
                <div className="text-xs opacity-60 mb-2">{sendResult.proposalNumber}</div>
                <div className="space-y-3">
                  {(sendResult.recipientLinks?.length
                    ? sendResult.recipientLinks
                    : [{ name: "Recipient", email: "", shareUrl: sendResult.shareUrl }]
                  ).map((recipient) => {
                    const delivery = sendResult.emailResults?.find(
                      (result) => result.email === recipient.email
                    );
                    return (
                      <div
                        key={recipient.email || recipient.shareUrl}
                        className="rounded border border-base-content/15 bg-base-200 p-3"
                      >
                        <div className="text-sm font-medium">
                          {recipient.name || recipient.email || "Recipient"}
                        </div>
                        {recipient.email ? (
                          <div className="text-xs opacity-60 mt-0.5">
                            {recipient.email}
                            {delivery
                              ? delivery.sent
                                ? " · Email sent"
                                : " · Email delivery not confirmed"
                              : ""}
                          </div>
                        ) : null}
                        <div className="text-xs break-all mt-2 opacity-80">
                          {recipient.shareUrl}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            type="button"
                            className="op-btn op-btn-sm op-btn-primary"
                            onClick={() =>
                              window.open(
                                recipient.shareUrl,
                                "_blank",
                                "noopener,noreferrer"
                              )
                            }
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            className="op-btn op-btn-sm"
                            onClick={() =>
                              navigator.clipboard?.writeText(recipient.shareUrl)
                            }
                          >
                            Copy link
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <form onSubmit={sendProposal}>
                <p className="text-sm opacity-70 mb-4">
                  Sending freezes the current saved HTML and both stylesheets, generates the dark and print PDFs, and creates an immutable proposal snapshot.
                </p>
                <div className="space-y-3 mb-4">
                  {sendForm.recipients.map((recipient, index) => (
                    <div
                      key={index}
                      className="rounded border border-base-content/15 p-3"
                    >
                      <div className="text-sm font-medium mb-2">
                        Recipient {index + 1}
                        {index === 1 ? (
                          <span className="font-normal opacity-60"> (optional)</span>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="block">
                          <span className="block text-xs opacity-70 mb-1">Name</span>
                          <input
                            className="op-input op-input-bordered w-full"
                            value={recipient.name}
                            onChange={(event) =>
                              updateSendRecipient(index, "name", event.target.value)
                            }
                            required={index === 0}
                          />
                        </label>
                        <label className="block">
                          <span className="block text-xs opacity-70 mb-1">Email</span>
                          <input
                            type="email"
                            className="op-input op-input-bordered w-full"
                            value={recipient.email}
                            onChange={(event) =>
                              updateSendRecipient(index, "email", event.target.value)
                            }
                            required={index === 0}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs opacity-60 mb-4">
                  Add Recipient 2 when either person may sign. Each recipient gets a
                  different secure proposal link; the first person to accept becomes
                  the agreement signer.
                </p>
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
                      {loadingContracts ? "Loading..." : "Choose an OpenSign template"}
                    </option>
                    {contractTemplates.map((template) => (
                      <option
                        key={template.objectId}
                        value={template.objectId}
                        disabled={
                          secondRecipientStarted &&
                          Number(template.signerRoleCount || 0) !== 1
                        }
                      >
                        {template.Name}
                        {template.signerRoleCount
                          ? ` — ${template.signerRoleCount} signer${template.signerRoleCount === 1 ? "" : "s"}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {!loadingContracts && contractTemplates.length === 0 ? (
                    <span className="block text-xs opacity-60 mt-1">
                      No eligible PDF contract templates were found.
                    </span>
                  ) : secondRecipientStarted ? (
                    <span className="block text-xs opacity-60 mt-1">
                      With two recipients, use a one-signer agreement template.
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
