import React,{useState} from 'react';
import{createRoot}from'react-dom/client';
import{readMcworld}from'mcbe-leveldb-reader';
import*as XLSX from'xlsx';
import './style.css';

const DIMENSIONS={0:'Overworld',1:'Nether',2:'End'};
const valueOf=(tag)=>tag&&typeof tag==='object'&&'value'in tag?tag.value:tag;
const field=(obj,key)=>valueOf(obj?.[key]);
const asList=(tag)=>{const v=valueOf(tag);return Array.isArray(v)?v:(Array.isArray(v?.value)?v.value:[]);};
const text=(v)=>v===undefined||v===null?'':String(valueOf(v));
const itemEnchantments=(item)=>{
 const tag=field(item,'tag')||{};
 const list=asList(tag.Enchantments||tag.enchantments);
 return list.map(e=>{const x=e?.value||e;const id=field(x,'id')??field(x,'name')??'';const lvl=field(x,'lvl')??field(x,'level')??'';return id?(String(id)+(lvl!==''?' '+lvl:'')):''}).filter(Boolean).join('; ');
};
const itemName=(item)=>text(field(item,'Name')??field(item,'name')??field(item,'id'))||'Item sem nome';
const customName=(item)=>{const t=field(item,'tag')||{};const display=field(t,'display')||{};return text(field(display,'Name')??field(t,'CustomName'))};
const isContainer=(id,obj)=>/chest|barrel|hopper|dispenser|dropper|furnace|smoker|blast_furnace|brewing_stand|shulker_box|crafter|campfire|cauldron/i.test(id+' '+text(field(obj,'id')));
function decodeChunkKey(bytes){
 if(!bytes||bytes.length<9)return null;
 const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const x=dv.getInt32(0,true),z=dv.getInt32(4,true);
 let dimension=0,tagIndex=8;
 if(bytes.length>=13){dimension=dv.getInt32(8,true);tagIndex=12;}
 if(dimension<0||dimension>2)return null;
 return {chunkX:x,chunkZ:z,dimension,tag:bytes[tagIndex],tagIndex};
}
function parseBedrockNbt(bytes){
 const data=bytes[0]===0x0a?bytes:new Uint8Array([0x0a,...bytes]);
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);let p=0;
 const u8=()=>{if(p+1>data.length)throw Error('NBT truncado');return data[p++];};
 const i16=()=>{if(p+2>data.length)throw Error('NBT truncado');const v=view.getInt16(p,true);p+=2;return v;};
 const u16=()=>{if(p+2>data.length)throw Error('NBT truncado');const v=view.getUint16(p,true);p+=2;return v;};
 const i32=()=>{if(p+4>data.length)throw Error('NBT truncado');const v=view.getInt32(p,true);p+=4;return v;};
 const i64=()=>{if(p+8>data.length)throw Error('NBT truncado');const v=view.getBigInt64(p,true);p+=8;return v.toString();};
 const f32=()=>{if(p+4>data.length)throw Error('NBT truncado');const v=view.getFloat32(p,true);p+=4;return v;};
 const f64=()=>{if(p+8>data.length)throw Error('NBT truncado');const v=view.getFloat64(p,true);p+=8;return v;};
 const str=()=>{const n=u16();if(p+n>data.length)throw Error('String NBT truncada');const s=new TextDecoder().decode(data.subarray(p,p+n));p+=n;return s;};
 const bytesArray=()=>{const n=i32();if(n<0||p+n>data.length)throw Error('ByteArray inválido');const a=Array.from(data.subarray(p,p+n));p+=n;return a;};
 const payload=(type)=>{
  switch(type){
   case 1:return u8()>127?data[p-1]-256:data[p-1];
   case 2:return i16();case 3:return i32();case 4:return i64();case 5:return f32();case 6:return f64();
   case 7:return bytesArray();case 8:return str();
   case 9:{const t=u8(),n=i32();if(n<0||n>1000000)throw Error('Lista NBT inválida');const a=[];for(let i=0;i<n;i++)a.push(payload(t));return a;}
   case 10:{const o={};let guard=0;while(true){if(++guard>100000)throw Error('Compound NBT sem terminador');const t=u8();if(t===0)break;const k=str();o[k]=payload(t);}return o;}
   case 11:{const n=i32();if(n<0||n>1000000)throw Error('IntArray inválido');const a=[];for(let i=0;i<n;i++)a.push(i32());return a;}
   case 12:{const n=i32();if(n<0||n>1000000)throw Error('LongArray inválido');const a=[];for(let i=0;i<n;i++)a.push(i64());return a;}
   default:throw Error('Tipo NBT desconhecido: '+type);
  }
 };
 const rootType=u8();if(rootType!==10)throw Error('Raiz NBT não é Compound: '+rootType);
 const rootName=str();const root=payload(10);
 return {name:rootName,value:root,bytesRead:p};
}
async function parseRoots(buffer,diagnostics){
 try{
  const parsed=parseBedrockNbt(buffer);
  diagnostics.nbtBytesRead=parsed.bytesRead;
  return [parsed.value];
 }catch(e){
  if(!diagnostics.firstNbtError)diagnostics.firstNbtError=String(e?.message||e);
  if(!diagnostics.firstValueHex)diagnostics.firstValueHex=Array.from(buffer.slice(0,40)).map(v=>v.toString(16).padStart(2,'0')).join(' ');
  return [];
 }
}
async function analyzeWorld(file,onProgress){
 const db=await readMcworld(file,{log:m=>onProgress(m),error:m=>onProgress(m)});
 const containers=[],slotRows=[],diagnostics={records:db.size,blockEntityRecords:0,roots:0,failedRoots:0,firstNbtError:'',firstValueHex:'',nbtBytesRead:0};
 let seen=0;
 for(const [,entry] of db){
  seen++;
  if(seen%15000===0)onProgress('Analisando registros '+seen.toLocaleString('pt-BR')+' / '+db.size.toLocaleString('pt-BR')+'…');
  if(!entry||typeof entry==='boolean'||!entry.value)continue;
  const keyInfo=decodeChunkKey(entry.keyBytes);
  if(!keyInfo||keyInfo.tag!==0x31)continue;
  diagnostics.blockEntityRecords++;
  const roots=await parseRoots(entry.value,diagnostics);
  if(!roots.length){diagnostics.failedRoots++;continue;}
  for(const root of roots){
   diagnostics.roots++;
   const obj=valueOf(root)||{};
   const id=text(field(obj,'id'))||'BlockEntity';
   const x=Number(field(obj,'x')),y=Number(field(obj,'y')),z=Number(field(obj,'z'));
   const dim=DIMENSIONS[keyInfo.dimension]||'Overworld';
   const items=asList(obj.Items);
   if(!isContainer(id,obj)&&!obj.Items)continue;
   const container={Dimensao:dim,Tipo:id, X:Number.isFinite(x)?x:'',Y:Number.isFinite(y)?y:'',Z:Number.isFinite(z)?z:'',NomePersonalizado:text(field(obj,'CustomName')),QuantidadeItens:items.length};
   containers.push(container);
   if(items.length){
    for(const raw of items){
     const item=valueOf(raw)||{};
     slotRows.push({...container,Slot:field(item,'Slot')??'',Item:itemName(item),Quantidade:Number(field(item,'Count')??1),Dano:field(item,'Damage')??'',NomeDoItem:customName(item),Encantamentos:itemEnchantments(item)});
    }
   }else{
    slotRows.push({...container,Slot:'',Item:field(obj,'LootTable')?'Aguardando loot table':'(vazio)',Quantidade:0,Dano:'',NomeDoItem:'',Encantamentos:''});
   }
  }
 }
 return {containers,rows:slotRows,diagnostics};
}
function App(){
 const[file,setFile]=useState(null),[status,setStatus]=useState('Selecione seu arquivo .mcworld para começar.'),[busy,setBusy]=useState(false),[result,setResult]=useState(null),[filter,setFilter]=useState('Todos');
 async function run(){if(!file)return;setBusy(true);setResult(null);setStatus('Lendo o pacote e reconstruindo o LevelDB…');try{const r=await analyzeWorld(file,setStatus);setResult(r);setStatus(r.containers.length?'Leitura concluída. Contêineres identificados; confira a listagem abaixo.':'O LevelDB foi aberto, mas nenhum registro BlockEntity com contêiner foi identificado. Consulte o diagnóstico para verificar os registros encontrados.');}catch(e){setStatus('Falha na análise: '+(e?.message||String(e)));}finally{setBusy(false)}}
 function exportXlsx(){if(!result)return;const wb=XLSX.utils.book_new();for(const dim of Object.values(DIMENSIONS)){const rows=result.rows.filter(r=>r.Dimensao===dim);const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{Aviso:'Nenhum contêiner identificado nesta dimensão'}]);XLSX.utils.book_append_sheet(wb,ws,dim);}XLSX.writeFile(wb,'Inventario_Minecraft_por_dimensao.xlsx');}
 const visible=result?.rows.filter(r=>filter==='Todos'||r.Dimensao===filter)||[];
 return <main><header><div className="logo">MC</div><div><h1>Inventário Minecraft Bedrock</h1><p>Leitura local de mundos .mcworld • seus arquivos não são enviados</p></div></header>
 <section className="panel"><h2>1. Selecione o mundo</h2><label className="drop"><input type="file" accept=".mcworld,.zip" onChange={e=>{setFile(e.target.files?.[0]||null);setResult(null)}}/><strong>{file?file.name:'Escolher arquivo .mcworld'}</strong><span>{file?(file.size/1024/1024).toFixed(1)+' MB':'Toque para procurar no dispositivo'}</span></label><button disabled={!file||busy} onClick={run}>{busy?'Analisando…':'Analisar mundo'}</button><div className="status">{status}</div></section>
 {result&&<><section className="panel"><h2>2. Resultado da leitura</h2><div className="metrics"><div><b>{result.diagnostics.records.toLocaleString('pt-BR')}</b><span>registros LevelDB</span></div><div><b>{result.diagnostics.blockEntityRecords.toLocaleString('pt-BR')}</b><span>registros BlockEntity</span></div><div><b>{result.containers.length.toLocaleString('pt-BR')}</b><span>contêineres identificados</span></div><div><b>{result.rows.length.toLocaleString('pt-BR')}</b><span>linhas de inventário</span></div></div><p className="small">Raízes NBT decodificadas: {result.diagnostics.roots.toLocaleString('pt-BR')} • Registros que não puderam ser interpretados: {result.diagnostics.failedRoots.toLocaleString('pt-BR')}<br/>Erro NBT: {result.diagnostics.firstNbtError||'não disponível'}<br/>Primeiros bytes: {result.diagnostics.firstValueHex||'não disponível'}</p><button disabled={!result.rows.length} onClick={exportXlsx}>Exportar Excel (3 dimensões)</button></section>
 <section className="panel"><div className="listHead"><h2>3. Listagem dos contêineres e itens</h2><select value={filter} onChange={e=>setFilter(e.target.value)}><option>Todos</option><option>Overworld</option><option>Nether</option><option>End</option></select></div>{visible.length?<div className="tableWrap"><table><thead><tr>{['Dimensão','Contêiner','X','Y','Z','Slot','Item','Qtd.','Nome personalizado','Encantamentos'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{visible.slice(0,1500).map((r,i)=><tr key={i}><td>{r.Dimensao}</td><td>{r.Tipo}</td><td>{r.X}</td><td>{r.Y}</td><td>{r.Z}</td><td>{r.Slot}</td><td>{r.Item}</td><td>{r.Quantidade}</td><td>{r.NomeDoItem||r.NomePersonalizado}</td><td>{r.Encantamentos}</td></tr>)}</tbody></table></div>:<p>Nenhum item/contêiner disponível para listar.</p>}{visible.length>1500&&<p className="small">Prévia limitada a 1.500 linhas. O Excel inclui todas.</p>}</section></>}
 <section className="panel"><h2>Sobre a leitura</h2><ul><li>Identifica registros BlockEntity pelo marcador binário oficial do Bedrock (0x31).</li><li>Interpreta NBT little-endian concatenado e extrai Items, slots e coordenadas.</li><li>Separa os resultados em Overworld, Nether e End.</li></ul><p className="warning">A validação deve ser feita com o resultado real do seu mundo. Registros vazios e contêineres sem itens são mantidos na listagem.</p></section><footer>Processamento no navegador. O arquivo original não é alterado.</footer></main>
}
createRoot(document.getElementById('root')).render(<App/>);
