import dotenv from 'dotenv';
import { format, toZonedTime } from 'date-fns-tz';
import getPresignedUrl, { getSignedLocalUrl } from './cloud/parsefunction/getSignedUrl.js';
import crypto from 'node:crypto';
import {
  PDFDocument,
  PDFName,
  rgb,
  degrees,
  // StandardFonts,
  PDFArray,
  PDFDict,
} from 'pdf-lib';
import { parseUploadFile } from './utils/fileUtils.js';

dotenv.config({ quiet: true });

export const cloudServerUrl = 'http://localhost:8080/app';
export const serverAppId = process.env.APP_ID || 'opensign';
export const appName = 'Kodara Sign';
export const prefillDraftDocWidget = ['date', 'textbox', 'checkbox', 'radio button', 'image'];
export const prefillDraftTemWidget = [
  'date',
  'textbox',
  'checkbox',
  'radio button',
  'image',
  'dropdown',
];
export const MAX_NAME_LENGTH = 250;
export const MAX_NOTE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 500;
export const color = [
  '#93a3db',
  '#e6c3db',
  '#c0e3bc',
  '#bce3db',
  '#b8ccdb',
  '#ceb8db',
  '#ffccff',
  '#99ffcc',
  '#cc99ff',
  '#ffcc99',
  '#66ccff',
  '#ffffcc',
];

export const prefillBlockColor = 'transparent';
export function replaceMailVaribles(subject, body, variables) {
  let replacedSubject = subject;
  let replacedBody = body;

  for (const variable in variables) {
    const regex = new RegExp(`{{${variable}}}`, 'g');
    if (subject) {
      replacedSubject = replacedSubject.replace(regex, variables[variable]);
    }
    if (body) {
      replacedBody = replacedBody.replace(regex, variables[variable]);
    }
  }
  const result = { subject: replacedSubject, body: replacedBody };
  return result;
}

export const saveFileUsage = async (size, fileUrl, userId) => {
  //checking server url and save file's size
  try {
    if (userId) {
      const userPtr = { __type: 'Pointer', className: '_User', objectId: userId };
      const tenantQuery = new Parse.Query('partners_Tenant');
      tenantQuery.equalTo('UserId', userPtr);
      const tenant = await tenantQuery.first({ useMasterKey: true });
      if (tenant) {
        const tenantPtr = { __type: 'Pointer', className: 'partners_Tenant', objectId: tenant.id };
        try {
          const tenantCredits = new Parse.Query('partners_TenantCredits');
          tenantCredits.equalTo('PartnersTenant', tenantPtr);
          const res = await tenantCredits.first({ useMasterKey: true });
          if (res) {
            const response = JSON.parse(JSON.stringify(res));
            const usedStorage = response?.usedStorage ? response.usedStorage + size : size;
            const updateCredit = new Parse.Object('partners_TenantCredits');
            updateCredit.id = res.id;
            updateCredit.set('usedStorage', usedStorage);
            await updateCredit.save(null, { useMasterKey: true });
          } else {
            const newCredit = new Parse.Object('partners_TenantCredits');
            newCredit.set('usedStorage', size);
            newCredit.set('PartnersTenant', tenantPtr);
            await newCredit.save(null, { useMasterKey: true });
          }
        } catch (err) {
          console.log('err in save usage', err);
        }
        saveDataFile(size, fileUrl, tenantPtr, userPtr);
      }
    }
  } catch (err) {
    console.log('err in fetch tenant Id', err);
  }
};

//function for save fileUrl and file size in particular client db class partners_DataFiles
const saveDataFile = async (size, fileUrl, tenantPtr, UserId) => {
  try {
    const newDataFiles = new Parse.Object('partners_DataFiles');
    newDataFiles.set('FileUrl', fileUrl);
    newDataFiles.set('FileSize', size);
    newDataFiles.set('TenantPtr', tenantPtr);
    newDataFiles.set('UserId', UserId);
    await newDataFiles.save(null, { useMasterKey: true });
  } catch (err) {
    console.log('error in save usage ', err);
  }
};

