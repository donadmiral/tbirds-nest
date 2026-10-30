const fs = require('node:fs/promises');
const path = require('node:path');
const { webpack } = require('../../node_modules/next/dist/compiled/webpack/webpack');
const root = path.resolve(__dirname,'../..');
const output = process.env.PLATINUM_UI_OUTPUT || '/tmp/platinum-admin-browser';
async function main() {
  await fs.mkdir(output,{recursive:true});
  await new Promise((resolve,reject)=>webpack({
    mode:'development',devtool:false,context:root,target:'web',entry:path.join(__dirname,'fixture.tsx'),output:{path:output,filename:'fixture.js'},
    resolve:{extensions:['.tsx','.ts','.js'],alias:{'@':root,'next/link':path.join(__dirname,'router-adapter.tsx'),'next/navigation':path.join(__dirname,'router-adapter.tsx'),react:path.join(root,'node_modules/react'),'react-dom':path.join(root,'node_modules/react-dom')}},
    module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'typescript-loader.cjs')}]},
  },(error,stats)=>{if(error)return reject(error);if(stats.hasErrors())return reject(new Error(stats.toString({all:false,errors:true})));resolve();}));
  const css=(await fs.readFile(path.join(root,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','');
  await fs.writeFile(path.join(output,'fixture.css'),css+'\n.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.fixture-chart-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;margin-top:20px}.fixture-panel{min-width:0;padding:22px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.fixture-panel h2{font-size:15px;margin:0 0 6px}.fixture-panel>p{font-size:12px;color:var(--txt-muted);line-height:1.6;margin:0 0 20px}.fixture-attention{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid var(--line);font-size:13px}.fixture-attention strong{font-size:16px;font-variant-numeric:tabular-nums}@media(max-width:1000px){.fixture-chart-grid{grid-template-columns:minmax(0,1fr)}}');
  await fs.copyFile(path.join(root,'public/logo.png'),path.join(output,'logo.png'));
  await fs.copyFile(path.join(root,'public/pearl.png'),path.join(output,'pearl.png'));
  await fs.writeFile(path.join(output,'index.html'),'<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Platinum Circles — synthetic UI verification</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  console.log('Compiled actual admin components with an isolated navigation adapter:',output);
}
main().catch(error=>{console.error(error);process.exitCode=1});
