import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash, randomBytes } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { cloudServerUrl, getSecureUrl, serverAppId } from '../../Utils.js';
import {
  hashRecipientToken,
  normalizeEmail,
  requestedProposalRecipients,
  resolveProposalRecipient,
  storedProposalRecipients,
} from './proposalRecipients.js';

const execFileAsync = promisify(execFile);
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_CSS_BYTES = 2 * 1024 * 1024;
let activeRenders = 0;
const renderQueue = [];

const sha256 = value => createHash('sha256').update(value).digest('hex');
const ptr = (className, objectId) => ({ __type: 'Pointer', className, objectId });
const proposalAcceptanceInFlight = new Set();
const escapeHtml = value =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function runRender(task) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeRenders++;
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        activeRenders--;
        if (renderQueue.length) renderQueue.shift()();
      }
    };
    if (activeRenders < Number(process.env.HTML2PDF_CONCURRENCY || 1)) run();
    else renderQueue.push(run);
  });
}

function buildDocument(sourceHtml, sourceCss, title) {
  const css = String(sourceCss || '').replace(/<\/style/gi, '<\\/style');
  const policy =
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const head = `<meta charset="utf-8"><title>${escapeHtml(title)}</title><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}${css}</style>`;
  const html = String(sourceHtml || '');
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, match => `${match}${head}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, match => `${match}<head>${head}</head>`);
  }
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

async function renderPdf(html, title) {
  return runRender(async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), 'opensign-proposal-'));
    const htmlPath = path.join(workDir, 'proposal.html');
    const pdfPath = path.join(workDir, 'proposal.pdf');
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
  });
}

function authHeaders(sessionToken) {
  const app = { 'X-Parse-Application-Id': serverAppId };
  return {
    session: { ...app, 'X-Parse-Session-Token': sessionToken },
    master: { ...app, 'X-Parse-Master-Key': process.env.MASTER_KEY },
  };
}

async function resolveSender(req) {
  const sessionToken = req.headers['sessiontoken'];
  if (!sessionToken) {
    const error = new Error('Missing session token.');
    error.status = 401;
    throw error;
  }
  const headers = authHeaders(sessionToken);
  const userRes = await axios.get(`${cloudServerUrl}/users/me`, { headers: headers.session });
  const user = userRes?.data;
  if (!user?.objectId) {
    const error = new Error('Invalid session.');
    error.status = 401;
    throw error;
  }
  const where = JSON.stringify({ UserId: ptr('_User', user.objectId) });
  const extRes = await axios.get(
    `${cloudServerUrl}/classes/contracts_Users?where=${encodeURIComponent(where)}&limit=1&include=TenantId`,
    { headers: headers.master }
  );
  const extUser = extRes?.data?.results?.[0];
  if (!extUser?.objectId || !extUser?.TenantId?.objectId) {
    const error = new Error('User not linked to OpenSign account.');
    error.status = 403;
    throw error;
  }
  return { sessionToken, headers, user, extUser };
}

async function uploadPdf(pdfBuffer, fileName, sender) {
  const activeFileAdapter = sender.extUser?.TenantId?.ActiveFileAdapter;
  if (activeFileAdapter) {
    const upload = await axios.post(
      `${cloudServerUrl}/functions/savetofileadapter`,
      {
        fileBase64: Buffer.from(pdfBuffer).toString('base64'),
        fileName,
        id: activeFileAdapter,
      },
      { headers: { 'Content-Type': 'application/json', ...sender.headers.session } }
    );
    const url = upload?.data?.result?.url;
    if (!url) throw new Error('No URL returned from file adapter.');
    return url;
  }
  const uploaded = await axios.post(`${cloudServerUrl}/files/${encodeURIComponent(fileName)}`, pdfBuffer, {
    headers: { ...sender.headers.master, 'Content-Type': 'application/pdf' },
  });
  return getSecureUrl(uploaded.data.url).url;
}

async function getOwnedTemplate(templateId, sender) {
  const response = await axios.get(
    `${cloudServerUrl}/classes/contracts_Template/${encodeURIComponent(templateId)}`,
    { headers: sender.headers.master }
  );
  const template = response?.data;
  if (template?.ExtUserPtr?.objectId !== sender.extUser.objectId) {
    const error = new Error('Template does not belong to the current user.');
    error.status = 403;
    throw error;
  }
  return template;
}

async function ensureContact(sender, name, email) {
  const where = JSON.stringify({
    CreatedBy: ptr('_User', sender.user.objectId),
    Email: email,
    IsDeleted: { $ne: true },
  });
  const existing = await axios.get(
    `${cloudServerUrl}/classes/contracts_Contactbook?where=${encodeURIComponent(where)}&limit=1&include=UserId`,
    { headers: sender.headers.master }
  );
  if (existing?.data?.results?.[0]?.objectId) return existing.data.results[0];

  try {
    const created = await axios.post(
      `${cloudServerUrl}/functions/savecontact`,
      { name, email, tenantId: sender.extUser.TenantId.objectId },
      { headers: { 'Content-Type': 'application/json', ...sender.headers.session } }
    );
    if (created?.data?.result?.objectId) return created.data.result;
  } catch {
    // A concurrent/previous contact may have won the create. Re-read below.
  }

  const retry = await axios.get(
    `${cloudServerUrl}/classes/contracts_Contactbook?where=${encodeURIComponent(where)}&limit=1&include=UserId`,
    { headers: sender.headers.master }
  );
  if (retry?.data?.results?.[0]?.objectId) return retry.data.results[0];
  throw new Error('Unable to create or resolve proposal recipient contact.');
}

function signerRoles(template) {
  return (template?.Placeholders || []).filter(
    item => String(item?.Role || '').toLowerCase() !== 'prefill'
  );
}

function hasSignerRole(template) {
  return signerRoles(template).length > 0;
}

export async function listContractTemplates(req, res) {
  try {
    const sender = await resolveSender(req);
    const where = JSON.stringify({
      IsArchive: { $ne: true },
      TemplateType: { $ne: 'html' },
      ExtUserPtr: ptr('contracts_Users', sender.extUser.objectId),
    });
    const result = await axios.get(
      `${cloudServerUrl}/classes/contracts_Template?where=${encodeURIComponent(where)}&order=-updatedAt&limit=100&keys=Name,Placeholders,URL`,
      { headers: sender.headers.master }
    );
    const templates = (result?.data?.results || [])
      .filter(item => item.URL && hasSignerRole(item))
      .map(item => ({
        objectId: item.objectId,
        Name: item.Name || 'Untitled contract',
        signerRoleCount: signerRoles(item).length,
      }));
    return res.status(200).json({ templates });
  } catch (error) {
    return routeError(res, error, 'Unable to list contract templates.');
  }
}

export async function sendProposal(req, res) {
  try {
    const sender = await resolveSender(req);
    const { htmlTemplateId, contractTemplateId } = req.body || {};
    const recipients = requestedProposalRecipients(req.body || {});
    if (!htmlTemplateId || !contractTemplateId) {
      return res.status(400).json({ error: 'Proposal template and contract template are required.' });
    }

    const htmlTemplate = await getOwnedTemplate(htmlTemplateId, sender);
    if (htmlTemplate.TemplateType !== 'html') {
      return res.status(400).json({ error: 'Proposal source must be an HTML template.' });
    }
    const contractTemplate = await getOwnedTemplate(contractTemplateId, sender);
    const contractSignerRoles = signerRoles(contractTemplate);
    if (contractTemplate.TemplateType === 'html' || !contractTemplate.URL || !contractSignerRoles.length) {
      return res.status(400).json({ error: 'Contract template must be a normal OpenSign template with at least one signer role.' });
    }
    if (recipients.length > 1 && contractSignerRoles.length !== 1) {
      return res.status(400).json({
        error: 'Either-recipient proposals require an OpenSign agreement template with exactly one signer role.',
      });
    }

    const html = String(htmlTemplate.HtmlContent || '');
    const darkCss = String(htmlTemplate.DarkCss || '');
    const lightCss = String(htmlTemplate.LightCss || '');
    if (!html.trim()) return res.status(400).json({ error: 'Proposal HTML is empty.' });
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return res.status(413).json({ error: 'Proposal HTML is too large.' });
    if (Buffer.byteLength(darkCss, 'utf8') > MAX_CSS_BYTES || Buffer.byteLength(lightCss, 'utf8') > MAX_CSS_BYTES) {
      return res.status(413).json({ error: 'Proposal CSS is too large.' });
    }

    const proposalNumber = `KOD-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const darkTitle = `${proposalNumber} — Accepted Proposal`;
    const lightTitle = `${proposalNumber} — Print-Friendly Proposal`;
    const [darkPdf, lightPdf] = await Promise.all([
      renderPdf(buildDocument(html, darkCss, darkTitle), darkTitle),
      renderPdf(buildDocument(html, lightCss, lightTitle), lightTitle),
    ]);
    const [darkPdfUrl, lightPdfUrl] = await Promise.all([
      uploadPdf(darkPdf, `${proposalNumber}.pdf`, sender),
      uploadPdf(lightPdf, `${proposalNumber}-print.pdf`, sender),
    ]);
    const snapshotHash = sha256(
      JSON.stringify({
        html,
        darkCss,
        lightCss,
        darkPdf: sha256(darkPdf),
        lightPdf: sha256(lightPdf),
      })
    );
    const publicToken = randomBytes(32).toString('base64url');
    const resolvedRecipients = await Promise.all(
      recipients.map(async recipient => {
        const contact = await ensureContact(sender, recipient.name, recipient.email);
        const recipientToken =
          recipients.length > 1 ? randomBytes(32).toString('base64url') : '';
        return {
          ...recipient,
          contactBookId: contact.objectId,
          recipientToken,
          tokenHash: recipientToken ? hashRecipientToken(recipientToken) : '',
        };
      })
    );
    const primaryRecipient = resolvedRecipients[0];
    const now = new Date().toISOString();
    const payload = {
      ProposalNumber: proposalNumber,
      Name: htmlTemplate.Name || proposalNumber,
      Status: 'sent',
      RecipientName: primaryRecipient.name,
      RecipientEmail: primaryRecipient.email,
      HtmlContent: html,
      DarkCss: darkCss,
      LightCss: lightCss,
      DarkPdfUrl: darkPdfUrl,
      LightPdfUrl: lightPdfUrl,
      SnapshotHash: snapshotHash,
      PublicTokenHash: sha256(publicToken),
      HtmlTemplateId: htmlTemplateId,
      ContractTemplateId: contractTemplateId,
      ContactBookId: primaryRecipient.contactBookId,
      AuthorizedRecipients: resolvedRecipients.map(recipient => ({
        name: recipient.name,
        email: recipient.email,
        contactBookId: recipient.contactBookId,
        tokenHash: recipient.tokenHash,
      })),
      SentAt: { __type: 'Date', iso: now },
      CreatedBy: ptr('_User', sender.user.objectId),
      ExtUserPtr: ptr('contracts_Users', sender.extUser.objectId),
    };
    const saved = await axios.post(`${cloudServerUrl}/classes/contracts_Proposal`, payload, {
      headers: { ...sender.headers.master, 'Content-Type': 'application/json' },
    });
    const proposalId = saved?.data?.objectId;
    if (!proposalId) throw new Error('Proposal save did not return an objectId.');

    const publicBase = req.headers['public_url'] || `https://${req.get('host')}`;
    const baseShareUrl = `${publicBase}/proposal/${publicToken}`;
    const recipientLinks = resolvedRecipients.map(recipient => ({
      name: recipient.name,
      email: recipient.email,
      shareUrl: recipient.recipientToken
        ? `${baseShareUrl}?recipient=${encodeURIComponent(recipient.recipientToken)}`
        : baseShareUrl,
    }));
    const senderName = sender.user?.name || sender.extUser?.Company || 'Kodara';
    const emailResults = await Promise.all(
      recipientLinks.map(async recipient => {
        try {
          const mail = await axios.post(
            `${cloudServerUrl}/functions/sendmailv3`,
            {
              recipient: recipient.email,
              subject: `${senderName} sent you ${htmlTemplate.Name || 'a proposal'}`,
              text: `Review your proposal: ${recipient.shareUrl}`,
              html: `<div style="background:#111;color:#f5f5f5;padding:32px;font-family:Arial,sans-serif"><h2 style="margin:0 0 16px">Your proposal is ready</h2><p>${senderName} has sent you <strong>${htmlTemplate.Name || proposalNumber}</strong>.</p><p><a href="${recipient.shareUrl}" style="display:inline-block;background:#ef2b2d;color:white;text-decoration:none;padding:12px 18px;font-weight:700">Review proposal</a></p><p style="color:#aaa;font-size:12px;margin-top:28px">${proposalNumber}</p></div>`,
              from: senderName,
              replyto: sender.user?.email || '',
              extUserId: sender.extUser.objectId,
            },
            { headers: { 'Content-Type': 'application/json', ...sender.headers.session } }
          );
          return { email: recipient.email, sent: mail?.data?.result?.status === 'success' };
        } catch (error) {
          console.error(
            `[PROPOSAL] Email failed for ${proposalNumber} to ${recipient.email}: ${error?.message}`
          );
          return { email: recipient.email, sent: false };
        }
      })
    );
    const emailSent = emailResults.every(result => result.sent);

    return res.status(201).json({
      proposalId,
      proposalNumber,
      shareUrl: recipientLinks[0]?.shareUrl || baseShareUrl,
      recipientLinks,
      emailSent,
      emailResults,
      snapshotHash,
    });
  } catch (error) {
    return routeError(res, error, 'Unable to send proposal.');
  }
}