export const updateMailCount = async extUserId => {
  // Update count in contracts_Users class
  const query = new Parse.Query('contracts_Users');
  query.equalTo('objectId', extUserId);

  try {
    const contractUser = await query.first({ useMasterKey: true });
    if (contractUser) {
      const _extRes = JSON.parse(JSON.stringify(contractUser));
      contractUser.increment('EmailCount', 1);
      await contractUser.save(null, { useMasterKey: true });
    }
  } catch (error) {
    console.log('Error updating EmailCount in contracts_Users: ' + error.message);
  }
};

export function sanitizeFileName(fileName) {
  // Remove spaces and invalid characters
  const file = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
  const removedot = file.replace(/\.(?=.*\.)/g, '');
  return removedot.replace(/[^a-zA-Z0-9._-]/g, '');
}

export const useLocal = process.env.USE_LOCAL ? process.env.USE_LOCAL.toLowerCase() : 'false';
export const smtpsecure = process.env.SMTP_PORT && process.env.SMTP_PORT !== '465' ? false : true;
export const smtpenable =
  process.env.SMTP_ENABLE && process.env.SMTP_ENABLE.toLowerCase() === 'true' ? true : false;
export const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// `generateId` is used to unique Id for fileAdapter
export function generateId(length) {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

/**
 * FlattenPdf renders field values as static content and removes the interactive
 * form layer. Signatures are stripped entirely. Non-widget annotations (links,
 * comments, stamps) are preserved.
 * @param {string | Uint8Array | ArrayBuffer} pdfFile - pdf file.
 * @returns {Promise<Uint8Array>} flatPdf - pdf file in Uint8Array
 */
export const flattenPdf = async pdfFile => {
  const pdfDoc = await PDFDocument.load(pdfFile, { ignoreEncryption: true });

  try {
    const acroFormEntry = pdfDoc.catalog.get(PDFName.of('AcroForm'));
    const acroForm = pdfDoc.context.lookupMaybe
      ? pdfDoc.context.lookupMaybe(acroFormEntry)
      : pdfDoc.context.lookup(acroFormEntry);

    if (acroForm && typeof acroForm.set === 'function') {
      // Avoid pdf-lib form APIs here; some malformed PDFs crash while
      // iterating/removing fields. Clearing /Fields directly is safer.
      acroForm.set(PDFName.of('Fields'), pdfDoc.context.obj([]));
      acroForm.delete(PDFName.of('XFA'));
      acroForm.delete(PDFName.of('SigFlags'));
    }
  } catch {
    // If AcroForm is malformed, continue with page annotation cleanup.
  }

  for (const page of pdfDoc.getPages()) {
    try {
      const annotationsRef = page.node.get(PDFName.of('Annots'));
      if (!annotationsRef) continue;

      const annotations = pdfDoc.context.lookup(annotationsRef);
      if (!annotations || !annotations.asArray) continue;

      const filtered = annotations.asArray().filter(annotRef => {
        try {
          const annot = pdfDoc.context.lookup(annotRef);
          const subtype = annot?.get(PDFName.of('Subtype'));
          return subtype?.toString() !== '/Widget';
        } catch {
          return true;
        }
      });

      if (filtered.length === 0) {
        page.node.delete(PDFName.of('Annots'));
      } else {
        page.node.set(PDFName.of('Annots'), pdfDoc.context.obj(filtered));
      }
    } catch {
      // best effort cleanup
    }
  }

  try {
    pdfDoc.catalog.delete(PDFName.of('AcroForm'));
  } catch {
    // best effort cleanup
  }

  return await pdfDoc.save({ useObjectStreams: false });
};

/* ---- flattenPdf private helpers ---- */

function _safeGetWidgetsServer(field) {
  try {
    return field.acroField?.getWidgets?.() || [];
  } catch {
    return [];
  }
}

function _getWidgetRectServer(widget, pdfDoc) {
  try {
    const r = widget.getRectangle?.();
    if (r && isFinite(r.x) && isFinite(r.y) && isFinite(r.width) && isFinite(r.height)) {
      return r;
    }
  } catch {
    /* fall through to manual extraction */
  }

  try {
    const rectArr = widget.dict?.lookup?.(PDFName.of('Rect'));
    if (!rectArr || typeof rectArr.size !== 'function' || rectArr.size() !== 4) return null;

    const x1 = _numberFromPdfObjectServer(rectArr.get(0));
    const y1 = _numberFromPdfObjectServer(rectArr.get(1));
    const x2 = _numberFromPdfObjectServer(rectArr.get(2));
    const y2 = _numberFromPdfObjectServer(rectArr.get(3));

    if ([x1, y1, x2, y2].some(v => !isFinite(v))) return null;

    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  } catch {
    return null;
  }
}

function _numberFromPdfObjectServer(obj) {
  if (!obj) return NaN;
  if (typeof obj.asNumber === 'function') return obj.asNumber();
  if (typeof obj.numberValue === 'function') return obj.numberValue();
  return Number(obj?.value ?? obj);
}

function _getWidgetPageServer(pdfDoc, pages, widget) {
  try {
    const pRef = widget.P?.();
    if (pRef) {
      for (const page of pages) {
        if (page.ref === pRef) return page;
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const pRef = widget.dict?.get?.(PDFName.of('P'));
    if (pRef) {
      for (const page of pages) {
        if (page.ref === pRef) return page;
      }
    }
  } catch {
    /* fall through */
  }

  // Fallback: search page annots
  try {
    for (const page of pages) {
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (!annots) continue;

      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        if (ref === widget.ref) return page;
      }
    }
  } catch {
    /* fall through */
  }

  return null;
}

function _drawWidgetBoxServer(page, rect) {
  try {
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      borderWidth: 0.6,
      borderColor: rgb(0.65, 0.65, 0.65),
    });
  } catch {
    /* best effort */
  }
}

