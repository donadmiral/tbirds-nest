const fs = require('node:fs/promises');
const path = require('node:path');
const { webpack } = require('../../node_modules/next/dist/compiled/webpack/webpack');
const root = path.resolve(__dirname, '../..');
const output = process.env.PLATINUM_REPORT_OUTPUT || '/tmp/platinum-admin-reporting';
async function main() {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve, reject) => webpack({
    mode: 'development', devtool: false, context: root, target: 'web', entry: path.join(__dirname, 'reporting-fixture.tsx'), output: { path: output, filename: 'fixture.js' },
    plugins: [new webpack.DefinePlugin({ 'process.env.__NEXT_IMAGE_OPTS': 'undefined', 'process.env.NEXT_DEPLOYMENT_ID': 'undefined', 'process.env.NEXT_SUPPORTS_IMMUTABLE_ASSETS': 'false', 'process.env.NEXT_RUNTIME': JSON.stringify('browser') })],
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root, 'next/link': path.join(__dirname, 'reporting-router.tsx'), 'next/navigation': path.join(__dirname, 'reporting-router.tsx'), react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom') } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'typescript-loader.cjs') }] },
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const postcss = require('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const result = await postcss([tailwind({ base: root })]).process(await fs.readFile(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  await fs.writeFile(path.join(output, 'fixture.css'), result.css);
  console.log(JSON.stringify({ output, actualWorkspaceAndTailwind: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