async function findProposalByToken(token) {
  const hash = sha256(String(token || ''));
  const headers = authHeaders('').master;
  const where = JSON.stringify({ PublicTokenHash: hash });
  const response = await axios.get(
    `${cloudServerUrl}/classes/contracts_Proposal?where=${encodeURIComponent(where)}&limit=1`,
    { headers }
  );
  return response?.data?.results?.[0];
}

export async function getPublicProposal(req, res) {
  try {
    const proposal = await findProposalByToken(req.params?.token);
    if (!proposal?.objectId) return res.status(404).json({ error: 'Proposal not found.' });
    const recipient = resolveProposalRecipient(proposal, req.query?.recipient);
    const acceptedRecipientEmail = normalizeEmail(proposal.AcceptedRecipientEmail);
    const acceptedByOther =
      Boolean(acceptedRecipientEmail) && acceptedRecipientEmail !== recipient.email;
    return res.status(200).json({
      proposal: {
        proposalNumber: proposal.ProposalNumber,
        name: proposal.Name,
        status: proposal.Status,
        recipientName: recipient.name || recipient.email,
        html: proposal.HtmlContent,
        darkCss: proposal.DarkCss,
        lightCss: proposal.LightCss,
        snapshotHash: proposal.SnapshotHash,
        sentAt: proposal.SentAt,
        acceptedAt: proposal.AcceptedAt,
        hasContract: Boolean(proposal.ContractTemplateId),
        authorizedRecipientCount: storedProposalRecipients(proposal).length,
        acceptedByOther,
      },
    });
  } catch (error) {
    return routeError(res, error, 'Unable to load proposal.');
  }
}

