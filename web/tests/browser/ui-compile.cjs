/** Actual component fixture compiler. No application route or production bypass is added. */
const fs=require('node:fs/promises'),path=require('node:path');
const {webpack}=require('../../node_modules/next/dist/compiled/webpack/webpack');
const postcss=require('postcss'),tailwind=require('@tailwindcss/postcss');
const root=path.resolve(__dirname,'../..');
async function compile({entry,output,aliases={},title='Platinum Circles synthetic UI verification'}){
  entry=path.resolve(entry);output=path.resolve(output);await fs.mkdir(output,{recursive:true});
  const alias={...aliases,'@':root,'next/link':aliases['next/link']||path.join(__dirname,'ui-router-adapter.tsx'),'next/navigation':aliases['next/navigation']||path.join(__dirname,'ui-router-adapter.tsx'),react:aliases.react||path.join(root,'node_modules/react'),'react-dom':aliases['react-dom']||path.join(root,'node_modules/react-dom')};
  await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,context:root,target:'web',entry,plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development',NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-only'})})],output:{path:output,filename:'fixture.js',assetModuleFilename:'assets/[name][ext]'},resolve:{extensions:['.tsx','.ts','.js','.cjs'],alias},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(__dirname,'ui-typescript-loader.cjs')},{test:/\.module\.css$/,use:path.join(__dirname,'ui-css-module-loader.cjs')},{test:/\.(png|jpe?g|gif|webp|svg|mp3|aac|m4a|mp4)$/i,type:'asset/resource'}]}},(error,stats)=>{if(error)return reject(error);if(stats.hasErrors())return reject(new Error(stats.toString({all:false,errors:true})));resolve();}));
  const file=path.join(root,'app/globals.css');
  const css=await postcss([tailwind({base:root,optimize:false})]).process(await fs.readFile(file,'utf8'),{from:file});
  await fs.writeFile(path.join(output,'fixture.css'),css.css+'\nbody{margin:0;font-family:Arial,Helvetica,sans-serif}');
  await fs.writeFile(path.join(output,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/[<>&"]/g,'')}</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  return {entry,output};
}
module.exports={compile};
if(require.main===module){const entry=process.env.PLATINUM_UI_ENTRY;if(!entry)throw new Error('PLATINUM_UI_ENTRY is required');compile({entry,output:process.env.PLATINUM_UI_OUTPUT||'/tmp/platinum-web-browser',aliases:JSON.parse(process.env.PLATINUM_UI_ALIASES_JSON||'{}')}).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error);process.exitCode=1;});}
