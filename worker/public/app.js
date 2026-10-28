const $ = selector => document.querySelector(selector);
const labels = { posts:'文章與公告',members:'團隊成員',site:'網站與值班表',legacy:'其他頁面' };
let collection='posts', files=[], current=null, dirty=false, saving=false, loadVersion=0;
async function api(path,options={}) {
  const response=await fetch(`/api/${path}`,{...options,headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest',...options.headers}});
  if(response.status===401||response.redirected){throw new Error('登入已逾時，請先保留目前內容，再重新載入頁面登入。');}
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('無法讀取後台回應，請保留內容後重新登入。');
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'操作失敗，請稍後重試。');
  return data;
}
function showMessage(target,text,error=false,url) {
  target.hidden=false;target.classList.toggle('error',error);target.replaceChildren(document.createTextNode(text));
  if(url){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' 查看 commit ↗';target.append(link);}
}
function setDirty(value) {dirty=value;$('#dirty-status').textContent=value?'尚未提交的修改':'已與 GitHub 同步';}
function canDiscard(){if(saving)return false;return !dirty||confirm('目前有尚未提交的修改。確定要離開並捨棄嗎？');}
async function start() {
  try{const session=await api('session');$('#identity').textContent=session.login;$('#repository').textContent=`${session.repository} · ${session.branch}`;$('#login-screen').hidden=true;$('#app').hidden=false;await loadCollection('posts');await deployments();}catch(error){showMessage($('#app').hidden?$('#login-message'):$('#app-message'),error.message,true);}
}
$('#logout').addEventListener('click',()=>{if(canDiscard())location.assign('/cdn-cgi/access/logout');});
document.querySelectorAll('[data-collection]').forEach(button=>button.addEventListener('click',()=>{if(canDiscard())loadCollection(button.dataset.collection);}));
async function loadCollection(name) {
  const version=++loadVersion;collection=name;current=null;setDirty(false);$('#editor-form').hidden=true;$('#editor-empty').hidden=false;$('#filter').value='';$('#collection-title').textContent=labels[name];$('#new-document').hidden=name==='site';
  document.querySelectorAll('[data-collection]').forEach(button=>{if(button.dataset.collection===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('#document-list').textContent='正在讀取 GitHub…';
  try{const result=await api(`content?collection=${name}`);if(version!==loadVersion)return;files=result.items;renderFiles();}catch(error){if(version===loadVersion){$('#document-list').textContent='無法載入列表。';showMessage($('#app-message'),error.message,true);}}
}
function renderFiles() {
  const query=$('#filter').value.trim().toLowerCase();$('#document-list').replaceChildren();
  const matches=files.filter(file=>file.filename.toLowerCase().includes(query));
  if(!matches.length){$('#document-list').textContent='沒有符合的內容。';return;}
  for(const file of matches){const button=document.createElement('button');button.type='button';button.textContent=file.filename==='settings.json'?'網站內容與聯絡資訊':file.filename==='schedule.json'?'機房值班表':file.filename.replace(/\.json$/,'');button.className='document-link';if(current?.filename===file.filename)button.setAttribute('aria-current','true');button.addEventListener('click',()=>{if(canDiscard())openFile(file.filename);});$('#document-list').append(button);}
}
$('#filter').addEventListener('input',renderFiles);
async function openFile(filename) {
  const version=++loadVersion;const requestedCollection=collection;
  $('#document-title').textContent='讀取中…';
  try{const item=await api(`content?collection=${requestedCollection}&file=${encodeURIComponent(filename)}`);if(version!==loadVersion||collection!==requestedCollection)return;current=item;renderEditor();renderFiles();}catch(error){showMessage($('#app-message'),error.message,true);}
}
function field(name,label,type='text',options={}) {
  const wrapper=document.createElement('label');wrapper.className=`field ${type==='checkbox'?'check-field':''}`;
  const text=document.createElement('span');text.textContent=label;
  let input;
  if(type==='textarea'){input=document.createElement('textarea');input.rows=name==='body'?18:4;}
  else if(type==='select'){input=document.createElement('select');for(const value of ['公告','教學文件','機房日誌','招募資訊']){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}}
  else{input=document.createElement('input');input.type=type;}
  input.name=name;if(type==='checkbox')input.checked=!!current.data[name];else input.value=Array.isArray(current.data[name])?current.data[name].join(name==='links'?'\n':'、'):current.data[name]??'';
  input.required=!!options.required;input.readOnly=!!options.readOnly;if(options.max)input.maxLength=options.max;
  if(type==='checkbox')wrapper.append(input,text);else wrapper.append(text,input);
  $('#fields').append(wrapper);return input;
}
function renderEditor() {
  $('#editor-empty').hidden=true;$('#editor-form').hidden=false;$('#fields').replaceChildren();$('#document-title').textContent=current.sha?current.filename:'新增內容';$('#delete').hidden=!current.sha||collection==='site';setDirty(false);
  const required={required:true};
  if(collection==='posts') {
    field('title','文章標題','text',{...required,max:100});field('pinned','置頂公告／文章（優先顯示於首頁與公告列表；取消勾選即可解除）','checkbox');field('slug','文章網址（既有網址保留不變）','text',{...required,readOnly:!!current.sha,max:120});field('category','分類','select',required);field('summary','摘要','textarea',{...required,max:300});field('date','發布日期','date',required);field('tags','標籤，以頓號或逗號分隔');field('published','公開發布','checkbox');field('source','原文參考網址（選填）','url');field('body','內容（支援 Markdown 與已匯入的 HTML）','textarea',{...required,max:50000});
  } else if(collection==='members') {
    field('name','成員姓名','text',required);field('slug','成員網址','text',{...required,readOnly:!!current.sha});field('attributes','年級、職務與加入年份');field('image','頭像網址');field('links','個人連結，每行一個 HTTPS 或 mailto 連結','textarea');field('body','成員介紹（Markdown / HTML）','textarea');
  } else if(collection==='legacy') {
    field('title','頁面標題','text',required);field('path','頁面路徑，例如 /example/','text',{...required,readOnly:!!current.sha});field('body','頁面內容（Markdown / HTML）','textarea');
  } else if(current.filename==='settings.json') {
    for(const [name,label] of Object.entries({heroTitle:'首頁大標題（兩行，每行六字以內）',heroDescription:'首頁介紹',aboutText:'關於機房',recruitmentText:'培訓介紹',email:'聯絡信箱',phone:'電話／分機',officeHours:'辦公時間',networkForm:'網路回報表單',dnsForm:'DNS 申請表單',mailForm:'郵件回報表單'}))field(name,label,['heroTitle','heroDescription','aboutText','recruitmentText'].includes(name)?'textarea':name==='email'?'email':name.endsWith('Form')?'url':'text',required);
  } else {
    field('updated','值班表更新日期','date',required);
    const table=document.createElement('table');table.className='schedule-editor';const head=table.createTHead().insertRow();for(const label of ['時間','週一','週二','週三','週四','週五']){const th=document.createElement('th');th.textContent=label;head.append(th);}
    const body=table.createTBody();for(const [i,row] of current.data.rows.entries()){const tr=body.insertRow();for(const [j,cell] of row.entries()){const input=document.createElement('input');input.name=`cell-${i}-${j}`;input.value=cell.text;input.setAttribute('aria-label',`第 ${i+1} 列 ${j===0?'時間':`週${['','一','二','三','四','五'][j]}`}`);tr.insertCell().append(input);}}
    const scroll=document.createElement('div');scroll.className='table-scroll';scroll.append(table);$('#fields').append(scroll);
  }
  if($('#fields [name=body]')) {
    const tools=document.createElement('div');tools.className='writing-tools';
    for(const [label,before,after] of [['粗體','**','**'],['小標題','\n## ',''],['清單','\n- ',''],['連結','[','](https://)']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>{const area=$('#fields [name=body]');const start=area.selectionStart,end=area.selectionEnd;area.setRangeText(before+area.value.slice(start,end)+after,start,end,'select');area.focus();setDirty(true);});tools.append(button);}
    const upload=document.createElement('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp';upload.setAttribute('aria-label','上傳圖片（PNG、JPEG、WebP，最多 2 MB）');upload.addEventListener('change',()=>uploadImage(upload));tools.append(upload);$('#fields [name=body]').parentElement.before(tools);
  }
  $('#preview').hidden=!$('#fields [name=body]');
}
function collect() {
  const result=structuredClone(current.data);const form=new FormData($('#editor-form'));
  for(const input of $('#fields').querySelectorAll('input,textarea,select')) {
    const name=input.name;if(!name||name.startsWith('cell-'))continue;
    result[name]=input.type==='checkbox'?input.checked:input.value;
    if(name==='tags')result[name]=input.value.split(/[、,]/).map(s=>s.trim()).filter(Boolean);
    if(name==='links')result[name]=input.value.split('\n').map(s=>s.trim()).filter(Boolean);
  }
  if(collection==='site'&&current.filename==='schedule.json') {
    const known=new Map(current.data.rows.flatMap(row=>row.flatMap(cell=>cell.members.map(member=>[member.name,member.href]))));
    result.rows=result.rows.map((row,i)=>row.map((_cell,j)=>{const text=form.get(`cell-${i}-${j}`).trim();return {text,members:j===0?[]:text.split(/[、,\s]+/).filter(name=>known.has(name)).map(name=>({name,href:known.get(name)}))};}));
  }
  return result;
}
$('#editor-form').addEventListener('input',()=>setDirty(true));
$('#new-document').addEventListener('click',()=>{if(!canDiscard())return;const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});current={filename:'',sha:null,data:collection==='posts'?{title:'',slug:'',category:'公告',summary:'',date,published:false,pinned:false,tags:[],body:''}:collection==='members'?{name:'',slug:'',attributes:'',image:'',links:[],body:''}:{title:'',path:'',body:''}};renderEditor();});
$('#editor-form').addEventListener('submit',async event=>{
  event.preventDefault();if(saving)return;saving=true;$('#editor-form').inert=true;const button=$('#save');button.disabled=true;button.textContent='提交中…';
  try{const data=collect();const filename=current.filename||(collection==='legacy'?data.path.replaceAll('/',''):data.slug)+'.json';const result=await api(`content?collection=${collection}&file=${encodeURIComponent(filename)}`,{method:'PUT',body:JSON.stringify({data,sha:current.sha})});current={filename,sha:result.sha,data};setDirty(false);if(!files.some(f=>f.filename===filename))files.push({filename,sha:result.sha});renderFiles();showMessage($('#app-message'),'已提交到 GitHub。請等待建置成功後查看前台。',false,result.commit);await deployments();}catch(error){showMessage($('#app-message'),`${error.message} 目前輸入仍保留。`,true);}finally{saving=false;$('#editor-form').inert=false;button.disabled=false;button.textContent='提交到 GitHub';}
});
$('#delete').addEventListener('click',async()=>{if(saving||!current?.sha||!confirm(`確定刪除「${current.filename}」？操作會提交一筆 Git commit，可從 Git 歷史復原。`))return;saving=true;$('#editor-form').inert=true;try{await api(`content?collection=${collection}&file=${encodeURIComponent(current.filename)}`,{method:'DELETE',body:JSON.stringify({sha:current.sha,confirm:true})});setDirty(false);await loadCollection(collection);showMessage($('#app-message'),'已提交刪除，前台將於建置成功後更新。');}catch(error){showMessage($('#app-message'),error.message,true);}finally{saving=false;$('#editor-form').inert=false;}});
$('#preview').addEventListener('click',async()=>{const area=$('#fields [name=body]');if(!area)return;$('#preview-body').textContent='產生預覽中…';$('#preview-dialog').showModal();try{const result=await api('preview',{method:'POST',body:JSON.stringify({body:area.value})});$('#preview-body').innerHTML=result.html;}catch(error){$('#preview-body').textContent=error.message;}});
$('#close-preview').addEventListener('click',()=>$('#preview-dialog').close());
async function uploadImage(input) {
  const file=input.files?.[0];if(!file||saving)return;if(file.size>2*1024*1024){showMessage($('#app-message'),'圖片上限為 2 MB。',true);return;}
  saving=true;$('#editor-form').inert=true;input.disabled=true;
  try{const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const result=await api('uploads',{method:'POST',body:JSON.stringify({content})});const area=$('#fields [name=body]');area.setRangeText(`\n![請填寫圖片描述](${result.path})\n`,area.selectionStart,area.selectionEnd,'end');setDirty(true);showMessage($('#app-message'),'圖片已提交。補上描述並提交文章；圖片會在部署後可見。',false,result.commit);}catch(error){showMessage($('#app-message'),error.message,true);}finally{saving=false;$('#editor-form').inert=false;input.disabled=false;input.value='';}
}
async function deployments() {
  try{const result=await api('deployments');$('#deployments').replaceChildren();for(const run of result.runs){const link=document.createElement('a');link.href=run.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`${run.sha.slice(0,7)} · ${run.conclusion==='success'?'部署成功':run.conclusion==='failure'?'建置失敗':run.status==='completed'?run.conclusion:'部署處理中'} ↗`;$('#deployments').append(link);}}catch{$('#deployments').textContent='無法讀取部署狀態，可使用側欄連結直接到 GitHub 查看。';}
}
$('#refresh-deployments').addEventListener('click',deployments);
window.addEventListener('beforeunload',event=>{if(dirty)event.preventDefault();});
start();
