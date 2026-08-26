import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { cloudServerUrl, getSecureUrl, serverAppId } from '../../Utils.js';

const execFileAsync = promisify(execFile);
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const MAX_CONCURRENCY = Number(process.env.HTML2PDF_CONCURRENCY || 1);
let active = 0;
const queue = [];

function runWithLimit(task) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        active--;
        if (queue.length) queue.shift()();
      }
    };
    if (active < MAX_CONCURRENCY) run();
    else queue.push(run);
  });
}

function generatePdfName(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildDocument(sourceHtml, sourceCss, title) {
  const css = String(sourceCss || '').replace(/<\/style/gi, '<\\/style');
  const policy =
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const headContent = `<meta charset="utf-8"><title>${escapeHtml(title)}</title><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}${css}</style>`;
  const html = String(sourceHtml || '');

  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${headContent}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${headContent}</head>`);
  }
  return `<!doctype html><html><head>${headContent}</head><body>${html}</body></html>`;
}

async function renderWithChromium(html, title) {
  const workDir = await mkdtemp(path.join(tmpdir(), 'opensign-html-'));
  const htmlPath = path.join(workDir, 'template.html');
  const pdfPath = path.join(workDir, 'template.pdf');

  try {
    await writeFile(htmlPath, html, 'utf8');
    await execFileAsync(
      chromiumPath,
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`,
      ],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
    );
    const rendered = await readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(rendered);
    pdfDoc.setTitle(title);
    pdfDoc.setAuthor('Kodara');
    pdfDoc.setCreator('Kodara Sign');
    pdfDoc.setProducer('Kodara Sign');
    return Buffer.from(await pdfDoc.save());
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export default async function htmltemplatetopdf(req, res) {
  const { templateId, theme } = req.body || {};
  if (!templateId || !['dark', 'light'].includes(theme)) {
    return res.status(400).json({ error: 'templateId and theme (dark or light) are required.' });
  }

  const serverUrl = cloudServerUrl;
  const parseAppKey = { 'X-Parse-Application-Id': serverAppId };
  const masterHeader = { ...parseAppKey, 'X-Parse-Master-Key': process.env.MASTER_KEY };
  const sessionToken = req.headers['sessiontoken'];
  if (!sessionToken) return res.status(401).json({ error: 'Missing session token.' });
  const sessionHeader = { ...parseAppKey, 'X-Parse-Session-Token': sessionToken };

  try {
    const userRes = await axios.get(`${serverUrl}/users/me`, { headers: sessionHeader });
    const whereUser = JSON.stringify({
      UserId: { __type: 'Pointer', className: '_User', objectId: userRes.data.objectId },
    });
    const resUser = await axios.get(
      `${serverUrl}/classes/contracts_Users?where=${encodeURIComponent(whereUser)}&limit=1&include=TenantId`,
      { headers: masterHeader }
    );
    const extUser = resUser?.data?.results?.[0];
    if (!extUser?.objectId || !extUser?.TenantId?.objectId) {
      return res.status(403).json({ error: 'User not linked to tenant.' });
    }

    const templateRes = await axios.get(`${serverUrl}/classes/contracts_Template/${templateId}`, {
      headers: masterHeader,
    });
    const template = templateRes?.data;
    if (template?.TemplateType !== 'html') {
      return res.status(400).json({ error: 'Template is not an HTML template.' });
    }
    if (template?.ExtUserPtr?.objectId !== extUser.objectId) {
      return res.status(403).json({ error: 'Template does not belong to the current user.' });
    }

    const htmlSource = template.HtmlContent || '';
    const cssSource = theme === 'dark' ? template.DarkCss || '' : template.LightCss || '';
    if (!htmlSource.trim()) return res.status(400).json({ error: 'Template HTML is empty.' });
    if (Buffer.byteLength(htmlSource, 'utf8') > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'Template HTML is too large.' });
    }
    if (Buffer.byteLength(cssSource, 'utf8') > 2 * 1024 * 1024) {
      return res.status(413).json({ error: 'Template CSS is too large.' });
    }

    const title = `${template.Name || 'Kodara Proposal'} — ${theme === 'dark' ? 'Dark' : 'Print-Friendly'}`;
    const documentHtml = buildDocument(htmlSource, cssSource, title);
    const pdfBuffer = await runWithLimit(() => renderWithChromium(documentHtml, title));
    const fileName = `${generatePdfName(16)}-${theme}.pdf`;
    const activeFileAdapter = extUser?.TenantId?.ActiveFileAdapter;
    let fileUrl;

    if (activeFileAdapter) {
      const params = {
        fileBase64: Buffer.from(pdfBuffer).toString('base64'),
        fileName,
        id: activeFileAdapter,
      };
      const uploadRes = await axios.post(`${serverUrl}/functions/savetofileadapter`, params, {
        headers: { 'Content-Type': 'application/json', ...sessionHeader },
      });
      fileUrl = uploadRes?.data?.result?.url;
      if (!fileUrl) throw new Error('No URL returned from file adapter');
    } else {
      const parseFile = await axios.post(`${serverUrl}/files/${fileName}`, pdfBuffer, {
        headers: { ...masterHeader, 'Content-Type': 'application/pdf' },
      });
      fileUrl = getSecureUrl(parseFile.data.url).url;
    }

    return res.status(200).json({ message: 'success', url: fileUrl, theme, fileName });
  } catch (error) {
    const status = error?.response?.status === 401 ? 401 : 400;
    const detail = error?.response?.data?.error || error?.message || 'HTML to PDF rendering failed.';
    console.error(`[HTML2PDF] ${detail}`);
    return res.status(status).json({ error: 'Unable to render HTML template to PDF.' });
  }
}
