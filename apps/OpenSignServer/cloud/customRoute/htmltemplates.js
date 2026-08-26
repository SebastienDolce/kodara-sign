import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

async function resolveCurrentExtUser(req) {
  const sessionToken = req.headers['sessiontoken'];
  if (!sessionToken) {
    const error = new Error('Missing session token.');
    error.status = 401;
    throw error;
  }

  const serverUrl = cloudServerUrl;
  const parseAppKey = { 'X-Parse-Application-Id': serverAppId };
  const masterHeader = {
    ...parseAppKey,
    'X-Parse-Master-Key': process.env.MASTER_KEY,
  };
  const sessionHeader = { ...parseAppKey, 'X-Parse-Session-Token': sessionToken };

  const userRes = await axios.get(`${serverUrl}/users/me`, { headers: sessionHeader });
  const currentUserId = userRes?.data?.objectId;
  if (!currentUserId) {
    const error = new Error('Invalid session.');
    error.status = 401;
    throw error;
  }

  const whereUser = JSON.stringify({
    UserId: { __type: 'Pointer', className: '_User', objectId: currentUserId },
  });
  const extUserRes = await axios.get(
    `${serverUrl}/classes/contracts_Users?where=${encodeURIComponent(whereUser)}&limit=1`,
    { headers: masterHeader }
  );
  const extUser = extUserRes?.data?.results?.[0];
  if (!extUser?.objectId) {
    const error = new Error('User not linked to OpenSign account.');
    error.status = 403;
    throw error;
  }

  return { serverUrl, masterHeader, extUser };
}

export async function listHtmlTemplates(req, res) {
  try {
    const { serverUrl, masterHeader, extUser } = await resolveCurrentExtUser(req);
    const where = JSON.stringify({
      TemplateType: 'html',
      IsArchive: { $ne: true },
      ExtUserPtr: {
        __type: 'Pointer',
        className: 'contracts_Users',
        objectId: extUser.objectId,
      },
    });
    const response = await axios.get(
      `${serverUrl}/classes/contracts_Template?where=${encodeURIComponent(where)}&order=-updatedAt&limit=100&keys=Name,updatedAt`,
      { headers: masterHeader }
    );
    const templates = (response?.data?.results || []).map((row) => ({
      objectId: row.objectId,
      Name: row.Name || 'Untitled HTML template',
      updatedAt: row.updatedAt,
    }));
    return res.status(200).json({ templates });
  } catch (error) {
    const status = error?.status || (error?.response?.status === 401 ? 401 : 400);
    const detail = error?.response?.data?.error || error?.message || 'Unable to list HTML templates.';
    console.error(`[HTMLTEMPLATE] List failed: ${detail}`);
    return res.status(status).json({ error: detail });
  }
}

export async function getHtmlTemplate(req, res) {
  try {
    const { serverUrl, masterHeader, extUser } = await resolveCurrentExtUser(req);
    const templateId = req.params?.templateId;
    if (!templateId) return res.status(400).json({ error: 'Template id is required.' });

    const response = await axios.get(
      `${serverUrl}/classes/contracts_Template/${encodeURIComponent(templateId)}`,
      { headers: masterHeader }
    );
    const template = response?.data;
    if (template?.TemplateType !== 'html') {
      return res.status(400).json({ error: 'This is not an HTML template.' });
    }
    if (template?.ExtUserPtr?.objectId !== extUser.objectId) {
      return res.status(403).json({ error: 'Template does not belong to the current user.' });
    }

    return res.status(200).json({
      template: {
        objectId: template.objectId,
        Name: template.Name || '',
        HtmlContent: template.HtmlContent || '',
        DarkCss: template.DarkCss || '',
        LightCss: template.LightCss || '',
        updatedAt: template.updatedAt,
      },
    });
  } catch (error) {
    const upstreamStatus = error?.response?.status;
    const status = error?.status || (upstreamStatus === 401 ? 401 : upstreamStatus === 404 ? 404 : 400);
    const detail = error?.response?.data?.error || error?.message || 'Unable to load HTML template.';
    console.error(`[HTMLTEMPLATE] Load failed: ${detail}`);
    return res.status(status).json({ error: detail });
  }
}
