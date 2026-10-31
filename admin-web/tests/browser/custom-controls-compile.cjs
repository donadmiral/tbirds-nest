const fs = require('node:fs/promises');
const path = require('node:path');
const { webpack } = require('../../node_modules/next/dist/compiled/webpack/webpack');
const root = path.resolve(__dirname, '../..');
async function compile(output) {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, context: root, target: 'web', entry: path.join(__dirname, 'custom-controls-fixture.tsx'), output: { path: output, filename: 'fixture.js' },
    plugins: [new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, path.join(__dirname, 'custom-controls-crypto.ts'))],
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root, './actions': path.join(__dirname, 'custom-controls-actions.ts'), 'next/link': path.join(__dirname, 'router-adapter.tsx'), 'next/navigation': path.join(__dirname, 'router-adapter.tsx'), react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'typescript-loader.cjs') }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const postcss = require('postcss'), tailwind = require('@tailwindcss/postcss');
  const css = await postcss([tailwind({ base: root })]).process(await fs.readFile(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  await fs.writeFile(path.join(output, 'fixture.css'), css.css);
}
module.exports = { compile };
