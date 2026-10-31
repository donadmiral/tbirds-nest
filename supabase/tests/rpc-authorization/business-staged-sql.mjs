// Statement boundaries only. Function/DO bodies, quoted text and comments are
// retained byte-for-byte; this is not a SQL formatter or an approval classifier.
export function splitSql(source){
 const statements=[];let start=0,i=0,quote=null,dollar=null,block=0,line=false,escapes=false;
 while(i<source.length){
  const c=source[i],next=source[i+1];
  if(line){if(c==='\n'||c==='\r')line=false;i++;continue;}
  if(block){if(c==='/'&&next==='*'){block++;i+=2;}else if(c==='*'&&next==='/'){block--;i+=2;}else i++;continue;}
  if(dollar){if(source.startsWith(dollar,i)){i+=dollar.length;dollar=null;}else i++;continue;}
  if(quote){if(escapes&&c==='\\'){i+=2;continue;}if(c===quote){if(next===quote)i+=2;else{quote=null;i++;}}else i++;continue;}
  if(c==='-'&&next==='-'){line=true;i+=2;continue;}
  if(c==='/'&&next==='*'){block=1;i+=2;continue;}
  if(c==="'"||c==='"'){quote=c;escapes=c==="'"&&/[eE]/.test(source[i-1]||'')&&!/[\w$]/.test(source[i-2]||'');i++;continue;}
  if(c==='$'){const tag=/^\$(?:[A-Za-z_]\w*)?\$/.exec(source.slice(i));if(tag){dollar=tag[0];i+=dollar.length;continue;}}
  if(c===';'){statements.push({index:statements.length,start,end:i+1,sql:source.slice(start,i+1)});start=i+1;}
  i++;
 }
 if(quote||dollar||block)throw new Error('Unterminated SQL token');
 if(stripLeadingComments(source.slice(start)).trim())throw new Error('SQL ends without a statement terminator');
 return{statements,trailing:source.slice(start)};
}
export function stripLeadingComments(source){
 let text=source;
 while(true){text=text.trimStart();if(text.startsWith('--')){const next=text.search(/[\r\n]/);if(next<0)return '';text=text.slice(next+1);continue;}
  if(text.startsWith('/*')){let i=2,depth=1;while(i<text.length&&depth){if(text.slice(i,i+2)==='/*'){depth++;i+=2;}else if(text.slice(i,i+2)==='*/'){depth--;i+=2;}else i++;}if(depth)throw new Error('Unterminated leading comment');text=text.slice(i);continue;}
  return text;
 }
}
export function statementKind(statement){return stripLeadingComments(statement.sql).trim();}
