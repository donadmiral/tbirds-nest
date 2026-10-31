const path = require('node:path');
const { transform } = require('lightningcss');
module.exports = function(source) {
  const result = transform({ filename: this.resourcePath, code: Buffer.from(source), cssModules: { pattern: '[name]_[local]_[hash]' }, minify: false });
  const names = Object.fromEntries(Object.entries(result.exports || {}).map(([name,value]) => [name,value.name]));
  return `const style = document.createElement('style');style.dataset.fixtureCss=${JSON.stringify(path.basename(this.resourcePath))};style.textContent=${JSON.stringify(result.code.toString())};document.head.appendChild(style);export default ${JSON.stringify(names)};`;
};
