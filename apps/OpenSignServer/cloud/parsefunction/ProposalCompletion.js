import { createHash, randomBytes } from 'crypto';
import sendmailv3 from './sendMailv3.js';
import generateCertificatebydocId from './generateCertificatebydocId.js';

const sha256 = value => createHash('sha256').update(String(value || '')).digest('hex');

const escapeHtml = value =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function normalizePublicOrigin(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value));
    return parsed.origin;
  } catch {
    return '';
  }
}

function isInternalOrigin(origin) {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return true;
  }
}

function publicBaseFromRequest(request) {
  // Parse afterSave hooks often only see OpenSign's internal SERVER_URL, so
  // prefer explicit public-facing configuration whenever available.
  const candidates = [
    request?.headers?.['public_url'],
    request?.headers?.['x-forwarded-host']
      ? `${request?.headers?.['x-forwarded-proto'] || 'https'}://${request.headers['x-forwarded-host']}`
      : '',
    process.env.PUBLIC_URL,
    process.env.PUBLIC_SERVER_URL,
    process.env.APP_URL,
    process.env.CLIENT_URL,
  ];

  for (const candidate of candidates) {
    const origin = normalizePublicOrigin(candidate);
    if (origin && !isInternalOrigin(origin)) return origin;
  }

  const serverOrigin = normalizePublicOrigin(process.env.SERVER_URL);
  if (serverOrigin && !isInternalOrigin(serverOrigin)) return serverOrigin;

  // This is the Kodara Sign fork's canonical public origin. Keeping this final
  // fallback prevents customer email links from ever pointing at localhost.
  return 'https://sign.kodara.dev';
}

function downloadButton(url, label) {
  return `<p style="margin:10px 0"><a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;min-width:230px;padding:13px 18px;background:#ef2b2d;color:#ffffff;text-decoration:none;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase">${label}</a></p>`;
}

