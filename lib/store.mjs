import fs from 'node:fs';
import path from 'node:path';
import {archiveDir,atomicWrite,digest,loadState,validateState,freezeSnapshot} from './storage-format.mjs';
import {compactArchives} from './storage-maintenance.mjs';
// Archived input snapshots are immutable: replace them when inputs change.
const largeFields=new Set(['forecast','partialForecast','originalForecast','analysis','latestHoldings','challenger']);
export class Store {
 constructor(file,{preparsed}={}){
  // Startup may hand over the manifest it already parsed; otherwise read it here.
  const raw=preparsed??(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):undefined);
  this.sharedStorage=raw?.storageVersion===3;
  this.file=file;this.archiveCache=new WeakMap();this.archiveRefs={};
  // Only legacy files need the version recheck and migration backup on first save.
  if(raw&&[2,3].includes(raw.storageVersion))this.migrationChecked=true;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  this.data=raw?loadState(file,(value,id,ref)=>{if(this.sharedStorage)this.archiveCache.set(freezeSnapshot(value),id);this.archiveRefs[id]=ref;},file,raw):{version:1,watchlist:['018147','270023'],records:{},lastView:{}};
  this.linkViews();
  if(!this.data.fundGroups){
   const boundary=this.data.watchlist.indexOf('001299');
   this.data.fundGroups=Object.fromEntries(this.data.watchlist.map((code,i)=>[code,boundary>=0?(i<=boundary?'held':'watch'):(this.data.positions?.[code]?.amount>0?'held':'watch')]));
  }
 }
 linkViews(){for(const [key,view] of Object.entries(this.data.lastView??{}))view.record=this.data.records[key]??view.record??{};}
 compact(options){
  this.save();
  try{return compactArchives(this.file,options);}finally{
   // A committed compaction may have encountered a cleanup failure: always
   // refresh offsets before any later save to avoid reusing obsolete references.
   this.archiveCache=new WeakMap();this.archiveRefs=JSON.parse(fs.readFileSync(this.file,'utf8')).archives??{};
  }
 }
 deferSave(){if(this.saveTimer)return;this.saveTimer=setTimeout(()=>{this.saveTimer=null;try{this.save();}catch(e){console.error('保存失败：'+e.message);}},10000);this.saveTimer.unref();}
 save(){
  if(this.saveTimer){clearTimeout(this.saveTimer);this.saveTimer=null;}
  validateState(this.data);
  if(fs.existsSync(this.file)&&!this.migrationChecked){
   const raw=JSON.parse(fs.readFileSync(this.file,'utf8'));
   if(![2,3].includes(raw.storageVersion)){const backup=this.file+'.before-monthly-storage.bak';if(!fs.existsSync(backup))fs.copyFileSync(this.file,backup,fs.constants.COPYFILE_EXCL);}
   this.migrationChecked=true;
  }
  const refs={},pending=new Map(),newCache=[],self=this,records=this.data.records;
  const encoded=new WeakMap();
  function retain(id){
   if(refs[id])return;
   const ref=self.archiveRefs[id];if(!ref)throw Error('共用资料引用缺失');
   refs[id]=ref;for(const child of ref.children??[])retain(child);
  }
  function archive(value,fallbackDate,root=true){
   if(!value||typeof value!=='object')return value;
   if(encoded.has(value))return encoded.get(value);
   let id=self.archiveCache.get(value);
   if(id&&self.archiveRefs[id]){retain(id);const result={$archive:id};encoded.set(value,result);return result;}
   // Small values stay inline; larger unchanged subtrees are shared across funds/dates.
   const date=value.date??value.forecast?.date??fallbackDate??new Date().toISOString().slice(0,10);
   const children=[];
   const convert=(child,share=false)=>{const result=archive(child,date,share);if(result&&typeof result==='object'&&Object.keys(result).length===1&&result.$archive)children.push(result.$archive);return result;};
   // Row-level quote subobjects stay inline: sharing them saved almost no
   // bytes but added thousands of index entries per day.
   const payload=Array.isArray(value)?value.map(v=>convert(v)):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,convert(v)]));
   const bytes=Buffer.from(JSON.stringify(payload));
   if(!root&&bytes.length<1024&&!children.length){encoded.set(value,payload);return payload;}
   id=digest(bytes);
   if(self.archiveRefs[id])retain(id);
   else if(!pending.has(id)){
    const month=/^\d{4}-\d{2}/.test(date)?date.slice(0,7):new Date().toISOString().slice(0,7);
    pending.set(id,{bytes,file:month+'.ndjson',children:[...new Set(children)]});
   }
   const result={$archive:id};encoded.set(value,result);newCache.push([value,id]);return result;
  }
  const state=JSON.stringify(this.data,function(key,value){
   if(this?.code&&this?.date&&(key==='record'&&records?.[this.code+':'+this.date]||key==='analysis'&&this.record?.forecast))return undefined;
   if(largeFields.has(key))return archive(value,this.date);
   if((key==='evidence'||key==='rejectedForecasts')&&Array.isArray(value))return value.map(v=>archive(v,this.forecast?.date));
   if(key==='holdingsSnapshots')return Object.fromEntries(Object.entries(value).map(([code,h])=>[code,archive(h,h.asOf)]));
   return value;
  });
  // Append payloads first; atomic main-file rename is the commit point.
  const handles=new Map();
  try{
   if(pending.size)fs.mkdirSync(archiveDir(this.file),{recursive:true});
   for(const [id,{bytes,file,children}] of pending){
    let h=handles.get(file);if(!h){const fd=fs.openSync(path.join(archiveDir(this.file),file),'a');h={fd,offset:fs.fstatSync(fd).size};handles.set(file,h);}
    refs[id]={file,offset:h.offset,length:bytes.length,children};fs.writeFileSync(h.fd,Buffer.concat([bytes,Buffer.from('\n')]));h.offset+=bytes.length+1;
   }
   for(const h of handles.values())fs.fsyncSync(h.fd);
  }finally{for(const h of handles.values())fs.closeSync(h.fd);}
  const disk=JSON.parse(state);disk.storageVersion=3;disk.archives=refs;
  const watermark=Object.getOwnPropertyDescriptor(this.data,'archiveVerify')?.value;
  if(watermark)disk.archiveVerify=watermark;
  atomicWrite(this.file,JSON.stringify(disk));
  this.lastSavedAt=new Date().toISOString();
  this.sharedStorage=true;Object.assign(this.archiveRefs,refs);for(const [value,id] of newCache)this.archiveCache.set(freezeSnapshot(value),id);
 }
 replace(data){validateState(data);const previous=this.data;this.data=data;this.linkViews();try{this.save();}catch(e){this.data=previous;throw e;}}
  add(code,group='watch') {
    if(!['held','watch'].includes(group))throw new Error('请选择加入自选或持有');
    if(!this.data.watchlist.includes(code))this.data.watchlist.push(code);
    this.data.fundGroups??={};this.data.fundGroups[code]=group;this.save();
  }
  remove(code) {this.data.watchlist=this.data.watchlist.filter(c=>c!==code);this.save();}
  reorder(codes) {
    if(!Array.isArray(codes)||codes.length!==this.data.watchlist.length||new Set(codes).size!==codes.length||codes.some(c=>!this.data.watchlist.includes(c)))throw new Error('排序必须包含当前全部基金且不能重复，请刷新后重试');
    this.data.watchlist=[...codes];this.save();
  }
}
