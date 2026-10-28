const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const common={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(root,'shared/postMediaEditing.ts'),'utf8')),common);
const walk=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...walk(node.props?.children)];
const content=node=>typeof node==='string'?node:Array.isArray(node)?node.map(content).join(''):node?.props?content(node.props.children):'';
function harness(item){
  let cursor=0;const states=[],saved=[];
  const react={useState(initial){const at=cursor++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return[states[at],value=>{states[at]=typeof value==='function'?value(states[at]):value;}];},useRef(initial){const at=cursor++;return states[at]??={current:initial};},useEffect(){}};
  const jsx=(type,props)=>({type,props});
  const styles={default:{}};const icons=new Proxy({},{get:(_,key)=>key});
  const exports={};
  vm.runInNewContext(compile(fs.readFileSync(path.join(root,'web/components/PostMediaEditor.tsx'),'utf8')),{exports,require:name=>({'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':icons,'@/lib/stories':{STORY_FILTERS:[{id:'warm',label:'Warm',layers:[],css:'sepia(.2)'}],filterCss:()=>undefined},'./PostMediaEditor.module.css':styles,'../../shared/postMediaEditing':common.exports,'./StoryEngine':{AdjustOverlay:'AdjustOverlay'},'./PostCaption':{PostCaption:'PostCaption'}}[name]??{}),crypto:require('node:crypto').webcrypto,URL:{createObjectURL:()=> 'blob:chosen-cover',revokeObjectURL(){}},createImageBitmap:async()=>({close(){}})});
  const props={item,index:0,total:1,onClose(){},onSave:(...value)=>saved.push(value)};
  const render=()=>{cursor=0;return exports.PostMediaEditor(props);};
  const button=(label)=>walk(render()).find(n=>n.type==='button'&&content(n)===label);
  const click=(label)=>{const found=button(label);assert.ok(found,`Missing ${label} control`);found.props.onClick();};
  return{render,click,saved,find:fn=>walk(render()).find(fn),all:()=>walk(render())};
}
test('web crop choices and fit, rotation, flip and filters save a usable rendering recipe',()=>{
  const h=harness({preview:'blob:photo',width:1080,height:1920,isVideo:false});
  h.click('16:9');h.click('Fit');h.click('Rotate');h.click('Flip');h.click('Filters');h.click('Warm');
  h.find(n=>n.props?.label==='Strength').props.onChange(45);h.click('Adjust');h.find(n=>n.props?.label==='Light').props.onChange(22);h.click('Apply');
  const [recipe]=h.saved[0];assert.equal(recipe.aspectRatio,16/9);assert.equal(recipe.fit,'contain');assert.equal(recipe.rotation,90);assert.equal(recipe.flipX,true);assert.equal(recipe.filterId,'warm');assert.equal(recipe.filterAmt,45);assert.equal(recipe.adjust.bri,22);
});
test('web video trim and timed captions survive Apply with chosen style and placement',()=>{
  const h=harness({preview:'blob:video',width:1080,height:1920,isVideo:true});
  h.find(n=>n.type==='video').props.onLoadedMetadata({currentTarget:{duration:12,videoWidth:1080,videoHeight:1920,currentTime:0,playbackRate:1}});
  h.find(n=>n.props?.label==='Trim start').props.onChange(2);h.find(n=>n.props?.label==='Trim end').props.onChange(10);
  h.click('Captions');h.find(n=>n.type==='textarea').props.onChange({target:{value:'  A day to remember  '}});h.click('AaBold');h.click('Top');h.click('Apply');
  const [recipe]=h.saved[0];assert.equal(recipe.trimStart,2);assert.equal(recipe.trimEnd,10);assert.equal(recipe.captions[0].text,'A day to remember');assert.equal(recipe.captions[0].start,2);assert.equal(recipe.captions[0].end,10);assert.equal(recipe.captions[0].style,'bold');assert.equal(recipe.captions[0].position,'top');
});
test('web uploaded covers stay separate from the persisted recipe until publication binds their URL',async()=>{
  const h=harness({preview:'blob:video',width:1080,height:1920,isVideo:true});h.click('Cover');
  const cover={name:'cover.jpg',type:'image/jpeg'};await h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[cover],value:'cover.jpg'}});h.click('Apply');
  const [recipe,file,preview]=h.saved[0];assert.equal(file,cover);assert.equal(preview,'blob:chosen-cover');assert.equal(recipe.coverFile,undefined);assert.equal(recipe.coverPreview,undefined);assert.equal(recipe.coverUrl,undefined);
});

test('web repeated right-angle rotation leaves straighten at zero until an explicit offset is applied',()=>{
 const h=harness({preview:'blob:photo',width:900,height:1200,isVideo:false});for(let i=0;i<3;i++){h.click('Rotate');const slider=h.find(n=>n.props?.label==='Straighten');assert.equal(slider.props.value,0);assert.equal(slider.props.min,-45);assert.equal(slider.props.max,45);}
 h.find(n=>n.props?.label==='Straighten').props.onChange(12);h.click('Apply');assert.equal(h.saved[0][0].rotation,-78);
});