export default async function handleProposalCompletion(request) {
  const doc = request?.object;
  if (!doc?.id || doc.get('IsCompleted') !== true) return;
  if (request?.original?.get?.('IsCompleted') === true) return;

  const proposalQuery = new Parse.Query('contracts_Proposal');
  proposalQuery.equalTo('ContractDocumentId', doc.id);
  proposalQuery.include('CreatedBy');
  proposalQuery.include('ExtUserPtr');
  const proposal = await proposalQuery.first({ useMasterKey: true });
  if (!proposal) return;

  const currentDeliveryStatus = proposal.get('DeliveryStatus');
  if (currentDeliveryStatus === 'preparing' || currentDeliveryStatus === 'sent') return;

  const deliveryToken = randomBytes(32).toString('base64url');
  proposal.set('DeliveryStatus', 'preparing');
  proposal.set('DeliveryTokenHash', sha256(deliveryToken));
  proposal.set('Status', 'completed');
  await proposal.save(null, { useMasterKey: true });

  try {
    // Proposal-linked agreements always receive a freshly generated Kodara
    // certificate, replacing any generic certificate created by OpenSign's
    // normal signing completion path.
    let certificateAvailable = false;
    try {
      const certificate = await generateCertificatebydocId({
        params: { docId: doc.id, force: true },
      });
      certificateAvailable = Boolean(certificate?.CertificateUrl);
    } catch (certificateError) {
      console.error(
        `[PROPOSAL] Certificate generation failed for ${doc.id}: ${certificateError?.message}`
      );
    }

    if (!certificateAvailable) {
      const refreshedDoc = await new Parse.Query('contracts_Document').get(doc.id, {
        useMasterKey: true,
      });
      certificateAvailable = Boolean(refreshedDoc.get('CertificateUrl'));
    }

    const publicBase = publicBaseFromRequest(request);

    const proposalNumber = proposal.get('ProposalNumber') || 'Proposal';
    const proposalName = proposal.get('Name') || proposalNumber;
    const recipientEmail = proposal.get('RecipientEmail');
    const recipientName = proposal.get('RecipientName') || 'there';
    const createdBy = proposal.get('CreatedBy');
    const extUser = proposal.get('ExtUserPtr');
    const senderName =
      createdBy?.get?.('name') || createdBy?.get?.('Name') || extUser?.get?.('Company') || 'Kodara';
    const senderEmail = createdBy?.get?.('email') || '';
    if (!recipientEmail) throw new Error('Proposal recipient email is missing.');

    const fileBase = `${publicBase}/api/proposal-files/${deliveryToken}`;
    const acceptedProposalUrl = `${fileBase}/proposal`;
    const printProposalUrl = `${fileBase}/print`;
    const signedContractUrl = `${fileBase}/contract`;
    const certificateUrl = `${fileBase}/certificate`;

    const html = `<!doctype html>
<html><head><meta http-equiv="Content-Type" content="text/html;charset=UTF-8" /></head>
<body style="margin:0;padding:0;background:#111111;color:#ededed;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#111111"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#0a0a0a;border:1px solid #292929">
<tr><td style="padding:28px 32px 24px"><table role="presentation" width="100%"><tr><td style="font-size:25px;font-weight:900;letter-spacing:-1px;color:#fff">KODARA<span style="color:#ef2b2d">.</span></td><td align="right" style="font-size:11px;font-weight:700;letter-spacing:3px;color:#a6a6a6">SIGN</td></tr></table></td></tr>
<tr><td style="height:3px;background:#ef2b2d;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:40px 32px 36px">
<p style="margin:0 0 12px;color:#ef2b2d;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase">Complete</p>
<h1 style="margin:0 0 18px;color:#fff;font-size:32px;line-height:1.08">Your documents are ready</h1>
<p style="margin:0 0 20px;color:#c6c6c6;font-size:16px;line-height:1.6">Hi ${escapeHtml(recipientName)}, your proposal and agreement are complete. Keep these copies for your records.</p>
<div style="margin:24px 0;padding:16px;border:1px solid #292929;background:#111"><div style="color:#777;font-size:11px;letter-spacing:1.5px;text-transform:uppercase">Proposal</div><div style="margin-top:5px;color:#fff;font-size:15px;font-weight:700">${escapeHtml(proposalName)}</div><div style="margin-top:3px;color:#888;font-size:12px">${escapeHtml(proposalNumber)}</div></div>
${downloadButton(acceptedProposalUrl, 'Accepted proposal')}
${downloadButton(printProposalUrl, 'Print-friendly proposal')}
${downloadButton(signedContractUrl, 'Signed agreement')}
${certificateAvailable ? downloadButton(certificateUrl, 'Signing certificate') : ''}
<p style="margin:26px 0 0;color:#777;font-size:12px;line-height:1.6">The accepted proposal is the original dark presentation you reviewed. The print-friendly version contains the same proposal content with print-oriented styling.</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #292929;background:#080808;color:#777;font-size:12px;line-height:1.6">Sent securely with <strong style="color:#bbb">Kodara Sign</strong>.</td></tr>
</table></td></tr></table></body></html>`;

    const mailResult = await sendmailv3({
      params: {
        recipient: recipientEmail,
        subject: `${proposalNumber} documents are ready`,
        text: `Your completed documents are ready: ${acceptedProposalUrl}`,
        html,
        from: senderName,
        replyto: senderEmail,
        extUserId: extUser?.id || '',
      },
    });

    if (mailResult?.status !== 'success') {
      throw new Error('Completion email delivery was not confirmed.');
    }

    proposal.set('DeliveryStatus', 'sent');
    proposal.set('DeliveredAt', new Date());
    await proposal.save(null, { useMasterKey: true });
    console.log(`[PROPOSAL] Delivered completed package for ${proposalNumber}`);
  } catch (error) {
    proposal.set('DeliveryStatus', 'error');
    await proposal.save(null, { useMasterKey: true });
    console.error(`[PROPOSAL] Completion delivery failed: ${error?.message}`);
  }
}
