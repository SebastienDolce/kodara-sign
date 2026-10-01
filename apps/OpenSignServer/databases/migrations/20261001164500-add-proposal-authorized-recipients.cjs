/**
 * Support proposals sent to two authorized recipients where either recipient
 * may accept and become the single agreement signer.
 *
 * @param {Parse} Parse
 */
exports.up = async Parse => {
  const schema = new Parse.Schema('contracts_Proposal');
  schema.addArray('AuthorizedRecipients');
  schema.addString('AcceptedRecipientName');
  schema.addString('AcceptedRecipientEmail');
  schema.addString('AcceptedContactBookId');
  await schema.update();
};

/**
 * @param {Parse} Parse
 */
exports.down = async Parse => {
  const schema = new Parse.Schema('contracts_Proposal');
  schema.deleteField('AuthorizedRecipients');
  schema.deleteField('AcceptedRecipientName');
  schema.deleteField('AcceptedRecipientEmail');
  schema.deleteField('AcceptedContactBookId');
  await schema.update();
};
