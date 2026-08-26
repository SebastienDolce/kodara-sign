import { appName, brandedNotificationEmail } from '../../Utils.js';
import sendSystemMail from './sendSystemMail.js';

async function sendDeclineMail(doc, publicUrl, userId, reason) {
  try {
    const TenantAppName = appName;
    const removePrefill =
      doc?.Placeholders?.length > 0 && doc?.Placeholders?.filter(x => x?.Role !== 'prefill');
    const signUser =
      removePrefill?.length > 0 &&
      removePrefill?.find(x => x?.signerPtr?.UserId?.objectId === userId);

    const sender = doc.ExtUserPtr;
    const pdfName = doc.Name;
    const creatorName = doc.ExtUserPtr.Name;
    const creatorEmail = doc.ExtUserPtr.Email;
    const signerName = signUser?.signerPtr?.Name || '';
    const signerEmail = signUser?.signerPtr?.Email || signUser?.email || '';
    const viewDocUrl = `${publicUrl}/recipientSignPdf/${doc.objectId}`;
    const subject = `Document "${pdfName}" has been declined by ${signerName}`;
    const body = brandedNotificationEmail({
      eyebrow: 'Document update',
      title: 'Signature request declined',
      message: `<p style="margin:0 0 14px;">Dear ${creatorName},</p><p style="margin:0 0 14px;"><strong style="color:#fff;">${pdfName}</strong> was declined by ${signerName} (${signerEmail}) on ${new Date().toLocaleDateString()}.</p><p style="margin:0;"><strong style="color:#fff;">Reason:</strong> ${reason || 'Not specified'}</p>`,
      actionUrl: viewDocUrl,
      actionLabel: 'View document',
      contactEmail: creatorEmail,
    });

    const params = {
      extUserId: sender.objectId,
      from: TenantAppName,
      recipient: creatorEmail,
      subject: subject,
      pdfName: pdfName,
      html: body,
    };
    await sendSystemMail({ params });
  } catch (err) {
    console.log('err in sendnotifymail', err);
  }
}
export default async function declinedocument(request) {
  const docId = request.params.docId;
  const reason = request.params?.reason || '';
  const userId = request.params.userId;
  const declineBy = { __type: 'Pointer', className: '_User', objectId: userId };
  const publicUrl = request.headers.public_url;
  if (!docId) {
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'missing parameter docId.');
  }
  try {
    const docCls = new Parse.Query('contracts_Document');
    docCls.include('ExtUserPtr.TenantId,Placeholders.signerPtr,Signers');
    docCls.notEqualTo('IsCompleted', true);
    docCls.notEqualTo('IsArchive', true);
    const updateDoc = await docCls.get(docId, { useMasterKey: true });
    if (updateDoc) {
      const _doc = JSON.parse(JSON.stringify(updateDoc));
      const isEnableOTP = updateDoc?.get('IsEnableOTP') || false;
      const isCreator = _doc?.CreatedBy?.objectId === userId;
      if (!isEnableOTP) {
        updateDoc.set('IsDeclined', true);
        updateDoc.set('DeclineReason', reason);
        updateDoc.set('DeclineBy', declineBy);
        await updateDoc.save(null, { useMasterKey: true });
        if (!isCreator) {
          sendDeclineMail(_doc, publicUrl, userId, reason);
        }
        return 'document declined';
      } else {
        if (!request?.user) {
          throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
        }
        updateDoc.set('IsDeclined', true);
        updateDoc.set('DeclineReason', reason);
        updateDoc.set('DeclineBy', declineBy);
        await updateDoc.save(null, { useMasterKey: true });
        const isCreator = _doc?.CreatedBy?.objectId === request?.user?.id;
        if (!isCreator) {
          sendDeclineMail(_doc, publicUrl, userId, reason);
        }
        return 'document declined';
      }
    } else {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
    }
  } catch (err) {
    console.log('err while decling doc', err);
    throw err;
  }
}
