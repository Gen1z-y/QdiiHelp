{
// Enhance static and dynamically rendered editable fields without changing their events.
const types=new Set(['text','search','number','date','month','week','time','datetime-local','email','tel','url','password']);
function enhance(root){
 const inputs=[...(root.matches?.('input,textarea')?[root]:[]),...root.querySelectorAll('input,textarea')];
 for(const input of inputs){
  if(input.closest('.clearableInput')||input.hidden||input.tagName==='INPUT'&&!types.has(input.type))continue;
  const wrapper=document.createElement('span');wrapper.className='clearableInput';
  const button=document.createElement('button');button.type='button';button.className='clearInput';button.dataset.action='neutral';button.textContent='×';
  const label=input.getAttribute('aria-label')||input.labels?.[0]?.textContent.trim()||input.placeholder||'输入内容';
  button.setAttribute('aria-label','清除'+label);button.title='清除输入内容';
  input.before(wrapper);wrapper.append(input,button);
  button.addEventListener('click',()=>{
   if(input.disabled||input.readOnly)return;
   input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.focus();
  });
 }
}
enhance(document);
new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)enhance(node);}).observe(document.body,{childList:true,subtree:true});

}
