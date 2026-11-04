import React,{useState} from 'react';
import{createRoot}from'react-dom/client';
import{readMcworld}from'mcbe-leveldb-reader';
import*as nbt from'prismarine-nbt';
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
async function parseRoots(buffer){
 const roots=[];let offset=0,guard=0;
 while(offset<buffer.length&&guard++<256){
  const part=buffer.subarray(offset);
  try{
   const result=await nbt.parse(part,'little');
   const parsed=result?.parsed;
   const consumed=result?.metadata?.size||0;
   if(!parsed||!consumed||consumed>part.length)break;
   roots.push(parsed);offset+=consumed;
  }catch{break;}
 }
 return roots;
}
async function analyzeWorld(file,onProgress){
 const db=await readMcworld(file,{log:m=>onProgress(m),error:m=>onProgress(m)});
 const containers=[],slotRows=[],diagnostics={records:db.size,blockEntityRecords:0,roots:0,failedRoots:0};
 let seen=0;
 for(const [,entry] of db){
  seen++;
  if(seen%15000===0)onProgress('Analisando registros '+seen.toLocaleString('pt-BR')+' / '+db.size.toLocaleString('pt-BR')+'…');
  if(!entry||typeof entry==='boolean'||!entry.value)continue;
  const keyInfo=decodeChunkKey(entry.keyBytes);
  if(!keyInfo||keyInfo.tag!==0x31)continue;
  diagnostics.blockEntityRecords++;
  const roots=await parseRoots(entry.value);
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
 {result&&<><section className="panel"><h2>2. Resultado da leitura</h2><div className="metrics"><div><b>{result.diagnostics.records.toLocaleString('pt-BR')}</b><span>registros LevelDB</span></div><div><b>{result.diagnostics.blockEntityRecords.toLocaleString('pt-BR')}</b><span>registros BlockEntity</span></div><div><b>{result.containers.length.toLocaleString('pt-BR')}</b><span>contêineres identificados</span></div><div><b>{result.rows.length.toLocaleString('pt-BR')}</b><span>linhas de inventário</span></div></div><p className="small">Raízes NBT decodificadas: {result.diagnostics.roots.toLocaleString('pt-BR')} • Registros que não puderam ser interpretados: {result.diagnostics.failedRoots.toLocaleString('pt-BR')}</p><button disabled={!result.rows.length} onClick={exportXlsx}>Exportar Excel (3 dimensões)</button></section>
 <section className="panel"><div className="listHead"><h2>3. Listagem dos contêineres e itens</h2><select value={filter} onChange={e=>setFilter(e.target.value)}><option>Todos</option><option>Overworld</option><option>Nether</option><option>End</option></select></div>{visible.length?<div className="tableWrap"><table><thead><tr>{['Dimensão','Contêiner','X','Y','Z','Slot','Item','Qtd.','Nome personalizado','Encantamentos'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{visible.slice(0,1500).map((r,i)=><tr key={i}><td>{r.Dimensao}</td><td>{r.Tipo}</td><td>{r.X}</td><td>{r.Y}</td><td>{r.Z}</td><td>{r.Slot}</td><td>{r.Item}</td><td>{r.Quantidade}</td><td>{r.NomeDoItem||r.NomePersonalizado}</td><td>{r.Encantamentos}</td></tr>)}</tbody></table></div>:<p>Nenhum item/contêiner disponível para listar.</p>}{visible.length>1500&&<p className="small">Prévia limitada a 1.500 linhas. O Excel inclui todas.</p>}</section></>}
 <section className="panel"><h2>Sobre a leitura</h2><ul><li>Identifica registros BlockEntity pelo marcador binário oficial do Bedrock (0x31).</li><li>Interpreta NBT little-endian concatenado e extrai Items, slots e coordenadas.</li><li>Separa os resultados em Overworld, Nether e End.</li></ul><p className="warning">A validação deve ser feita com o resultado real do seu mundo. Registros vazios e contêineres sem itens são mantidos na listagem.</p></section><footer>Processamento no navegador. O arquivo original não é alterado.</footer></main>
}
createRoot(document.getElementById('root')).render(<App/>);
