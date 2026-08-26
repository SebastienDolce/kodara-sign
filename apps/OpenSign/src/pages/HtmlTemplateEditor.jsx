import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import Parse from "parse";
import axios from "axios";
import DOMPurify from "dompurify";
import Loader from "../primitives/Loader";
import { removeTrailingSegment } from "../constant/Utils";
import { withSessionValidation } from "../utils";

const EMPTY_TEMPLATE = {
  Name: "",
  HtmlContent: "",
  DarkCss: "",
  LightCss: ""
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

export default function HtmlTemplateEditor() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [templates, setTemplates] = useState([]);
  const [previewTheme, setPreviewTheme] = useState("dark");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [renderingTheme, setRenderingTheme] = useState("");
  const [renderedPdf, setRenderedPdf] = useState(null);
  const [message, setMessage] = useState("");

  const preview = useMemo(
    () =>
      buildPreview(
        form.HtmlContent,
        previewTheme === "dark" ? form.DarkCss : form.LightCss
      ),
    [form, previewTheme]
  );

  const loadTemplates = async () => {
    const query = new Parse.Query("contracts_Template");
    query.equalTo("TemplateType", "html");
    query.notEqualTo("IsArchive", true);
    query.descending("updatedAt");
    query.limit(100);
    const rows = await query.find();
    setTemplates(
      rows.map((row) => ({
        objectId: row.id,
        Name: row.get("Name") || "Untitled HTML template",
        updatedAt: row.updatedAt
      }))
    );
  };

  const loadTemplate = async (id) => {
    setRenderedPdf(null);
    if (!id) {
      setForm(EMPTY_TEMPLATE);
      return;
    }
    const query = new Parse.Query("contracts_Template");
    const row = await query.get(id);
    if (row.get("TemplateType") !== "html") {
      throw new Error("This is not an HTML template.");
    }
    setForm({
      Name: row.get("Name") || "",
      HtmlContent: row.get("HtmlContent") || "",
      DarkCss: row.get("DarkCss") || "",
      LightCss: row.get("LightCss") || ""
    });
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadTemplates(), loadTemplate(templateId)]);
      } catch (err) {
        console.error("HTML template load error", err);
        if (mounted) setMessage(err?.message || "Unable to load HTML template.");
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
      const currentUser = Parse.User.current();
      const ExtCls = JSON.parse(localStorage.getItem("Extand_Class") || "[]");
      const extUser = ExtCls?.[0];
      if (!currentUser || !extUser?.objectId) {
        throw new Error("Unable to resolve the current OpenSign user.");
      }

      let object;
      if (templateId) {
        object = await new Parse.Query("contracts_Template").get(templateId);
        if (object.get("TemplateType") !== "html") {
          throw new Error("This is not an HTML template.");
        }
      } else {
        object = new Parse.Object("contracts_Template");
        object.set("CreatedBy", Parse.User.createWithoutData(currentUser.id));
        object.set("ExtUserPtr", {
          __type: "Pointer",
          className: "contracts_Users",
          objectId: extUser.objectId
        });
      }

      object.set("Name", form.Name.trim());
      object.set("TemplateType", "html");
      object.set("HtmlContent", form.HtmlContent);
      object.set("DarkCss", form.DarkCss);
      object.set("LightCss", form.LightCss);
      object.set("IsArchive", false);
      const saved = await object.save();
      await loadTemplates();
      setRenderedPdf(null);
      setMessage("Saved.");
      if (!templateId) {
        navigate(`/html-template/${saved.id}`, { replace: true });
      }
    } catch (err) {
      console.error("HTML template save error", err);
      setMessage(err?.message || "Unable to save HTML template.");
    } finally {
      setSaving(false);
    }
  });

  const renderPdf = withSessionValidation(async (theme) => {
    if (!templateId) {
      setMessage("Save the template before rendering a PDF.");
      return;
    }
    setRenderingTheme(theme);
    setRenderedPdf(null);
    setMessage("");
    try {
      const baseApi = localStorage.getItem("baseUrl") || "";
      const url = `${removeTrailingSegment(baseApi)}/htmltemplatetopdf`;
      const response = await axios.post(
        url,
        { templateId, theme },
        {
          headers: {
            "Content-Type": "application/json",
            sessiontoken: Parse.User.current().getSessionToken()
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
        <button
          type="button"
          className="op-btn op-btn-primary"
          onClick={() => navigate("/html-template")}
        >
          New HTML template
        </button>
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
              disabled={!templateId || saving || Boolean(renderingTheme)}
              onClick={() => renderPdf("dark")}
            >
              {renderingTheme === "dark" ? "Rendering..." : "Render dark PDF"}
            </button>
            <button
              type="button"
              className="op-btn op-btn-sm"
              disabled={!templateId || saving || Boolean(renderingTheme)}
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
    </div>
  );
}
