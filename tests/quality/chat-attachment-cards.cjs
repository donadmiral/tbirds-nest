const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../../shared/chatAttachmentCards.ts'),'utf8'),exportsObject={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject});
const {parseChatAttachmentCard:parse,attachmentCardText:text,attachmentCardLinks:links}=exportsObject;
const card=v=>parse(JSON.stringify({pcAttachment:1,...v}));
test('contacts become bounded structured cards with safe phone/email actions',()=>{
 const c=card({kind:'contact',name:'  Musa Test  ',phone:'+263 (77) 123-4567',email:'musa+work@example.com',unexpected:'ignored'});
 assert.equal(c.name,'Musa Test');assert.equal(c.unexpected,undefined);assert.equal(text(c),'Contact: Musa Test');
 assert.equal(links(c)[0].url,'tel:+263771234567');assert.equal(links(c)[1].url,'mailto:musa%2Bwork%40example.com');
});
test('unstructured text, wrong versions, oversized payloads and unsafe contacts are rejected',()=>{
 for(const value of [null,1,{},'ordinary text','https://example.com','{',JSON.stringify({pcAttachment:2,kind:'contact',name:'A',phone:'123'}),' '.repeat(2049)])assert.equal(parse(value),null);
 for(const fields of [{name:'',phone:'123'},{name:'x'.repeat(101),phone:'123'},{name:'A'},{name:'A',phone:'12'},{name:'A',phone:'javascript:alert(1)'},{name:'A',phone:'123;123'},{name:'A',email:'a@example.com\r\nBcc:someone@example.com'},{name:'A',email:'not email'}])assert.equal(card({kind:'contact',...fields}),null);
});
test('location cards accept coordinate boundaries and produce an HTTPS map link',()=>{
 for(const [latitude,longitude] of [[0,0],[-90,-180],[90,180],[-17.8252,31.0335]]){
  const c=card({kind:'location',latitude,longitude,accuracy:12,capturedAt:'2026-10-28T12:30:00.000Z'});
  assert.ok(c);assert.equal(c.accuracy,12);assert.equal(text(c),'Shared location');assert.equal(links(c)[0].url,`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`);
 }
});
test('locations reject out-of-range, missing, nonnumeric or invalid date payloads',()=>{
 for(const fields of [{latitude:90.1,longitude:0},{latitude:0,longitude:-180.1},{latitude:'12',longitude:13},{longitude:13},{latitude:null,longitude:0},{latitude:0,longitude:0,capturedAt:'not a date'}])assert.equal(card({kind:'location',capturedAt:'2026-10-28T12:30:00Z',...fields}),null);
});
test('untrusted optional accuracy values are omitted rather than displayed as GPS precision',()=>{
 for(const accuracy of [-2,'1',null])assert.equal(card({kind:'location',latitude:0,longitude:0,accuracy,capturedAt:'2026-10-28T12:30:00Z'}).accuracy,undefined);
});