function _drawTextFieldServer(page, field, rect, font) {
  let text = '';
  try {
    text = field.getText?.() ?? '';
  } catch {
    text = '';
  }
  text = String(text ?? '');

  if (!text) return;

  let multiline = false;
  try {
    multiline = field.isMultiline?.() ?? false;
  } catch {
    /* ignore */
  }

  let comb = false;
  try {
    comb = field.isCombed?.() ?? false;
  } catch {
    /* ignore */
  }

  if (comb) {
    _drawCombTextServer(page, text, rect, font);
    return;
  }

  if (multiline || text.includes('\n')) {
    _drawMultilineTextServer(page, text, rect, font);
    return;
  }

  const fontSize = _fitSingleLineFontSizeServer(text, rect, font);
  const baselineY = rect.y + Math.max(2, (rect.height - fontSize) / 2);

  page.drawText(text, {
    x: rect.x + 2,
    y: baselineY,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
    maxWidth: Math.max(1, rect.width - 4),
  });
}

function _drawMultilineTextServer(page, text, rect, font) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const fontSize = Math.max(8, Math.min(11, rect.height / Math.max(lines.length + 0.5, 2)));
  const lineHeight = fontSize + 1.5;

  let y = rect.y + rect.height - fontSize - 2;

  for (const line of lines) {
    if (y < rect.y + 1) break;

    page.drawText(line, {
      x: rect.x + 2,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
      maxWidth: Math.max(1, rect.width - 4),
      lineHeight,
    });

    y -= lineHeight;
  }
}

