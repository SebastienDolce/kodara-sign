/**
 * Store immutable sent/accepted proposal snapshots.
 * The class is master-key only; clients use the authenticated/public proposal routes.
 *
 * @param {Parse} Parse
 */
exports.up = async Parse => {
  const schema = new Parse.Schema('contracts_Proposal');
  schema
    .addString('ProposalNumber')
    .addString('Name')
    .addString('Status')
    .addString('RecipientName')
    .addString('RecipientEmail')
    .addString('HtmlContent')
    .addString('DarkCss')
    .addString('LightCss')
    .addString('DarkPdfUrl')
    .addString('LightPdfUrl')
    .addString('SnapshotHash')
    .addString('PublicTokenHash')
    .addString('HtmlTemplateId')
    .addString('ContractTemplateId')
    .addString('ContractDocumentId')
    .addString('ContactBookId')
    .addString('AcceptedIp')
    .addDate('SentAt')
    .addDate('AcceptedAt')
    .addPointer('CreatedBy', '_User')
    .addPointer('ExtUserPtr', 'contracts_Users')
    .addIndex('proposal_public_token_hash_1', { PublicTokenHash: 1 })
    .addIndex('proposal_number_1', { ProposalNumber: 1 })
    .setCLP({
      get: {},
      find: {},
      count: {},
      create: {},
      update: {},
      delete: {},
      addField: {},
    });
  return schema.save(null, { useMasterKey: true });
};

/**
 * @param {Parse} Parse
 */
exports.down = async Parse => {
  const schema = new Parse.Schema('contracts_Proposal');
  return schema.purge().then(() => schema.delete());
};