async function createContractForProposal(proposal, token, req, recipient, recipientToken = '') {
  const headers = authHeaders('').master;
  const templateRes = await axios.get(
    `${cloudServerUrl}/classes/contracts_Template/${encodeURIComponent(proposal.ContractTemplateId)}`,
    { headers }
  );
  const template = templateRes?.data;
  if (!template?.URL || !hasSignerRole(template)) {
    throw new Error('Contract template is no longer available or has no signer roles.');
  }
  const recipientEmail = normalizeEmail(recipient?.email || proposal.RecipientEmail);
  const contactBookId = recipient?.contactBookId || proposal.ContactBookId;
  const contactRes = await axios.get(
    `${cloudServerUrl}/classes/contracts_Contactbook/${encodeURIComponent(contactBookId)}?include=UserId`,
    { headers }
  );
  const contact = contactRes?.data;
  if (!contact?.objectId || !contact?.UserId?.objectId) throw new Error('Proposal recipient contact is unavailable.');

  const contactPtr = ptr('contracts_Contactbook', contact.objectId);
  const sourcePlaceholders = JSON.parse(JSON.stringify(template.Placeholders || []));
  const signerRoles = sourcePlaceholders.filter(
    role => String(role?.Role || '').toLowerCase() !== 'prefill'
  );
  const assignedSignerIds = [
    ...new Set(
      signerRoles
        .map(role => role?.signerObjId || role?.signerPtr?.objectId)
        .filter(Boolean)
    ),
  ];
  const recipientSignerIds = new Set([contact.objectId]);

  if (assignedSignerIds.length) {
    const where = JSON.stringify({ objectId: { $in: assignedSignerIds } });
    const assignedContactsRes = await axios.get(
      `${cloudServerUrl}/classes/contracts_Contactbook?where=${encodeURIComponent(where)}&limit=100&keys=Email`,
      { headers }
    );
    for (const assignedContact of assignedContactsRes?.data?.results || []) {
      if (normalizeEmail(assignedContact?.Email) === recipientEmail) {
        recipientSignerIds.add(assignedContact.objectId);
      }
    }
  }

  const isRecipientRole = role => {
    const signerId = role?.signerObjId || role?.signerPtr?.objectId;
    return Boolean(signerId && recipientSignerIds.has(signerId));
  };
  const matchedRecipientRoles = signerRoles.filter(isRecipientRole);
  if (signerRoles.length > 1 && matchedRecipientRoles.length === 0) {
    throw new Error(
      'The proposal recipient email must match a contact already assigned to a signer role in the contract template.'
    );
  }

  const placeholders = sourcePlaceholders.map(role => {
    if (String(role?.Role || '').toLowerCase() === 'prefill') return role;
    if (signerRoles.length === 1 || isRecipientRole(role)) {
      return { ...role, signerPtr: contactPtr, signerObjId: contact.objectId };
    }
    return role;
  });

  const signers = [];
  const seenSignerIds = new Set();
  for (const role of placeholders) {
    if (String(role?.Role || '').toLowerCase() === 'prefill') continue;
    const signerId = role?.signerObjId || role?.signerPtr?.objectId;
    if (!signerId) {
      throw new Error('Every signer role in the contract template must be assigned to a contact.');
    }
    if (seenSignerIds.has(signerId)) continue;
    seenSignerIds.add(signerId);
    signers.push(role?.signerPtr?.objectId ? role.signerPtr : ptr('contracts_Contactbook', signerId));
  }

  const publicBase = req.headers['public_url'] || `https://${req.get('host')}`;
  const document = {
    Name: template.Name || `${proposal.ProposalNumber} Agreement`,
    URL: template.URL,
    ExtUserPtr: template.ExtUserPtr || proposal.ExtUserPtr,
    CreatedBy: template.CreatedBy || proposal.CreatedBy,
    OriginIp: req.headers['x-real-ip'] || '',
    SentToOthers: true,
    IsSendMail: false,
    SendinOrder: template.SendinOrder || false,
    SendInOrderStrict: template.SendInOrderStrict || false,
    IsEnableOTP: template.IsEnableOTP || false,
    IsTourEnabled: template.IsTourEnabled || false,
    AllowModifications: template.AllowModifications || false,
    AutomaticReminders: template.AutomaticReminders || false,
    NotifyOnSignatures: template.NotifyOnSignatures || false,
    TimeToCompleteDays: Number(template.TimeToCompleteDays || 15),
    RemindOnceInEvery: Number(template.RemindOnceInEvery || 5),
    RedirectUrl: `${publicBase}/proposal/${token}?signed=1${recipientToken ? `&recipient=${encodeURIComponent(recipientToken)}` : ''}`,
    Signers: signers,
    Placeholders: placeholders,
    SignatureType: template.SignatureType || [],
    DocSentAt: { __type: 'Date', iso: new Date().toISOString() },
  };
  if (template.Bcc) document.Bcc = template.Bcc;
  if (template.Cc) document.Cc = template.Cc;
  const created = await axios.post(`${cloudServerUrl}/classes/contracts_Document`, document, {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
  const documentId = created?.data?.objectId;
  if (!documentId) throw new Error('Contract document creation failed.');
  const loginPayload = `${documentId}/${recipientEmail}/${contact.objectId}/false`;
  const encoded = Buffer.from(loginPayload, 'utf8').toString('base64url');
  return { documentId, contactId: contact.objectId, signingUrl: `${publicBase}/login/${encoded}` };
}

export async function acceptProposal(req, res) {
  const token = req.params?.token;
  let lockedProposalId = '';
  try {
    const proposal = await findProposalByToken(token);
    if (!proposal?.objectId) return res.status(404).json({ error: 'Proposal not found.' });

    const recipientToken = String(req.body?.recipientToken || req.query?.recipient || '');
    const recipient = resolveProposalRecipient(proposal, recipientToken);
    const acceptedRecipientEmail = normalizeEmail(proposal.AcceptedRecipientEmail);
    if (acceptedRecipientEmail && acceptedRecipientEmail !== recipient.email) {
      return res.status(409).json({
        error: 'Another authorized recipient has already accepted this proposal.',
      });
    }

    if (proposalAcceptanceInFlight.has(proposal.objectId)) {
      return res.status(409).json({
        error: 'This proposal is already being accepted. Please try again in a moment.',
      });
    }
    proposalAcceptanceInFlight.add(proposal.objectId);
    lockedProposalId = proposal.objectId;

    const master = authHeaders('').master;
    const winningEmail = acceptedRecipientEmail || recipient.email;
    const winningName = proposal.AcceptedRecipientName || recipient.name;
    const winningContactBookId = proposal.AcceptedContactBookId || recipient.contactBookId;

    if (proposal.ContractDocumentId && proposal.ContractDocumentId !== 'creating') {
      const publicBase = req.headers['public_url'] || `https://${req.get('host')}`;
      const loginPayload = `${proposal.ContractDocumentId}/${winningEmail}/${winningContactBookId}/false`;
      return res.status(200).json({
        status: 'accepted',
        signingUrl: `${publicBase}/login/${Buffer.from(loginPayload, 'utf8').toString('base64url')}`,
      });
    }
    if (proposal.ContractDocumentId === 'creating') {
      return res.status(409).json({ error: 'Contract is being prepared. Please try again in a moment.' });
    }

    const acceptedAt = proposal.AcceptedAt || { __type: 'Date', iso: new Date().toISOString() };
    await axios.put(
      `${cloudServerUrl}/classes/contracts_Proposal/${proposal.objectId}`,
      {
        Status: 'accepted',
        AcceptedAt: acceptedAt,
        AcceptedIp: req.headers['x-real-ip'] || '',
        AcceptedRecipientName: winningName,
        AcceptedRecipientEmail: winningEmail,
        AcceptedContactBookId: winningContactBookId,
        RecipientName: winningName,
        RecipientEmail: winningEmail,
        ContactBookId: winningContactBookId,
        ContractDocumentId: proposal.ContractTemplateId ? 'creating' : '',
      },
      { headers: { ...master, 'Content-Type': 'application/json' } }
    );

    if (!proposal.ContractTemplateId) {
      return res.status(200).json({ status: 'accepted' });
    }

    try {
      const contract = await createContractForProposal(
        proposal,
        token,
        req,
        {
          name: winningName,
          email: winningEmail,
          contactBookId: winningContactBookId,
        },
        recipientToken
      );
      await axios.put(
        `${cloudServerUrl}/classes/contracts_Proposal/${proposal.objectId}`,
        { ContractDocumentId: contract.documentId },
        { headers: { ...master, 'Content-Type': 'application/json' } }
      );
      return res.status(200).json({ status: 'accepted', signingUrl: contract.signingUrl });
    } catch (error) {
      await axios.put(
        `${cloudServerUrl}/classes/contracts_Proposal/${proposal.objectId}`,
        { ContractDocumentId: '' },
        { headers: { ...master, 'Content-Type': 'application/json' } }
      );
      throw error;
    }
  } catch (error) {
    return routeError(res, error, 'Unable to accept proposal.');
  } finally {
    if (lockedProposalId) proposalAcceptanceInFlight.delete(lockedProposalId);
  }
}

function routeError(res, error, fallback) {
  const upstream = error?.response?.status;
  const status = error?.status || (upstream === 401 ? 401 : upstream === 403 ? 403 : upstream === 404 ? 404 : 400);
  const detail = error?.response?.data?.error || error?.message || fallback;
  console.error(`[PROPOSAL] ${fallback} ${detail}`);
  return res.status(status).json({ error: detail });
}
