import axios from 'axios';
import { createHash } from 'crypto';
import { appName, cloudServerUrl, serverAppId } from '../../Utils.js';
import sendSystemMail from '../parsefunction/sendSystemMail.js';

const notificationInFlight = new Set();

const sha256 = value => createHash('sha256').update(value).digest('hex');
const masterHeaders = () => ({
  'X-Parse-Application-Id': serverAppId,
  'X-Parse-Master-Key': process.env.MASTER_KEY,
});
const escapeHtml = value =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function firstViewedIso(proposal, viewedAt) {
  return proposal?.FirstViewedAt?.iso || viewedAt.toISOString();
}

function resolveSender(proposal) {
  return {
    email: proposal?.CreatedBy?.email || proposal?.ExtUserPtr?.Email || '',
    name:
      proposal?.CreatedBy?.name ||
      proposal?.ExtUserPtr?.Name ||
      proposal?.ExtUserPtr?.Company ||
      'Kodara Sign',
    extUserId: proposal?.ExtUserPtr?.objectId || '',
  };
}

export function buildProposalViewNotification(proposal, viewedAt) {
  const proposalName = proposal?.Name || proposal?.ProposalNumber || 'Proposal';
  const proposalNumber = proposal?.ProposalNumber || 'No proposal number';
  const recipientName = proposal?.RecipientName || proposal?.RecipientEmail || 'the recipient';
  const viewedIso = viewedAt instanceof Date ? viewedAt.toISOString() : String(viewedAt || '');
  const safeProposalName = escapeHtml(proposalName);
  const safeProposalNumber = escapeHtml(proposalNumber);
  const safeRecipientName = escapeHtml(recipientName);
  const safeViewedIso = escapeHtml(viewedIso);
  const caveat =
    'This records that the public proposal route was loaded. It does not prove who opened the link, and it is not an acceptance or signature.';

  return {
    subject: `Proposal link opened: ${proposalName}`,
    text: `${proposalName} (${proposalNumber}) was opened at ${viewedIso}. Recipient: ${recipientName}. ${caveat}`,
    html: `<div style="background:#111;color:#f5f5f5;padding:32px;font-family:Arial,sans-serif"><div style="color:#ef2b2d;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Proposal activity</div><h2 style="margin:10px 0 16px">Proposal link opened</h2><p style="margin:0 0 8px"><strong>${safeProposalName}</strong></p><p style="margin:0 0 8px;color:#c9c9c9">${safeProposalNumber}</p><p style="margin:0 0 8px;color:#c9c9c9">Prepared for ${safeRecipientName}</p><p style="margin:0 0 22px;color:#c9c9c9">First opened ${safeViewedIso}</p><p style="margin:0;color:#8f8f8f;font-size:12px;line-height:1.5">${escapeHtml(caveat)}</p></div>`,
  };
}

async function findProposalByToken(token) {
  if (!token) return null;
  const where = JSON.stringify({ PublicTokenHash: sha256(String(token)) });
  const response = await axios.get(
    `${cloudServerUrl}/classes/contracts_Proposal?where=${encodeURIComponent(where)}&limit=1&include=CreatedBy,ExtUserPtr`,
    { headers: masterHeaders() }
  );
  return response?.data?.results?.[0] || null;
}

async function updateProposal(proposalId, changes) {
  await axios.put(`${cloudServerUrl}/classes/contracts_Proposal/${proposalId}`, changes, {
    headers: { ...masterHeaders(), 'Content-Type': 'application/json' },
  });
}

export async function recordProposalFirstView(token, viewedAt = new Date()) {
  const proposal = await findProposalByToken(token);
  if (!proposal?.objectId) return { status: 'not-found' };
  if (proposal.ViewNotificationSentAt) return { status: 'already-notified' };
  if (notificationInFlight.has(proposal.objectId)) return { status: 'in-flight' };

  notificationInFlight.add(proposal.objectId);
  try {
    const viewedIso = firstViewedIso(proposal, viewedAt);
    if (!proposal.FirstViewedAt) {
      await updateProposal(proposal.objectId, {
        FirstViewedAt: { __type: 'Date', iso: viewedIso },
      });
    }

    const sender = resolveSender(proposal);
    if (!sender.email) {
      console.warn(
        `[PROPOSAL] First view recorded for ${proposal.ProposalNumber || proposal.objectId}, but sender email is unavailable.`
      );
      return { status: 'sender-email-unavailable', firstViewedAt: viewedIso };
    }

    const notification = buildProposalViewNotification(proposal, viewedIso);
    const mail = await sendSystemMail({
      params: {
        extUserId: sender.extUserId,
        from: appName,
        recipient: sender.email,
        replyto: sender.email,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
      },
    });

    if (mail?.status !== 'success') {
      console.error(
        `[PROPOSAL] First-view email failed for ${proposal.ProposalNumber || proposal.objectId}. A later view will retry.`
      );
      return { status: 'mail-failed', firstViewedAt: viewedIso };
    }

    const notifiedAt = new Date().toISOString();
    await updateProposal(proposal.objectId, {
      ViewNotificationSentAt: { __type: 'Date', iso: notifiedAt },
    });
    return { status: 'notified', firstViewedAt: viewedIso, notifiedAt };
  } finally {
    notificationInFlight.delete(proposal.objectId);
  }
}

export function notifyProposalFirstView(req, res, next) {
  void res;
  recordProposalFirstView(req.params?.token).catch(error => {
    console.error(`[PROPOSAL] Unable to record first proposal view: ${error?.message || error}`);
  });
  return next();
}
