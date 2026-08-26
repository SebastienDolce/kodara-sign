import axios from 'axios';
import { createHash } from 'crypto';
import getPresignedUrl, { getSignedLocalUrl } from '../parsefunction/getSignedUrl.js';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

const sha256 = value => createHash('sha256').update(String(value || '')).digest('hex');

const masterHeaders = () => ({
  'X-Parse-Application-Id': serverAppId,
  'X-Parse-Master-Key': process.env.MASTER_KEY,
});

const rawUrl = value => String(value || '').split('?')[0];

async function freshFileUrl(sourceUrl) {
  const source = rawUrl(sourceUrl);
  if (!source) return '';
  if (source.includes('/files/')) {
    return getSignedLocalUrl(source, 600);
  }
  try {
    return await getPresignedUrl(source);
  } catch (error) {
    console.error(`[PROPOSAL] Unable to presign external file, using source URL: ${error?.message}`);
    return source;
  }
}

async function findProposal(token) {
  const where = JSON.stringify({ DeliveryTokenHash: sha256(token) });
  const response = await axios.get(
    `${cloudServerUrl}/classes/contracts_Proposal?where=${encodeURIComponent(where)}&limit=1`,
    { headers: masterHeaders() }
  );
  return response?.data?.results?.[0];
}

export default async function getProposalFile(req, res) {
  try {
    const proposal = await findProposal(req.params?.token);
    if (!proposal?.objectId || proposal.DeliveryStatus !== 'sent') {
      return res.status(404).json({ error: 'Delivery link not found.' });
    }

    const kind = req.params?.kind;
    let source = '';
    if (kind === 'proposal') {
      source = proposal.DarkPdfUrl;
    } else if (kind === 'print') {
      source = proposal.LightPdfUrl;
    } else if (kind === 'contract' || kind === 'certificate') {
      if (!proposal.ContractDocumentId) {
        return res.status(404).json({ error: 'Agreement not found.' });
      }
      const documentRes = await axios.get(
        `${cloudServerUrl}/classes/contracts_Document/${encodeURIComponent(proposal.ContractDocumentId)}`,
        { headers: masterHeaders() }
      );
      const document = documentRes?.data;
      if (!document?.IsCompleted) {
        return res.status(404).json({ error: 'Agreement is not completed.' });
      }
      source = kind === 'contract' ? document.SignedUrl || document.URL : document.CertificateUrl;
    } else {
      return res.status(400).json({ error: 'Unknown delivery file type.' });
    }

    if (!source) return res.status(404).json({ error: 'File not available.' });
    const url = await freshFileUrl(source);
    if (!url) return res.status(404).json({ error: 'File not available.' });
    return res.redirect(302, url);
  } catch (error) {
    console.error(`[PROPOSAL] Delivery download failed: ${error?.message}`);
    return res.status(400).json({ error: 'Unable to prepare download.' });
  }
}
