/**
 * Add source and theme fields for HTML-backed templates.
 * Existing templates remain PDF templates when TemplateType is unset.
 *
 * @param {Parse} Parse
 */
exports.up = async Parse => {
  const className = 'contracts_Template';
  const schema = new Parse.Schema(className);
  schema.addString('TemplateType');
  schema.addString('HtmlContent');
  schema.addString('DarkCss');
  schema.addString('LightCss');
  return schema.update();
};

/**
 * @param {Parse} Parse
 */
exports.down = async Parse => {
  const className = 'contracts_Template';
  const schema = new Parse.Schema(className);
  schema.deleteField('TemplateType');
  schema.deleteField('HtmlContent');
  schema.deleteField('DarkCss');
  schema.deleteField('LightCss');
  return schema.update();
};
