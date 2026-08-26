/**
 * Store immutable sent/accepted proposal snapshots.
 *
 * @param {Parse} Parse
 */
exports.up = async Parse => {
  const schema = new Parse.Schema('contracts_Proposal');
  schema.addString('ProposalNumber');
  schema.addString('Name');
  schema.addString('Status');
  schema.addString('RecipientName');
  schema.addString('RecipientEmail');
  schema.addString('HtmlContent');
  schema.addString('DarkCss');
  schema.addString('LightCss');
  schema.addString('DarkPdfUrl');
  schema.addString('LightPdfUrl');
  schema.addString('SnapshotHash');
  schema.addString('PublicTokenHash');
  schema.addString('HtmlTemplateId');
  schema.addString('ContractTemplateId');
  schema.addString('ContractDocumentId');
  schema.addString('ContactBookId');
  schema.addString('AcceptedIp');
  schema.addDate('SentAt');
  schema.addDate('AcceptedAt');
  schema.addPointer('CreatedBy', '_User');
  schema.addPointer('ExtUserPtr', 'contracts_Users');
  return schema.save();
};

/**
 * @param {Parse} Parse
 */
exports.down = async Parse => {
  const schema = new Parse.Schema('contracts_Proposal');
  return schema.purge().then(() => schema.delete());
};
