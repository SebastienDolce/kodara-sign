import { createHash, timingSafeEqual } from 'crypto';

export const MAX_PROPOSAL_RECIPIENTS = 2;

export const normalizeEmail = value =>
  String(value || '').trim().toLowerCase().replace(/\s/g, '');

export const hashRecipientToken = value =>
  createHash('sha256').update(String(value || '')).digest('hex');

function recipientError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function requestedProposalRecipients(body = {}) {
  const source = Array.isArray(body?.recipients)
    ? body.recipients
    : [{ name: body?.recipientName, email: body?.recipientEmail }];

  const recipients = source
    .map(item => ({
      name: String(item?.name || '').trim(),
      email: normalizeEmail(item?.email),
    }))
    .filter(item => item.name || item.email);

  if (!recipients.length) {
    throw recipientError('At least one proposal recipient is required.');
  }
  if (recipients.length > MAX_PROPOSAL_RECIPIENTS) {
    throw recipientError(`A proposal can currently be sent to at most ${MAX_PROPOSAL_RECIPIENTS} recipients.`);
  }

  for (const recipient of recipients) {
    if (!recipient.name || !recipient.email) {
      throw recipientError('Each proposal recipient needs both a name and email address.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
      throw recipientError(`Invalid proposal recipient email: ${recipient.email}`);
    }
  }

  const uniqueEmails = new Set(recipients.map(item => item.email));
  if (uniqueEmails.size !== recipients.length) {
    throw recipientError('Proposal recipients must use different email addresses.');
  }

  return recipients;
}

export function storedProposalRecipients(proposal = {}) {
  const stored = Array.isArray(proposal?.AuthorizedRecipients)
    ? proposal.AuthorizedRecipients
    : [];

  const normalizedStored = stored
    .map(item => ({
      name: String(item?.name || '').trim(),
      email: normalizeEmail(item?.email),
      contactBookId: String(item?.contactBookId || ''),
      tokenHash: String(item?.tokenHash || ''),
    }))
    .filter(item => item.email && item.contactBookId);

  if (normalizedStored.length) return normalizedStored;

  const legacyEmail = normalizeEmail(proposal?.RecipientEmail);
  const legacyContactBookId = String(proposal?.ContactBookId || '');
  if (!legacyEmail || !legacyContactBookId) return [];

  return [
    {
      name: String(proposal?.RecipientName || '').trim(),
      email: legacyEmail,
      contactBookId: legacyContactBookId,
      tokenHash: '',
    },
  ];
}

function tokenHashMatches(expectedHash, actualHash) {
  if (!expectedHash || !actualHash) return false;
  const expected = Buffer.from(String(expectedHash), 'hex');
  const actual = Buffer.from(String(actualHash), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function resolveProposalRecipient(proposal, recipientToken = '') {
  const recipients = storedProposalRecipients(proposal);
  if (!recipients.length) {
    throw recipientError('Proposal recipient information is unavailable.');
  }

  if (recipients.length === 1 && !recipients[0].tokenHash) {
    return recipients[0];
  }

  if (!recipientToken) {
    throw recipientError('This proposal link is missing its recipient authorization token.', 403);
  }

  const tokenHash = hashRecipientToken(recipientToken);
  const recipient = recipients.find(item => tokenHashMatches(item.tokenHash, tokenHash));
  if (!recipient) {
    throw recipientError('This proposal link is not authorized for a recipient.', 403);
  }
  return recipient;
}

export function proposalRecipientLabel(proposal = {}) {
  const recipients = storedProposalRecipients(proposal);
  if (!recipients.length) {
    return proposal?.RecipientName || proposal?.RecipientEmail || 'the recipient';
  }

  return recipients
    .map(item => item.name || item.email)
    .filter(Boolean)
    .join(' or ');
}
