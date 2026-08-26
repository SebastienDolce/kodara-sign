import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

const MAX_NAME_BYTES = 512;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_CSS_BYTES = 2 * 1024 * 1024;

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

export default async function savehtmltemplate(req, res) {
  const { templateId, Name, HtmlContent, DarkCss, LightCss } = req.body || {};
  const name = String(Name || '').trim();
  const html = String(HtmlContent || '');
  const darkCss = String(DarkCss || '');
  const lightCss = String(LightCss || '');

  if (!name) return res.status(400).json({ error: 'Template name is required.' });
  if (!html.trim()) return res.status(400).json({ error: 'HTML is required.' });
  if (byteLength(name) > MAX_NAME_BYTES) {
    return res.status(413).json({ error: 'Template name is too large.' });
  }
  if (byteLength(html) > MAX_HTML_BYTES) {
    return res.status(413).json({ error: 'Template HTML is too large.' });
  }
  if (byteLength(darkCss) > MAX_CSS_BYTES || byteLength(lightCss) > MAX_CSS_BYTES) {
    return res.status(413).json({ error: 'Template CSS is too large.' });
  }

  const sessionToken = req.headers['sessiontoken'];
  if (!sessionToken) return res.status(401).json({ error: 'Missing session token.' });

  const serverUrl = cloudServerUrl;
  const parseAppKey = { 'X-Parse-Application-Id': serverAppId };
  const masterHeader = {
    ...parseAppKey,
    'X-Parse-Master-Key': process.env.MASTER_KEY,
    'Content-Type': 'application/json',
  };
  const sessionHeader = { ...parseAppKey, 'X-Parse-Session-Token': sessionToken };

  try {
    const userRes = await axios.get(`${serverUrl}/users/me`, { headers: sessionHeader });
    const currentUserId = userRes?.data?.objectId;
    if (!currentUserId) return res.status(401).json({ error: 'Invalid session.' });

    const whereUser = JSON.stringify({
      UserId: { __type: 'Pointer', className: '_User', objectId: currentUserId },
    });
    const extUserRes = await axios.get(
      `${serverUrl}/classes/contracts_Users?where=${encodeURIComponent(whereUser)}&limit=1`,
      { headers: masterHeader }
    );
    const extUser = extUserRes?.data?.results?.[0];
    if (!extUser?.objectId) {
      return res.status(403).json({ error: 'User not linked to OpenSign account.' });
    }

    const payload = {
      Name: name,
      TemplateType: 'html',
      HtmlContent: html,
      DarkCss: darkCss,
      LightCss: lightCss,
      IsArchive: false,
    };

    let saved;
    if (templateId) {
      const existingRes = await axios.get(
        `${serverUrl}/classes/contracts_Template/${encodeURIComponent(templateId)}`,
        { headers: masterHeader }
      );
      const existing = existingRes?.data;
      if (existing?.TemplateType !== 'html') {
        return res.status(400).json({ error: 'This is not an HTML template.' });
      }
      if (existing?.ExtUserPtr?.objectId !== extUser.objectId) {
        return res.status(403).json({ error: 'Template does not belong to the current user.' });
      }
      saved = await axios.put(
        `${serverUrl}/classes/contracts_Template/${encodeURIComponent(templateId)}`,
        payload,
        { headers: masterHeader }
      );
      return res.status(200).json({
        message: 'saved',
        objectId: templateId,
        updatedAt: saved?.data?.updatedAt,
      });
    }

    payload.CreatedBy = {
      __type: 'Pointer',
      className: '_User',
      objectId: currentUserId,
    };
    payload.ExtUserPtr = {
      __type: 'Pointer',
      className: 'contracts_Users',
      objectId: extUser.objectId,
    };

    saved = await axios.post(`${serverUrl}/classes/contracts_Template`, payload, {
      headers: masterHeader,
    });
    const objectId = saved?.data?.objectId;
    if (!objectId) throw new Error('Template save did not return an objectId.');

    return res.status(201).json({
      message: 'saved',
      objectId,
      createdAt: saved?.data?.createdAt,
    });
  } catch (error) {
    const upstreamStatus = error?.response?.status;
    const status = upstreamStatus === 401 ? 401 : upstreamStatus === 403 ? 403 : 400;
    const detail = error?.response?.data?.error || error?.message || 'Unable to save HTML template.';
    console.error(`[HTMLTEMPLATE] Save failed: ${detail}`);
    return res.status(status).json({ error: detail });
  }
}
