/**
 * Track the first successful public proposal load and the sender notification.
 * These timestamps are observational only; they do not change acceptance/signing state.
 *
 * @param {Parse} Parse
 */
exports.up = async Parse => {
  const schema = new Parse.Schema('contracts_Proposal');
  schema.addDate('FirstViewedAt');
  schema.addDate('ViewNotificationSentAt');
  await schema.update();
};

/**
 * @param {Parse} Parse
 */
exports.down = async Parse => {
  const schema = new Parse.Schema('contracts_Proposal');
  schema.deleteField('FirstViewedAt');
  schema.deleteField('ViewNotificationSentAt');
  await schema.update();
};