function _drawCombTextServer(page, text, rect, font) {
  const chars = String(text).split('');
  const count = Math.max(chars.length, 1);
  const cellWidth = rect.width / count;
  const fontSize = Math.max(8, Math.min(12, rect.height - 4));

  chars.forEach((ch, i) => {
    const textWidth = font.widthOfTextAtSize(ch, fontSize);
    const x = rect.x + i * cellWidth + (cellWidth - textWidth) / 2;
    const y = rect.y + Math.max(2, (rect.height - fontSize) / 2);

    page.drawText(ch, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    if (i < count - 1) {
      try {
        page.drawLine({
          start: { x: rect.x + (i + 1) * cellWidth, y: rect.y },
          end: { x: rect.x + (i + 1) * cellWidth, y: rect.y + rect.height },
          thickness: 0.4,
          color: rgb(0.75, 0.75, 0.75),
        });
      } catch {
        /* best effort */
      }
    }
  });
}

function _fitSingleLineFontSizeServer(text, rect, font) {
  let size = Math.min(12, rect.height - 4);
  size = Math.max(size, 6);

  while (size > 6) {
    const width = font.widthOfTextAtSize(text, size);
    if (width <= rect.width - 4) return size;
    size -= 0.5;
  }

  return 6;
}

function _drawCheckBoxServer(page, field, rect, zapf) {
  let checked = false;
  try {
    checked = field.isChecked();
  } catch {
    checked = false;
  }

  if (!checked) return;

  const size = Math.max(8, Math.min(rect.width, rect.height) - 4);

  page.drawText('\u2714', {
    x: rect.x + Math.max(1, (rect.width - size * 0.7) / 2),
    y: rect.y + Math.max(1, (rect.height - size) / 2),
    size,
    font: zapf,
    color: rgb(0, 0, 0),
  });
}

function _drawRadioGroupServer(page, field, widget, rect) {
  let selected = null;
  try {
    selected = field.getSelected();
  } catch {
    selected = null;
  }

  if (!selected) return;

  let widgetOnValue = null;
  try {
    widgetOnValue = widget.getOnValue?.();
  } catch {
    /* ignore */
  }

  if (!widgetOnValue) {
    try {
      const ap = widget.dict?.lookupMaybe?.(PDFName.of('AP'), PDFDict);
      const n = ap?.lookupMaybe?.(PDFName.of('N'), PDFDict);
      if (n) {
        const keys = n.keys();
        for (const k of keys) {
          const name = k?.decodeText?.() ?? k?.encodedName ?? String(k);
          if (name !== '/Off' && name !== 'Off') {
            widgetOnValue = name.replace(/^\//, '');
            break;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  const selectedStr = String(selected).replace(/^\//, '');
  const onStr = String(widgetOnValue ?? '').replace(/^\//, '');

  if (!onStr || selectedStr !== onStr) return;

  // Circle outline
  try {
    page.drawEllipse({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      xScale: rect.width / 2 - 1,
      yScale: rect.height / 2 - 1,
      borderWidth: 0.8,
      borderColor: rgb(0, 0, 0),
    });
  } catch {
    /* best effort */
  }

  // Inner filled dot
  try {
    const r = Math.min(rect.width, rect.height) / 4;
    page.drawEllipse({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      xScale: r,
      yScale: r,
      color: rgb(0, 0, 0),
    });
  } catch {
    /* best effort */
  }
}

function _drawDropdownServer(page, field, rect, font) {
  let text = '';
  try {
    const selected = field.getSelected?.();
    if (Array.isArray(selected)) {
      text = selected.join(', ');
    } else {
      text = selected ?? '';
    }
  } catch {
    text = '';
  }

  text = String(text ?? '');
  if (!text) return;

  const fontSize = _fitSingleLineFontSizeServer(text, rect, font);

  page.drawText(text, {
    x: rect.x + 2,
    y: rect.y + Math.max(2, (rect.height - fontSize) / 2),
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
    maxWidth: Math.max(1, rect.width - 12),
  });
}

function _drawOptionListServer(page, field, rect, font) {
  let selected = [];
  try {
    selected = field.getSelected?.() || [];
  } catch {
    selected = [];
  }

  if (!Array.isArray(selected)) {
    selected = [selected].filter(Boolean);
  }

  if (!selected.length) return;

  const lines = selected.map(v => String(v));
  const fontSize = Math.max(8, Math.min(11, rect.height / Math.max(lines.length + 0.5, 2)));
  const lineHeight = fontSize + 1.5;

  let y = rect.y + rect.height - fontSize - 2;

  for (const line of lines) {
    if (y < rect.y + 1) break;

    page.drawText(line, {
      x: rect.x + 2,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
      maxWidth: Math.max(1, rect.width - 4),
    });

    y -= lineHeight;
  }
}

/** Remove only Widget annotations; preserve links, stamps, comments, etc. */
function _removeWidgetAnnotationsServer(pdfDoc) {
  for (const page of pdfDoc.getPages()) {
    try {
      const annotationsRef = page.node.get(PDFName.of('Annots'));
      if (!annotationsRef) continue;

      const annotations = pdfDoc.context.lookup(annotationsRef);
      if (!annotations || !annotations.asArray) continue;

      const filtered = annotations.asArray().filter(annotRef => {
        try {
          const annot = pdfDoc.context.lookup(annotRef);
          const subtype = annot?.get(PDFName.of('Subtype'));
          return subtype?.toString() !== '/Widget';
        } catch {
          return true;
        }
      });

      if (filtered.length === 0) {
        page.node.delete(PDFName.of('Annots'));
      } else {
        page.node.set(PDFName.of('Annots'), pdfDoc.context.obj(filtered));
      }
    } catch {
      /* best effort */
    }
  }

  try {
    pdfDoc.catalog.delete(PDFName.of('AcroForm'));
  } catch {
    /* best effort */
  }
}

// Format date and time for the selected timezone
export const formatTimeInTimezone = (date, timezone) => {
  const nyDate = timezone && toZonedTime(date, timezone);
  const generatedDate = timezone
    ? format(nyDate, 'EEE, dd MMM yyyy HH:mm:ss zzz', { timeZone: timezone })
    : new Date(date).toUTCString();
  return generatedDate;
};

// `getSecureUrl` is used to return local secure url if local files
export const getSecureUrl = url => {
  const fileUrl = new URL(url)?.pathname?.includes('/files/');
  if (fileUrl) {
    try {
      const file = getSignedLocalUrl(url);
      if (file) {
        return { url: file };
      } else {
        return { url: '' };
      }
    } catch (err) {
      console.log('err while fileupload ', err);
      return { url: '' };
    }
  } else {
    return { url: url };
  }
};

export const mailTemplate = param => {
  const subject = `${param.senderName} has requested you to sign "${param.title}"`;
  const body = `<!doctype html>
<html><head><meta http-equiv="Content-Type" content="text/html;charset=UTF-8" /></head>
<body style="margin:0;padding:0;background:#111111;color:#ededed;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#111111;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#0a0a0a;border:1px solid #292929;">
        <tr><td style="padding:28px 32px 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="font-size:25px;font-weight:900;letter-spacing:-1px;color:#ffffff;">KODARA<span style="color:#ef2b2d;">.</span></td>
              <td align="right" style="font-size:11px;font-weight:700;letter-spacing:3px;color:#a6a6a6;">SIGN</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="height:3px;background:#ef2b2d;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:42px 32px 36px;">
          <p style="margin:0 0 14px;color:#ef2b2d;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">Action required</p>
          <h1 style="margin:0 0 20px;color:#ffffff;font-size:34px;line-height:1.05;letter-spacing:-1.5px;">Signature requested</h1>
          <p style="margin:0 0 30px;color:#c6c6c6;font-size:16px;line-height:1.6;"><strong style="color:#ffffff;">${param.senderName}</strong> has requested that you review and sign <strong style="color:#ffffff;">${param.title}</strong>.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #333333;border-bottom:1px solid #333333;">
            <tr><td style="padding:13px 0;color:#858585;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Sender</td><td align="right" style="padding:13px 0;color:#ededed;font-size:14px;">${param.senderMail}</td></tr>
            <tr><td style="padding:13px 0;border-top:1px solid #242424;color:#858585;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Organization</td><td align="right" style="padding:13px 0;border-top:1px solid #242424;color:#ededed;font-size:14px;">${param.organization || '—'}</td></tr>
            <tr><td style="padding:13px 0;border-top:1px solid #242424;color:#858585;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Expires</td><td align="right" style="padding:13px 0;border-top:1px solid #242424;color:#ededed;font-size:14px;">${param.localExpireDate}</td></tr>
            <tr><td style="padding:13px 0;border-top:1px solid #242424;color:#858585;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Note</td><td align="right" style="padding:13px 0;border-top:1px solid #242424;color:#ededed;font-size:14px;">${param.note || '—'}</td></tr>
          </table>
          <p style="margin:32px 0 0;"><a href="${param.signingUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 22px;background:#ef2b2d;color:#ffffff;font-size:13px;font-weight:800;letter-spacing:1.5px;text-decoration:none;text-transform:uppercase;">Review &amp; sign</a></p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #292929;background:#080808;color:#777777;font-size:12px;line-height:1.6;">Sent securely with <strong style="color:#bdbdbd;">${appName}</strong>. Questions about this document should be directed to <a href="mailto:${param.senderMail}" style="color:#ededed;">${param.senderMail}</a>.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, body };
};

export const mailReportFooter = extUserId => {
  const subject = encodeURIComponent(
    `Unexpected Kodara Sign email from user ${extUserId || 'unknown'}`
  );
  return `<p style="margin:16px auto;max-width:640px;color:#777777;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;text-align:center;">If you did not expect this message, contact the sender or <a href="mailto:team@kodara.dev?subject=${subject}" style="color:#a6a6a6;">report it to Kodara</a>.</p>`;
};

export const brandedNotificationEmail = ({
  eyebrow,
  title,
  message,
  actionUrl,
  actionLabel,
  contactEmail,
}) => `<!doctype html>
<html><head><meta http-equiv="Content-Type" content="text/html;charset=UTF-8" /></head>
<body style="margin:0;padding:0;background:#111111;color:#ededed;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#111111;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#0a0a0a;border:1px solid #292929;">
        <tr><td style="padding:28px 32px 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="font-size:25px;font-weight:900;letter-spacing:-1px;color:#ffffff;">KODARA<span style="color:#ef2b2d;">.</span></td><td align="right" style="font-size:11px;font-weight:700;letter-spacing:3px;color:#a6a6a6;">SIGN</td></tr></table></td></tr>
        <tr><td style="height:3px;background:#ef2b2d;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:42px 32px 38px;">
          <p style="margin:0 0 14px;color:#ef2b2d;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">${eyebrow}</p>
          <h1 style="margin:0 0 20px;color:#ffffff;font-size:32px;line-height:1.08;letter-spacing:-1.2px;">${title}</h1>
          <div style="color:#c6c6c6;font-size:16px;line-height:1.65;">${message}</div>
          ${actionUrl ? `<p style="margin:32px 0 0;"><a href="${actionUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 22px;background:#ef2b2d;color:#ffffff;font-size:13px;font-weight:800;letter-spacing:1.5px;text-decoration:none;text-transform:uppercase;">${actionLabel}</a></p>` : ''}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #292929;background:#080808;color:#777777;font-size:12px;line-height:1.6;">Sent securely with <strong style="color:#bdbdbd;">${appName}</strong>. ${contactEmail ? `Questions should be directed to <a href="mailto:${contactEmail}" style="color:#ededed;">${contactEmail}</a>.` : ''}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export const selectFormat = data => {
  switch (data) {
    case 'L':
      return 'MM/dd/yyyy';
    case 'MM/DD/YYYY':
      return 'MM/dd/yyyy';
    case 'DD-MM-YYYY':
      return 'dd-MM-yyyy';
    case 'DD/MM/YYYY':
      return 'dd/MM/yyyy';
    case 'LL':
      return 'MMMM dd, yyyy';
    case 'DD MMM, YYYY':
      return 'dd MMM, yyyy';
    case 'YYYY-MM-DD':
      return 'yyyy-MM-dd';
    case 'MM-DD-YYYY':
      return 'MM-dd-yyyy';
    case 'MM.DD.YYYY':
      return 'MM.dd.yyyy';
    case 'MMM DD, YYYY':
      return 'MMM dd, yyyy';
    case 'MMMM DD, YYYY':
      return 'MMMM dd, yyyy';
    case 'DD MMMM, YYYY':
      return 'dd MMMM, yyyy';
    case 'DD.MM.YYYY':
      return 'dd.MM.yyyy';
    case 'DD-MMM-YYYY':
      return 'dd-MMM-yyyy';
    default:
      return 'MM/dd/yyyy';
  }
};

export function formatDateTime(date, dateFormat, timeZone, is12Hour) {
  const zonedDate = toZonedTime(date, timeZone); // Convert date to the given timezone
  const timeFormat = is12Hour ? 'hh:mm:ss a' : 'HH:mm:ss';
  return dateFormat
    ? format(zonedDate, `${selectFormat(dateFormat)}, ${timeFormat} 'GMT' XXX`, { timeZone })
    : formatTimeInTimezone(date, timeZone);
}

export const randomId = (digit = 8) => {
  // 1. Grab a cryptographically-secure 32-bit random value
  // Use crypto for stronger randomness
  const randomBytes = crypto.getRandomValues(new Uint32Array(1));
  const raw = randomBytes[0]; // 0 … 4,294,967,295

  // Calculate the min and max for the given digit length
  const min = Math.pow(10, digit - 1); // e.g., digit=3 → 100
  const max = Math.pow(10, digit) - 1; // e.g., digit=3 → 999
  const range = max - min + 1;

  // Collapse random value into the range and shift
  return min + (raw % range);
};
export const handleValidImage = async Placeholder => {
  const updatedPlaceholders = [];

  for (const placeholder of Placeholder || []) {
    //Clean and format signerPtr
    let signerPtr = placeholder.signerPtr;
    // Check if signerPtr exists and has an id
    if (signerPtr?.id) {
      // Case 1: If signerPtr is a Parse Object instance
      if (signerPtr instanceof Parse.Object) {
        // If signerPtr has no attributes, it’s a plain pointer already
        if (!signerPtr.attributes || Object.keys(signerPtr.attributes).length === 0) {
          // Convert to a clean pointer using Parse’s built-in method
          signerPtr = signerPtr.toPointer();
        } else {
          // If it has attributes, manually construct the pointer object
          signerPtr = {
            __type: 'Pointer',
            className: signerPtr.className,
            objectId: signerPtr.id,
          };
        }
        // Case 2: If signerPtr is already a plain JS object resembling a pointer
      } else if (typeof signerPtr === 'object' && signerPtr.className && signerPtr.objectId) {
        // Normalize it to a valid Parse pointer object
        signerPtr = {
          __type: 'Pointer',
          className: signerPtr.className,
          objectId: signerPtr.objectId,
        };
      }
    }

    //Process placeHolder if Role is 'prefill'
    if (placeholder?.Role === 'prefill') {
      const updatedRole = [];
      for (const item of placeholder.placeHolder || []) {
        const updatedPos = [];
        for (const posItem of item.pos || []) {
          if (
            (posItem?.type === 'image' || posItem?.type === 'draw') &&
            posItem?.options?.response
          ) {
            const validUrl = await getPresignedUrl(posItem?.options?.response);
            updatedPos.push({
              ...posItem,
              ...(item.SignUrl !== undefined && { SignUrl: validUrl }),
              options: { ...posItem.options, response: validUrl },
            });
          } else {
            updatedPos.push(posItem);
          }
        }
        updatedRole.push({ ...item, pos: updatedPos });
      }

      updatedPlaceholders.push({ ...placeholder, signerPtr, placeHolder: updatedRole });
    } else {
      // Not prefill role, just push as-is
      updatedPlaceholders.push({ ...placeholder, signerPtr });
    }
  }
  return updatedPlaceholders;
};
