const ts = require('typescript');
module.exports = function(source) {
  return ts.transpileModule(source, { fileName: this.resourcePath, compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  } }).outputText;
};
