(() => {
 'use strict';
 const $=(q,root=document)=>root.querySelector(q), $$=(q,root=document)=>[...root.querySelectorAll(q)];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const rubWhole=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}),rubCents=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:2,maximumFractionDigits:2});
 const plainWhole=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}),plainCents=new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
 const money=v=>(v%100?rubCents:rubWhole).format(v/100);
 const number=v=>(v%100?plainCents:plainWhole).format(v/100);
 const monthName=m=>new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(m+'-02T12:00:00')).replace(' г.','');
 const inputMoney=v=>v===null||v===undefined?'':(v/100).toFixed(v%100?2:0).replace('.',',');
 const dateLabel=r=>r.date?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(new Date(r.date+'T12:00:00')):'День не указан';
 const icons={budget:'<path d="M4 5h16v15H4zM4 10h16M9 10v10M14 14h3M14 17h3"/>',entries:'<path d="M7 4h10v16H7zM10 8h4M10 12h4M10 16h3M4 7H2v13h12"/>',categories:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',settings:'<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',plus:'<path d="M12 5v14M5 12h14"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-2l3 4M4 15l3 4a7 7 0 0 0 11-2"/>',edit:'<path d="m15 4 5 5-11 11H4v-5zM12 7l5 5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',out:'<path d="M10 4H4v16h6M13 8l4 4-4 4M8 12h13"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'};
 const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]||icons.edit}</svg>`;
 const btn=(action,label,cls='',data='')=>`<button type="button" data-action="${action}" class="${cls}" ${data}>${label}</button>`;
 const iconBtn=(action,label,n,data='')=>btn(action,icon(n),'icon',`aria-label="${esc(label)}" title="${esc(label)}" ${data}`);
 const brand=()=>'<div class="brand"><img src="./icon.svg" width="42" height="42" alt=""><div translate="no">Семейный план<small>Общий бюджет для двоих</small></div></div>';
 const cacheKey='family:cache:v1', pendingKey='family:pending:v1';
 let setupKey='';if(location.hash.startsWith('#setup=')){setupKey=decodeURIComponent(location.hash.slice(7));history.replaceState(null,'',location.pathname+location.search);}
 const route=location.hash.slice(1).split('/');
 const state={user:null,budget:null,summary:{},revision:0,section:['budget','entries','categories','settings'].includes(route[0])?route[0]:'budget',month:/^20\d\d-(0[1-9]|1[0-2])$/.test(route[1]||'')?route[1]:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}).slice(0,7),offline:false,stale:false,savedAt:null,query:'',kind:'all',cat:'',limit:30,historyLimit:30,showArchived:false,pending:null,refreshing:false,localError:''};
 let csrf='',modalMeta=null,noticeTimer,readSequence=0,refreshPromise=null;
 class ApiError extends Error {constructor(message,status=0,details={}){super(message);this.status=status;this.details=details;}}
 class FieldError extends Error {constructor(name,message){super(message);this.field=name;}}
 async function api(action,body){
  if(body!==undefined&&!csrf)await api('session');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch('./api.php?action='+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
   let data;try{data=await response.json();}catch{throw new ApiError('Сервер прислал неполный ответ. Повторите запрос.',response.status>=500?response.status:0);}
   if(data.csrf)csrf=data.csrf;
   if(!response.ok)throw new ApiError(data.error||'Не удалось выполнить действие.',response.status,data);
   return data;
  }catch(e){if(e instanceof ApiError)throw e;throw new ApiError('Ответ сервера не получен. Проверьте интернет и повторите действие.');}
  finally{clearTimeout(timer);}
 }
 function storageRead(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
 function writeCache(){
  try{localStorage.setItem(cacheKey,JSON.stringify({user:state.user,budget:state.budget,summary:state.summary,revision:state.revision,savedAt:state.savedAt}));state.localError='';}
  catch{state.localError='Браузер не сохранил офлайн-копию. Данные на сервере доступны; освободите место в хранилище сайта.';}
 }
 function draftKey(){return 'family:draft:'+state.user.id;}
 function draft(){return state.user?storageRead(draftKey()):null;}
 function saveDraft(data){
  const saved={...data,kind:'expense',savedAt:new Date().toISOString()};
  try{localStorage.setItem(draftKey(),JSON.stringify(saved));return true;}catch{throw new Error('Не удалось сохранить черновик на устройстве. Освободите место; ввод пока остаётся в форме.');}
 }
 function cacheLoad(){const c=storageRead(cacheKey);if(c?.budget&&c.user){Object.assign(state,c);state.offline=true;state.stale=true;const p=storageRead(pendingKey);if(p?.userId===c.user.id)state.pending=p;return true;}return false;}
 function notify(text){clearTimeout(noticeTimer);const n=$('#notice');n.textContent=text;n.hidden=false;noticeTimer=setTimeout(()=>n.hidden=true,6500);}
 function field(name,label,value='',type='text',options={}){
  const id='f-'+name,help=options.help?`<small class="help" id="${id}-help">${esc(options.help)}</small>`:'';
  let control;
  if(type==='select')control=`<select id="${id}" name="${name}" ${options.disabled?'disabled':''}>${(options.items||[]).map(o=>`<option value="${esc(o[0])}" ${String(value)===String(o[0])?'selected':''}>${esc(o[1])}</option>`).join('')}</select>`;
  else if(type==='textarea')control=`<textarea id="${id}" name="${name}" maxlength="500" rows="3">${esc(value)}</textarea>`;
  else control=`<input id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${options.attrs||''} autocomplete="${options.autocomplete||'off'}" ${type==='password'?'spellcheck="false"':''}>`;
  if(type==='password')control=`<div class="password-wrap">${control}${iconBtn('toggle-password','Показать пароль','eye',`data-field="${id}" aria-pressed="false"`)}</div>`;
  return `<div class="field ${options.full?'full':''}"><label for="${id}">${esc(label)}</label>${control}${help}<span id="${id}-error" class="error" hidden></span></div>`;
 }
 const checkbox=(name,label,checked=false)=>`<label class="checkbox"><input type="checkbox" name="${name}" ${checked?'checked':''}><span>${esc(label)}</span></label>`;
 function formError(form,error){
  const box=$('.form-error',form);box.textContent=error.message;box.hidden=false;
  if(error.field){const el=form.elements.namedItem(error.field);if(el){el.setAttribute('aria-invalid','true');const id=el.id+'-error',msg=$('#'+id);if(msg){msg.textContent=error.message;msg.hidden=false;el.setAttribute('aria-describedby',id);}el.focus();}}
  else{box.tabIndex=-1;box.focus();}
  if(error.status===401&&state.user){box.append(document.createTextNode(' '));const b=document.createElement('button');b.type='button';b.textContent='Войти снова';b.dataset.action='reauth';box.append(b);}
  if(error.details?.conflict){const b=document.createElement('button');b.type='button';b.textContent='Загрузить актуальный бюджет';b.dataset.action='resolve-conflict';box.append(b);}
  if(error.status===403){const b=document.createElement('button');b.type='button';b.textContent='Обновить сессию';b.dataset.action='refresh-session';box.append(b);}
  if(state.pending&&(error.status===0||error.status>=500)){const b=document.createElement('button');b.type='button';b.textContent='Проверить сохранение';b.dataset.action='retry-pending';box.append(b);}
 }
 function parseAmount(v,name='amount',allowNegative=false,optional=false){
  v=String(v??'').replace(/[\s\u00a0\u202f]/g,'');if(!v&&optional)return null;
  if(!(allowNegative?/^-?\d+(?:[,.]\d{1,2})?$/:/^\d+(?:[,.]\d{1,2})?$/).test(v))throw new FieldError(name,'Введите сумму цифрами, максимум две цифры после запятой.');
  const negative=v.startsWith('-');const parts=v.replace('-','').replace(',','.').split('.');const result=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));
  if(!Number.isSafeInteger(result)||result>100000000000)throw new FieldError(name,'Сумма должна быть не больше миллиарда рублей.');return negative?-result:result;
 }
 function values(form){return Object.fromEntries(new FormData(form));}
 async function runForm(form,handler){
  if(form.dataset.busy)return;form.dataset.busy='true';form.setAttribute('aria-busy','true');const submit=$('button[type=submit]',form);if(submit){submit.disabled=true;submit.setAttribute('aria-busy','true');}
  const err=$('.form-error',form);if(err){err.textContent='';err.hidden=true;}
  try{await handler(values(form),form);}catch(e){formError(form,e);}
  finally{delete form.dataset.busy;form.removeAttribute('aria-busy');if(submit){submit.disabled=false;submit.removeAttribute('aria-busy');}}
 }
 function bindForm(form,handler){form.noValidate=true;form.addEventListener('submit',e=>{e.preventDefault();runForm(form,handler);});form.addEventListener('input',e=>{if(e.target.name){e.target.removeAttribute('aria-invalid');const error=$('#'+e.target.id+'-error');if(error)error.hidden=true;}if(e.target.tagName==='TEXTAREA'){e.target.style.height='auto';e.target.style.height=e.target.scrollHeight+'px';}});}
 function openDialog(title,body,onSubmit=null,{submit='Сохранить на сервере',danger=false,dirty=true,entry=false}={}){
  const active=document.activeElement,opener=modalMeta?.opener||{action:active?.dataset.action,id:active?.dataset.id,cat:active?.dataset.cat};
  const modal=$('#modal');if(modal.open)modal.close();
  modal.innerHTML=`<form novalidate><div class="dialog-head"><h2 id="modal-title">${esc(title)}</h2>${iconBtn('close-modal','Закрыть','close')}</div><div class="dialog-body"><div class="form-error" role="alert" hidden></div>${body}</div><div class="dialog-actions">${btn('close-modal','Отмена')}${onSubmit?`<button type="submit" class="primary ${danger?'danger':''}">${esc(submit)}</button>`:''}</div></form>`;
  modalMeta={initial:JSON.stringify(values($('form',modal))),dirty,entry,onSubmit,revision:state.revision,opener};modal.showModal();
  if(onSubmit)bindForm($('form',modal),onSubmit);
  if(danger)$('[data-action=close-modal]',modal)?.focus();
 }
 function closeModal(force=false){
  const modal=$('#modal');if(!modal.open)return;if($('form',modal)?.dataset.busy){notify('Дождитесь ответа сервера.');return;}
  const changed=modalMeta?.dirty&&JSON.stringify(values($('form',modal)))!==modalMeta.initial;
  if(!force&&changed){
   const g=$('#guard');g.innerHTML=`<div class="dialog-head"><h2 id="guard-title">Сохранить введённое?</h2></div><div class="dialog-body"><p>В форме есть изменения.</p>${modalMeta.entry?'<p class="muted">Новый расход можно оставить черновиком на этом устройстве.</p>':''}</div><div class="dialog-actions">${btn('guard-keep','Продолжить ввод')}${modalMeta.entry?btn('guard-draft','Сохранить черновик'):''}${btn('guard-discard','Закрыть без сохранения','danger')}</div>`;g.showModal();return;
  }
  const meta=modalMeta;modal.close();modal.innerHTML='';modalMeta=null;queueMicrotask(()=>focusBack(meta));
 }
 function focusBack(meta){const o=meta?.opener;let target;if(o?.action){let selector=`[data-action="${CSS.escape(o.action)}"]`;if(o.id)selector+=`[data-id="${CSS.escape(o.id)}"]`;if(o.cat)selector+=`[data-cat="${CSS.escape(o.cat)}"]`;target=$(selector,$('#app'));} (target||$('#page-title'))?.focus();}
 async function refresh({quiet=false}={}){
  if(refreshPromise)return refreshPromise;
  const seq=++readSequence;state.refreshing=true;if(!quiet&&state.budget)render();
  refreshPromise=(async()=>{
   try{const data=await api('state');if(seq!==readSequence||data.revision<state.revision)return;
    Object.assign(state,data,{savedAt:new Date().toISOString(),offline:false,stale:false});writeCache();
   }catch(e){state.stale=true;state.offline=e.status===0;if(e.status===401){notify('Вход истёк. Сохранённый бюджет доступен для просмотра.');}else if(!quiet)notify(e.message);}
   finally{state.refreshing=false;refreshPromise=null;if(state.budget)render();}
  })();return refreshPromise;
 }
 async function saveCommand(command,{revision=modalMeta?.revision??state.revision}={}){
  if(state.offline)throw new ApiError('Сейчас нет связи с сервером. Сохраните расход как черновик на устройстве.');
  const signature=JSON.stringify(command);let pending=state.pending;
  if(pending&&JSON.stringify(pending.command)!==signature)throw new Error('Сначала проверьте предыдущее сохранение кнопкой в верхнем уведомлении.');
  pending??={userId:state.user.id,requestId:crypto.randomUUID(),revision,command};
  try{localStorage.setItem(pendingKey,JSON.stringify(pending));}catch{throw new Error('Браузер не разрешает сохранить ключ отправки. Освободите место в хранилище сайта и повторите.');}
  state.pending=pending;
  try{
   const result=await api('mutate',{revision:pending.revision,requestId:pending.requestId,command:pending.command});
   state.pending=null;localStorage.removeItem(pendingKey);
   if(command.type==='saveEntry'&&!command.data.id&&command.data.localId&&draft()?.localId===command.data.localId)localStorage.removeItem(draftKey());
   await refresh({quiet:true});if(state.revision<result.revision)await refresh({quiet:true});return result;
  }catch(e){if(e.status>=400&&e.status<500&&e.status!==401){state.pending=null;localStorage.removeItem(pendingKey);}else{state.stale=true;render();}throw e;}
 }
 function navigate(section){state.section=section;history.pushState(null,'','#'+section+'/'+state.month);render();window.scrollTo(0,0);$('#page-title')?.focus();}
 function changeMonth(m){if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(m))return;state.month=m;state.limit=30;history.replaceState(null,'','#'+state.section+'/'+m);render();}
 const categories=(kind=null,archived=false)=>Object.values(state.budget.categories).filter(c=>(!kind||c.kind===kind)&&(archived||!c.archived)).sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'ru'));
 let monthlyBudget=null,monthlyMonth='',monthlyRows=[],monthlyFacts={};
 function entries(){if(monthlyBudget!==state.budget||monthlyMonth!==state.month){monthlyBudget=state.budget;monthlyMonth=state.month;monthlyRows=Object.values(state.budget.entries).filter(e=>e.month===state.month).sort((a,b)=>(b.date||b.month+'-00').localeCompare(a.date||a.month+'-00')||(b.updatedAt||'').localeCompare(a.updatedAt||''));monthlyFacts={};for(const e of monthlyRows)monthlyFacts[e.categoryId]=(monthlyFacts[e.categoryId]||0)+e.amount;}return monthlyRows;}
 const defaultSummary=()=>({income:0,expense:0,plannedIncome:0,plannedExpense:0,available:null,difference:0,incomeComplete:false,openingBalance:null});
 function entryRow(e,recent=false){const c=state.budget.categories[e.categoryId];return `<li class="entry"><div class="entry-main"><div class="entry-title">${esc(e.description||c.name)}</div><div class="entry-sub">${esc(e.description?c.name+' · ':'')}${esc(dateLabel(e))}${c.archived?' · В архиве':''}</div></div><span class="entry-amount num ${c.kind==='income'?'positive':''}">${c.kind==='income'?'+':''}${money(e.amount)}</span>${iconBtn('edit-entry','Изменить '+(c.kind==='income'?'доход':'расход')+' '+(e.description||c.name),'edit',`data-id="${e.id}" ${state.offline?'disabled':''}`)}</li>`;}
 function planTable(kind){
  entries();const cats=categories(kind,true).filter(c=>state.budget.plans[state.month+'_'+c.id]||monthlyFacts[c.id]!==undefined);
  if(!cats.length)return `<p class="hint">${kind==='income'?'Доходы пока не запланированы. Добавьте строку плана, когда определите сумму.':'За этот месяц нет строк плана и расходов. Добавьте план по нужным категориям.'}</p>${btn(kind==='income'?'add-income-plan':'add-plan','Добавить строку плана','link',state.offline?'disabled':'')}`;
  return `<table class="budget-table"><caption class="sr-only">${kind==='expense'?'Расходы':'Доходы'}: план и факт за ${esc(monthName(state.month))}</caption><thead><tr><th scope="col">Категория</th><th scope="col">План, ₽</th><th scope="col">${kind==='expense'?'Потрачено':'Получено'}, ₽</th><th scope="col">${kind==='expense'?'Осталось':'До плана'}, ₽</th></tr></thead><tbody>${cats.map(c=>{
   const p=state.budget.plans[state.month+'_'+c.id],fact=monthlyFacts[c.id]||0,left=p?p.amount-fact:null;
   return `<tr><td>${esc(c.name)}${c.archived?'<small> · архив</small>':''}</td><td data-label="План, ₽">${btn('edit-plan',p?number(p.amount):'Указать','plan-button num',`data-cat="${c.id}" aria-label="${esc(p?number(p.amount):'Указать')}, план: ${esc(c.name)}" ${state.offline?'disabled':''}`)}</td><td class="num" data-label="${kind==='expense'?'Потрачено':'Получено'}, ₽">${number(fact)}</td><td data-label="${kind==='expense'?'Осталось':'До плана'}, ₽" class="num ${kind==='expense'&&left!==null&&left<0?'negative':''}">${left===null?'—':number(left)}${kind==='expense'&&left!==null&&left<0?'<span class="overrun">Перерасход</span>':''}</td></tr>`;
  }).join('')}</tbody></table>`;
 }
 function budgetScreen(){
  if(!Object.keys(state.budget.categories).length)return `<section class="panel intro"><img class="intro-mark" src="./icon.svg" width="64" height="64" alt=""><h2>Начнём с вашего бюджета</h2><p>Создайте категории доходов и расходов, затем запланируйте суммы месяца. Если бюджет уже сохранён в JSON, восстановите его из своей копии.</p><div class="toolbar">${btn('new-category','Создать категории вручную','primary')}${btn('restore','Восстановить JSON')}</div><p class="hint">Бюджет общий для двух участников. Фактические операции и планы учитываются отдельно.</p></section>`;
  const s=state.summary[state.month]||defaultSummary(),hasPlan=Object.values(state.budget.plans).some(p=>p.month===state.month&&state.budget.categories[p.categoryId].kind==='expense'),left=s.plannedExpense-s.expense;
  const unplanned=entries().filter(e=>state.budget.categories[e.categoryId].kind==='expense'&&!state.budget.plans[state.month+'_'+e.categoryId]).reduce((sum,e)=>sum+e.amount,0);
  return `<div class="overview-grid"><div><section class="balance"><p class="eyebrow">${hasPlan?(left<0?'Перерасход по плану месяца':'Осталось по плану расходов'):'План расходов ещё не задан'}</p><div class="figure num ${hasPlan&&left<0?'negative':''}">${hasPlan?money(left):'—'}</div><div class="balance-meta"><span>План<strong class="num">${hasPlan?money(s.plannedExpense):'—'}</strong></span><span>Потрачено<strong class="num">${money(s.expense)}</strong></span></div><p class="explanation">${hasPlan?'План минус все фактические расходы.':'Укажите суммы по категориям, чтобы видеть остаток.'}${unplanned?' Без заданного плана потрачено '+money(unplanned)+'.':''} Это остаток плана, а не денег на счетах.</p></section><section class="panel"><div class="panel-head"><h2>Расходы по категориям</h2>${iconBtn('add-plan','Добавить строку плана','plus',state.offline?'disabled':'')}</div>${planTable('expense')}<p class="table-note">Нажмите сумму в столбце «План», чтобы её изменить. «—» означает, что план не указан.</p></section><section class="panel section-gap"><div class="panel-head"><h2>План доходов</h2></div>${planTable('income')}</section></div><aside class="stack"><section class="panel"><h2>Деньги за месяц</h2><div class="stat-line"><span>Получено</span><strong class="num positive">${money(s.income)}</strong></div><div class="stat-line"><span>Потрачено</span><strong class="num">${money(s.expense)}</strong></div><div class="divider"></div><p class="muted">${s.available===null?'Разница доходов и расходов':'Остаток с начала месяца'}</p><div class="aside-number num ${s.available!==null&&s.available<0?'negative':''}">${money(s.available??s.difference)}</div>${s.available===null?'<p class="hint">Остаток денег не определён: укажите начальную сумму и подтвердите, что все доходы внесены.</p>':'<p class="hint">Начальная сумма + доходы − расходы.</p>'}${btn('month-settings','Настроить остаток','link',state.offline?'disabled':'')}</section><section class="panel recent"><div class="panel-head"><h2>Последние операции</h2></div>${entries().length?`<ul class="list">${entries().slice(0,4).map(e=>entryRow(e,true)).join('')}</ul>${btn('all-entries','Все операции','link')}`:'<p class="hint">За этот месяц операций пока нет.</p>'}</section><section class="panel"><h2>План следующего месяца</h2><p class="hint">Перенесите только план. Фактические операции останутся в своём месяце.</p>${btn('copy-plan','Скопировать план','link',state.offline?'disabled':'')}</section></aside></div>`;
 }
 function entriesScreen(){
  const all=entries(),filtered=all.filter(e=>(state.kind==='all'||state.budget.categories[e.categoryId].kind===state.kind)&&(!state.cat||e.categoryId===state.cat)&&(!state.query||(e.description+' '+state.budget.categories[e.categoryId].name+' '+e.sourceRef).toLocaleLowerCase('ru').includes(state.query.toLocaleLowerCase('ru'))));
  return `<section class="panel"><div class="filters"><div class="search"><label for="search">Поиск по комментарию или категории</label><input type="search" id="search" value="${esc(state.query)}" placeholder="Например, продукты…" name="search" autocomplete="off">${state.query?iconBtn('clear-search','Очистить поиск','close'):''}</div><div class="filter-field"><label for="kind-filter">Тип</label><select id="kind-filter">${[['all','Все операции'],['expense','Расходы'],['income','Доходы']].map(([v,l])=>`<option value="${v}" ${v===state.kind?'selected':''}>${l}</option>`).join('')}</select></div><div class="filter-field"><label for="cat-filter">Категория</label><select id="cat-filter"><option value="">Все категории</option>${categories(null,true).map(c=>`<option value="${c.id}" ${state.cat===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div></div>${filtered.length?`<ul class="list">${filtered.slice(0,state.limit).map(e=>entryRow(e)).join('')}</ul><p class="result-count">Показано ${Math.min(filtered.length,state.limit)} из ${filtered.length} · ${money(filtered.reduce((s,e)=>s+(state.budget.categories[e.categoryId].kind==='income'?e.amount:-e.amount),0))} суммарно</p>${filtered.length>state.limit?btn('more-entries','Показать ещё 30','load-more'):''}`:`<div class="empty"><h2>${all.length?'Ничего не найдено':'Операций пока нет'}</h2><p>${all.length?'Измените поиск или сбросьте фильтры.':'Добавьте фактический доход или расход за выбранный месяц.'}</p>${all.length?btn('clear-filters','Сбросить фильтры'):btn('new-entry','Добавить операцию','primary')}</div>`}</section>`;
 }
 function categoriesScreen(){return `<section class="panel"><div class="panel-head"><h2>Ваши категории</h2>${btn('new-category','Добавить категорию','',state.offline?'disabled':'')}</div><p class="hint">Общие для всех месяцев. Архив сохраняет прошлые операции и планы.</p>${checkbox('showArchived','Показывать архивные категории',state.showArchived)}${['expense','income'].map(kind=>`<h3 class="section-gap">${kind==='expense'?'Расходы':'Доходы'}</h3>${categories(kind,state.showArchived).map(c=>`<div class="category-row"><div class="entry-main"><div class="category-name">${esc(c.name)} ${c.archived?'<span class="tag">В архиве</span>':''}</div><small>Порядок: ${c.order}</small></div>${iconBtn('edit-category','Изменить категорию '+c.name,'edit',`data-id="${c.id}" ${state.offline?'disabled':''}`)}</div>`).join('')||'<p class="muted">Категорий пока нет.</p>'}`).join('')}</section>`;}
 const actionNames={saveEntry:'Операция сохранена',deleteEntry:'Операция удалена',savePlan:'План изменён',saveCategory:'Категория изменена',saveMonth:'Настройки месяца изменены',saveTemplate:'Обычная сумма сохранена',deleteTemplate:'Обычная сумма удалена',deletePlan:'Строка плана удалена',copyPlan:'План скопирован',useTemplate:'План заполнен обычными суммами',importSource:'Данные таблицы перенесены',restore:'Бюджет восстановлен из копии',undo:'Изменение отменено'};
 function settingsScreen(){
  const templates=Object.values(state.budget.templates),history=state.budget.history;
  return `<div class="settings-grid"><section class="panel"><h2>Месяц и планирование</h2><div class="settings-row"><div><h3>Начальный остаток</h3><p class="muted">И отметка о полноте доходов за ${esc(monthName(state.month))}.</p></div>${btn('month-settings','Изменить','',state.offline?'disabled':'')}</div><div class="settings-row"><div><h3>Готовый план</h3><p class="muted">Заполнить обычными суммами или скопировать другой месяц.</p></div>${btn('plan-tools','Заполнить','',state.offline?'disabled':'')}</div></section><section class="panel"><h2>Копии и перенос данных</h2><p class="hint">Сохраняйте JSON-копию на своё устройство. Она содержит весь бюджет и историю, без паролей.</p><div class="actions-wrap section-gap">${btn('export','Скачать JSON', '',state.offline?'disabled':'')}${btn('csv','Операции в CSV')}${btn('restore','Восстановить','',state.offline?'disabled':'')}</div></section><section class="panel wide"><div class="panel-head"><h2>Обычные суммы за месяц</h2>${btn('new-template','Добавить','',state.offline?'disabled':'')}</div><p class="hint">Регулярные суммы для планирования, отдельно от фактических операций. «Как надо» — целевые суммы расходов для альтернативного плана.</p>${templates.map(t=>`<div class="template-row"><div><strong>${esc(state.budget.categories[t.categoryId].name)}</strong><small class="muted"> · ${state.budget.categories[t.categoryId].kind==='income'?'доход':'расход'}</small></div><div class="template-amount num">Обычно ${money(t.amount)}${t.targetAmount!==null?`<small>Как надо ${money(t.targetAmount)}</small>`:''}</div>${iconBtn('edit-template','Изменить обычную сумму '+state.budget.categories[t.categoryId].name,'edit',`data-id="${t.id}" ${state.offline?'disabled':''}`)}</div>`).join('')||'<p class="hint">Обычных сумм пока нет.</p>'}</section><section class="panel wide"><h2>История изменений</h2><p class="hint">Отмена доступна, пока эти данные не изменили повторно. Все действия видны обоим пользователям.</p>${[...history].reverse().slice(0,state.historyLimit).map(e=>`<article class="history-item"><div class="history-top"><div><p><strong>${esc(actionNames[e.action]||e.action)}</strong></p><small>${esc(e.user)} · ${esc(new Date(e.at).toLocaleString('ru-RU'))} · ${e.changes.length} изменений</small></div>${btn('undo','Отменить','',`data-id="${e.id}" ${state.offline?'disabled':''}`)}</div><details><summary>Состав изменения</summary>${e.changes.filter(c=>c.collection!=='imports').slice(0,40).map(c=>`<div class="change-line">${esc(c.after?.name||c.before?.name||state.budget.categories[c.after?.categoryId||c.before?.categoryId]?.name||c.id)}: ${c.before?.amount!==undefined?money(c.before.amount):c.before?'изменено':'нет записи'} → ${c.after?.amount!==undefined?money(c.after.amount):c.after?'сохранено':'удалено'}</div>`).join('')}${e.changes.length>40?'<p>Полный состав есть в JSON-копии.</p>':''}</details></article>`).join('')||'<p class="hint">После первого сохранения здесь появится история.</p>'}${history.length>state.historyLimit?btn('more-history','Показать ещё 30','load-more'):''}</section><section class="panel"><h2>Вход и устройство</h2><p>${esc(state.user.name)} · ${esc(state.user.login)}</p><div class="actions-wrap">${btn('password','Изменить пароль','',state.offline?'disabled':'')}${btn('logout','Выйти на этом устройстве','danger')}</div><p class="hint">Выход удалит сохранённый бюджет и черновик с этого устройства.</p></section><section class="panel"><h2>Установить на iPhone</h2><p class="hint">В Safari откройте «Поделиться» → «На экран Домой». После первого входа сохранённый бюджет доступен без интернета. Черновик расхода отправляется вручную при возвращении связи.</p></section></div>`;
 }
 function render(){
  if(!state.user||!state.budget)return;
  const focused=document.activeElement,id=focused?.id,start=focused?.selectionStart,end=focused?.selectionEnd,scroll=window.scrollY;
  const sections={budget:'Бюджет месяца',entries:'Операции',categories:'Категории',settings:'Настройки'};
  document.title=sections[state.section]+' · '+monthName(state.month)+' · Семейный план';
  const saved=state.savedAt?new Date(state.savedAt).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'ещё нет копии';
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar">${brand()}<nav class="navigation" aria-label="Основные разделы">${Object.entries({budget:'Бюджет',entries:'Операции',categories:'Категории',settings:'Настройки'}).map(([n,l])=>`<a href="#${n}/${state.month}" ${state.section===n?'aria-current="page"':''}>${icon(n)}<span>${l}</span></a>`).join('')}</nav><div class="profile"><div class="who">${esc(state.user.name)}</div><small>Один бюджет, два участника</small><div class="signout">${btn('logout',icon('out')+' Выйти','ghost')}</div></div></aside><main id="main" class="workspace"><header class="page-head"><div><h1 id="page-title" tabindex="-1">${sections[state.section]}</h1><p class="muted">Планируем вместе, видим общую картину</p></div><div class="toolbar"><div class="month-control">${iconBtn('prev-month','Предыдущий месяц','left')}<label for="month" class="sr-only">Месяц бюджета</label><input type="month" id="month" value="${state.month}" min="2000-01" max="2099-12">${iconBtn('next-month','Следующий месяц','right')}</div></div></header>${state.offline||state.stale?`<div class="banner"><p><strong>${state.offline?'Без связи · сохранённый бюджет':'Показаны сохранённые данные'}</strong><br>Копия от ${esc(saved)}. Изменения второго пользователя могут быть ещё не загружены.</p>${btn('refresh','Обновить')}</div>`:''}${state.localError?`<div class="banner error"><p>${esc(state.localError)}</p></div>`:''}${state.pending?`<div class="banner error"><p>Предыдущее сохранение ещё не подтверждено. Безопасный повтор не создаст дубликат.</p>${btn('retry-pending','Проверить сохранение')}</div>`:''}${draft()?`<div class="banner"><p>На этом устройстве есть черновик расхода. Он ещё не включён в общий бюджет.</p>${btn('open-draft','Открыть черновик')}</div>`:''}<div class="page-actions">${btn('new-entry',icon('plus')+' Добавить операцию','primary')}${iconBtn('refresh',state.refreshing?'Обновляем бюджет':'Обновить бюджет','refresh',state.refreshing?'disabled aria-busy="true"':'')}<span class="sync">${state.refreshing?'Обновляем…':state.offline?'Офлайн-копия от '+esc(saved):'Сервер · '+esc(saved)}</span></div>${({budget:budgetScreen,entries:entriesScreen,categories:categoriesScreen,settings:settingsScreen}[state.section])()}</main></div>`;
  if(id){const el=document.getElementById(id);if(el&&$('#app').contains(el)){el.focus({preventScroll:true});try{if(start!==null)el.setSelectionRange(start,end);}catch{}}}window.scrollTo(0,scroll);
  if(modalMeta?.entry&&$('#modal').open){const submit=$('#modal button[type=submit]');if(submit)submit.textContent=state.offline?'Сохранить черновик':'Сохранить на сервере';}
 }
 async function acceptLogin(data){
  const cached=storageRead(cacheKey);if(cached&&cached.user.id!==data.user.id){localStorage.removeItem(cacheKey);localStorage.removeItem(pendingKey);localStorage.removeItem('family:draft:'+cached.user.id);state.budget=null;}
  state.user=data.user;state.pending=storageRead(pendingKey);if(state.pending?.userId!==state.user.id)state.pending=null;
  const result=await api('state');Object.assign(state,result,{savedAt:new Date().toISOString(),offline:false,stale:false});writeCache();render();
 }
 function renderLogin(recovery=false){
  document.title='Вход · Семейный план';$('#app').innerHTML=`<main id="main" class="auth">${brand()}<h1>${recovery?'Восстановить доступ':'Ваш бюджет, вместе'}</h1><p class="muted">${recovery?'Используйте личный одноразовый код, сохранённый при настройке.':'Войдите в общий бюджет своим логином.'}</p><section class="panel"><form id="auth-form" novalidate><div class="form-error" role="alert" hidden></div>${field('login','Логин','','text',{autocomplete:'username',attrs:'autocapitalize="none" spellcheck="false" maxlength="40"'})}${recovery?field('code','Код восстановления','','password',{autocomplete:'off'})+field('newPassword','Новый пароль','','password',{autocomplete:'new-password',help:'От 12 латинских символов, максимум 72 байта.'}):field('password','Пароль','','password',{autocomplete:'current-password'})}<button type="submit" class="primary">${recovery?'Восстановить вход':'Войти'}</button></form>${btn(recovery?'login-screen':'recover-screen',recovery?'Вернуться ко входу':'Не получается войти?','link')}</section><p class="auth-note">Каждый использует свой вход. Данные бюджета общие.</p></main>`;
  bindForm($('#auth-form'),async v=>{if(localStorage.getItem('family:logoutPending')){await api('session');await api('logout',{});localStorage.removeItem('family:logoutPending');await api('session');}const data=await api(recovery?'recover':'login',v);await acceptLogin(data);if(data.recoveryCodes)showCodes(data.recoveryCodes,false);});
 }
 function renderSetup(){
  document.title='Настройка · Семейный план';$('#app').innerHTML=`<main id="main" class="auth wide-auth">${brand()}<h1>Два входа — один бюджет</h1><p class="muted">Настройка выполняется один раз. У обоих участников одинаковые права.</p><section class="panel"><form id="setup-form" novalidate><div class="form-error" role="alert" hidden></div>${setupKey?'':field('installKey','Ключ первоначальной настройки','','password',{help:'Ключ находится в закрытом файле настройки сервера.'})}<div class="form-grid">${[1,2].map(n=>`<div class="user-fields"><h2>Участник ${n}</h2>${field('name'+n,'Имя '+n,'','text',{autocomplete:'name',attrs:'maxlength="50"'})}${field('login'+n,'Логин '+n,'','text',{autocomplete:'username',help:'Латинские буквы, цифры, точка, дефис или _.',attrs:'autocapitalize="none" spellcheck="false" maxlength="40"'})}${field('password'+n,'Пароль '+n,'','password',{autocomplete:'new-password',help:'От 12 латинских символов, максимум 72 байта.'})}</div>`).join('')}</div><button type="submit" class="primary">Создать два входа</button></form></section></main>`;
  bindForm($('#setup-form'),async v=>{const data=await api('setup',{installKey:setupKey||v.installKey,users:[1,2].map(n=>({name:v['name'+n],login:v['login'+n],password:v['password'+n]}))});setupKey='';showCodes(data.recoveryCodes,true);});
 }
 function showCodes(codes,initial=false){
  const body=`<p>Сохраните каждый код отдельно. Он даёт владельцу логина возможность заменить пароль без почты и SMS. Код используется один раз; после восстановления выдаётся новый.</p>${codes.map(c=>`<div class="code"><strong>${esc(c.login)}</strong><code>${esc(c.code)}</code></div>`).join('')}<p class="hint">Коды показаны только сейчас. В резервную копию бюджета они не входят.</p>`;
  if(initial){$('#app').innerHTML=`<main id="main" class="auth">${brand()}<h1>Сохраните коды восстановления</h1><section class="panel">${body}${btn('setup-finished','Коды сохранены, перейти ко входу','primary')}</section></main>`;}
  else openDialog('Новый код восстановления',body,null,{dirty:false});
 }
 async function start(){
  const cached=cacheLoad();
  try{let s=await api('session');if(localStorage.getItem('family:logoutPending')){await api('logout',{});localStorage.removeItem('family:logoutPending');s=await api('session');}if(s.needsSetup){state.user=null;renderSetup();}else if(s.user){state.user=s.user;await acceptLogin(s);}else{state.user=null;renderLogin();}}
  catch(e){if(cached)render();else $('#app').innerHTML=`<main id="main" class="auth">${brand()}<h1>Не удалось открыть бюджет</h1><p>${esc(e.message)}</p><p class="muted">На этом устройстве ещё нет сохранённой копии.</p>${btn('restart','Попробовать снова','primary')}</main>`;}
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
 }
 function finishModal(){const meta=modalMeta;$('#modal').close();$('#modal').innerHTML='';modalMeta=null;queueMicrotask(()=>focusBack(meta));}
 async function saved(command,options={}){const result=await saveCommand(command);finishModal();render();notify(options.message||'Сохранено на сервере');return result;}
 function entryDialog(id=null,fromDraft=false){
  const existing=id?state.budget.entries[id]:null,d=fromDraft?draft():null;
  if(!existing&&!d&&draft()){openDialog('Уже есть черновик расхода','<p>На этом устройстве сохранён один черновик. Откройте его, отправьте или удалите перед новым расходом.</p>'+btn('open-draft','Открыть черновик'),null,{dirty:false});return;}
  const r=existing||d||{month:state.month,date:null,amount:null,description:''},kind=existing?state.budget.categories[r.categoryId].kind:'expense';
  const cats=categories(kind,true).filter(c=>!c.archived||c.id===r.categoryId),selected=cats.some(c=>c.id===r.categoryId)?r.categoryId:(cats[0]?.id||'');
  const body=`${state.offline?'<p class="hint">Без интернета можно сохранить только черновик нового расхода на этом устройстве. Общий бюджет не изменится.</p>':''}<div class="form-grid">${field('kind','Тип операции',kind,'select',{items:[['expense','Расход'],...(!state.offline?[['income','Доход']]:[])]})}${field('month','Месяц',r.month,'month',{attrs:'min="2000-01" max="2099-12"'})}${field('categoryId','Категория',selected,'select',{items:cats.map(c=>[c.id,c.name])})}${field('amount','Сумма, ₽',typeof r.amount==='string'?r.amount:inputMoney(r.amount),'text',{attrs:'inputmode="decimal" autocomplete="off" maxlength="20"'})}${field('date','Дата (необязательно)',r.date||'','date',{help:'Без даты операция сохранится только с месяцем.'})}${field('description','Комментарий',r.description,'textarea',{full:true})}</div>${r.sourceRef?`<p class="hint">Источник: ${esc(r.sourceRef)}. Дата и автор исходной записи не выдумывались.</p>`:''}${!existing?`<p class="hint" id="draft-status">${d?'Черновик сохранён только на этом устройстве.':'Новый расход можно сохранить как локальный черновик.'}</p><div class="actions-wrap">${btn('save-draft','Сохранить черновик')}${d?btn('delete-draft','Удалить черновик','danger'):''}</div>`:`<div class="divider"></div>${btn('delete-entry','Удалить операцию','danger',`data-id="${id}"`)}`}`;
  openDialog(existing?'Изменить операцию':fromDraft?'Черновик расхода':'Новая операция',body,async(v)=>{
   const data={...v,date:v.date||null,amount:parseAmount(v.amount),...(id?{id}:{})};delete data.kind;
   if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(v.month))throw new FieldError('month','Выберите месяц в пределах 2000–2099 годов.');
   if(v.date&&v.date.slice(0,7)!==v.month)throw new FieldError('date','Дата должна относиться к выбранному месяцу.');
   if(data.amount===0)throw new FieldError('amount','Сумма операции должна быть больше нуля.');
   if(!v.categoryId)throw new FieldError('categoryId','Сначала добавьте категорию.');
   if(state.offline){if(existing||v.kind!=='expense')throw new Error('Офлайн доступен только новый расход.');saveDraft(v);finishModal();render();notify('Черновик сохранён на этом устройстве');return;}
   await saved({type:'saveEntry',data},{clearDraft:fromDraft||(!existing&&draft()!==null)});
  },{submit:state.offline?'Сохранить черновик':'Сохранить на сервере',entry:!existing});
  modalMeta.record=existing?{collection:'entries',id}:null;
  modalMeta.draftBefore=d||null;
  if(!existing){const hidden=document.createElement('input');hidden.type='hidden';hidden.name='localId';hidden.value=d?.localId||crypto.randomUUID();$('#modal form').append(hidden);modalMeta.initial=JSON.stringify(values($('#modal form')));}
  const form=$('#modal form');form.addEventListener('change',e=>{if(e.target.name==='kind'){
   const cat=form.elements.categoryId;cat.innerHTML=categories(e.target.value).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }});
  if(!existing)form.addEventListener('input',()=>{if(form.elements.kind.value!=='expense')return;try{saveDraft(values(form));$('#draft-status').textContent='Черновик сохранён только на этом устройстве.';}catch(e){$('#draft-status').textContent=e.message;}});
 }
 function categoryDialog(id=null){
  const c=id?state.budget.categories[id]:{name:'',kind:'expense',order:categories(null,true).length,archived:false};
  openDialog(id?'Изменить категорию':'Новая категория',field('name','Название категории',c.name,'text',{attrs:'maxlength="70"'})+field('kind','Тип категории',c.kind,'select',{items:[['expense','Расход'],['income','Доход']]})+field('order','Порядок в списке',c.order,'number',{attrs:'min="0" max="10000" step="1"',help:'Меньшее число — выше в списке.'})+checkbox('archived','Убрать категорию в архив',c.archived)+'<p class="hint">Архив сохраняет операции и планы всех месяцев. Тип категории с данными менять нельзя.</p>',async(v)=>{
   const order=Number(v.order);if(!Number.isInteger(order)||order<0||order>10000)throw new FieldError('order','Введите целое число от 0 до 10000.');
   await saved({type:'saveCategory',data:{...v,order,archived:!!v.archived,...(id?{id}:{})}});
  });modalMeta.record=id?{collection:'categories',id}:null;
 }
 function planDialog(catId=null,kind=null){
  const cats=categories(kind,true).filter(c=>!c.archived||state.budget.plans[state.month+'_'+c.id]);catId??=cats[0]?.id||'';
  const p=state.budget.plans[state.month+'_'+catId];
  openDialog('План по категории',field('month','Месяц',state.month,'month',{attrs:'min="2000-01" max="2099-12"'})+field('categoryId','Категория',catId,'select',{items:cats.map(c=>[c.id,c.name+(c.kind==='income'?' · доход':'')])})+field('amount','План, ₽',inputMoney(p?.amount),'text',{attrs:'inputmode="decimal" maxlength="20"',help:'Ноль — осознанный нулевой план. Незаданный план показывается знаком «—».'})+(p?btn('delete-plan','Убрать план для этой категории','danger',`data-id="${p.id}"`):''),v=>saved({type:'savePlan',data:{...v,amount:parseAmount(v.amount)}}));
  $('#modal form').addEventListener('change',e=>{if(['categoryId','month'].includes(e.target.name)){const form=$('#modal form'),p=state.budget.plans[form.elements.month.value+'_'+form.elements.categoryId.value];form.elements.amount.value=inputMoney(p?.amount);}});
 }
 function monthDialog(){
  const m=state.budget.months[state.month]||{openingBalance:null,incomeComplete:false};
  openDialog('Остаток на начало месяца',`<p class="muted">${esc(monthName(state.month))}</p>`+field('openingBalance','Начальный остаток, ₽',inputMoney(m.openingBalance),'text',{attrs:'inputmode="decimal" maxlength="20"',help:'Можно оставить пустым. Отрицательная сумма допустима.'})+checkbox('incomeComplete','Все фактические доходы за этот месяц внесены',m.incomeComplete)+'<p class="hint">До этой отметки и заполнения начальной суммы приложение показывает только разницу доходов и расходов, без утверждения об остатке денег.</p>',v=>saved({type:'saveMonth',data:{month:state.month,openingBalance:parseAmount(v.openingBalance,'openingBalance',true,true),incomeComplete:!!v.incomeComplete}}));
 }
 function nextMonth(m,delta=1){const d=new Date(m+'-02T12:00:00');d.setMonth(d.getMonth()+delta);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
 function planTools(copy=false){
  openDialog(copy?'Скопировать план':'Заполнить план',field('mode','Источник',copy?'copy':'usual','select',{items:[['usual','Обычные суммы'],['target','Суммы «Как надо»'],['copy','План другого месяца']]})+field('from','Месяц-источник',state.month,'month',{attrs:'min="2000-01" max="2099-12"'})+field('month','Месяц для заполнения',copy?nextMonth(state.month):state.month,'month',{attrs:'min="2000-01" max="2099-12"'})+checkbox('replace','Заменить уже заполненные строки плана')+'<p class="hint">Без отметки заполнится только недостающий план. Доходы и расходы из истории не копируются. Если целевая сумма не указана, используется обычная.</p>',v=>saved({type:v.mode==='copy'?'copyPlan':'useTemplate',data:{month:v.month,from:v.from,target:v.mode==='target',replace:!!v.replace}}),{submit:'Заполнить план'});
 }
 function templateDialog(id=null){
  const r=id?state.budget.templates[id]:{categoryId:categories()[0]?.id||'',amount:null,targetAmount:null,description:''};
  openDialog(id?'Изменить обычную сумму':'Обычная сумма за месяц',field('categoryId','Категория',r.categoryId,'select',{items:categories(null,true).filter(c=>!c.archived||c.id===r.categoryId).map(c=>[c.id,c.name+(c.kind==='income'?' · доход':'')])})+field('amount','Обычно, ₽',inputMoney(r.amount),'text',{attrs:'inputmode="decimal" maxlength="20"'})+field('targetAmount','Как надо, ₽ (необязательно)',inputMoney(r.targetAmount),'text',{attrs:'inputmode="decimal" maxlength="20"'})+field('description','Комментарий',r.description,'textarea')+(id?btn('delete-template','Удалить обычную сумму','danger',`data-id="${id}"`):''),v=>saved({type:'saveTemplate',data:{...v,amount:parseAmount(v.amount),targetAmount:parseAmount(v.targetAmount,'targetAmount',false,true),...(id?{id}:{})}}));
 }
 function confirmCommand(title,text,command,verb='Удалить'){
  openDialog(title,`<p>${esc(text)}</p><p class="hint">Изменение попадёт в историю. Его можно отменить, пока эти данные не изменят повторно.</p>`,()=>saved(command,{message:verb==='Отменить изменение'?'Изменение отменено':'Изменение сохранено'}),{submit:verb,danger:true,dirty:false});
 }
 async function importDialog(){
  notify('Сверяем состав импорта…');const {preview:p,fingerprint}=await api('source');
  const body=`<p>Снимок вашей таблицы от 31 октября 2026 года.</p>${Object.entries(p.months).map(([m,s])=>`<div class="preview-month"><strong>${esc(monthName(m))}</strong><span>${s.count} расходов · ${money(s.expense)}</span><span class="muted">План расходов ${money(s.plannedExpense)}; доходы не указаны.</span></div>`).join('')}<p class="section-gap">${p.entries} операций, ${p.plans} строк плана, ${p.templates} обычных сумм.<br>Новых строк: <strong>${p.added}</strong>; уже перенесены или план заполнен: ${p.skipped}.</p><details><summary>Категории импорта (${p.categories.length})</summary>${["expense","income"].map(kind=>`<p class="hint"><strong>${kind==="expense"?"Расходы":"Доходы"}:</strong> ${p.categories.filter(c=>c.kind===kind).map(c=>esc(c.name)).join("; ")}</p>`).join("")}</details><p class="hint">Обычные суммы: доходы ${money(p.usual.income)}, расходы ${money(p.usual.expense)}. Целевой ориентир расходов: ${money(p.usual.targetExpense)}. В фактическую историю эти суммы не добавляются.</p><ul class="warning-list">${p.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul><p class="hint">Категории сопоставляются только по одинаковому названию (без учёта регистра и точек). Разные названия сохранены отдельно.</p>`;
  openDialog('Перенос бюджета из таблицы',body,async()=>{await saved({type:'importSource',data:{fingerprint}},{message:'Данные таблицы перенесены'});changeMonth('2026-10');},{submit:'Применить импорт',dirty:false});
 }
 function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function csvExport(){
  const cell=v=>{v=String(v??'');if(/^(?:\s*[=+\-@]|[\t\r\n])/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';};
  const rows=[['Месяц','Дата','Тип','Категория','Сумма, руб.','Комментарий','Источник'],...entries().map(e=>[e.month,e.date||'',state.budget.categories[e.categoryId].kind==='income'?'Доход':'Расход',state.budget.categories[e.categoryId].name,(e.amount/100).toFixed(2).replace('.',','),e.description,e.sourceRef||''])];
  download('Семейный-план-'+state.month+'.csv','\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8');notify('CSV за выбранный месяц подготовлен');
 }
 function restoreDialog(){
  openDialog('Восстановить бюджет из копии','<p>JSON-копия заменит весь общий бюджет для обоих участников. Пароли и входы сохранятся. Перед заменой сервер создаст страховочную копию текущих данных.</p>'+field('backup','JSON-копия бюджета','','file',{attrs:'accept=".json,application/json"',help:'Один файл JSON, максимум 6 МБ.'})+'<p class="file-status" id="file-status">Сначала выберите файл и проверьте его состав.</p>',async(v,form)=>{
   const file=form.elements.backup.files[0];if(!file)throw new FieldError('backup','Выберите JSON-копию.');if(file.size>6000000)throw new FieldError('backup','Файл больше 6 МБ.');
   let backup;try{backup=JSON.parse(await file.text());}catch{throw new FieldError('backup','Не удалось прочитать JSON. Выберите другую копию.');}
   const preview=await api('restorePreview',{backup});
   openDialog('Заменить общий бюджет?',`<p>Файл: <strong>${esc(file.name)}</strong></p><p>${preview.entries} операций, ${preview.categories} категорий.</p>${Object.entries(preview.summary).map(([m,s])=>`<div class="preview-month"><strong>${esc(monthName(m))}</strong><span>Расходы ${money(s.expense)} · доходы ${money(s.income)}</span></div>`).join('')}<p class="hint">Скачайте текущую JSON-копию на своё устройство перед заменой. Страховочная копия на том же сервере не защищает от удаления аккаунта хостинга.</p>`,()=>saved({type:'restore',data:{backup,fingerprint:preview.fingerprint}},{message:'Бюджет восстановлен'}),{submit:'Заменить бюджет',danger:true,dirty:false});
  },{submit:'Проверить файл',dirty:false});
 }
 function passwordDialog(){openDialog('Изменить пароль',field('currentPassword','Текущий пароль','','password',{autocomplete:'current-password'})+field('newPassword','Новый пароль','','password',{autocomplete:'new-password',help:'От 12 латинских символов, максимум 72 байта.'})+'<p class="hint">Другие входы с вашим логином завершатся. Будет выдан новый код восстановления.</p>',async v=>{const data=await api('password',v);finishModal();showCodes(data.recoveryCodes);},{submit:'Изменить пароль'});}
 function reauthDialog(){
  const dialog=$('#reauth');dialog.innerHTML=`<form novalidate><div class="dialog-head"><h2 id="reauth-title">Войти снова</h2></div><div class="dialog-body"><div class="form-error" role="alert" hidden></div><p>${esc(state.user.login)}. Ввод в основной форме сохранён.</p>${field('password','Пароль для повторного входа','','password',{autocomplete:'current-password'})}</div><div class="dialog-actions">${btn('close-reauth','Отмена')}<button type="submit" class="primary">Продолжить работу</button></div></form>`;dialog.showModal();bindForm($('form',dialog),async v=>{await api('session');const result=await api('login',{login:state.user.login,password:v.password});if(result.user.id!==state.user.id)throw new Error('Войдите в исходный аккаунт.');dialog.close();dialog.innerHTML='';await refresh();notify('Вы вошли. Проверьте форму и повторите сохранение.');});
 }
 function clearLocal(){for(const key of Object.keys(localStorage))if(key.startsWith('family:'))localStorage.removeItem(key);Object.assign(state,{user:null,budget:null,summary:{},pending:null,query:'',cat:'',kind:'all'});monthlyBudget=null;monthlyRows=[];monthlyFacts={};}
 function logoutDialog(){openDialog('Выйти на этом устройстве?',`<p>Сохранённый бюджет, черновик расхода и ключ неподтверждённой отправки будут удалены с этого устройства. Данные общего бюджета останутся на сервере.</p>${draft()||state.pending?'<p class="error">Есть локальный черновик или неподтверждённая отправка. Сначала завершите сохранение, если хотите оставить эти данные.</p>':''}`,async()=>{let pending=false;try{await api('logout',{});}catch{pending=true;}clearLocal();if(pending)localStorage.setItem('family:logoutPending','true');finishModal();renderLogin();if(pending)notify('Локальные данные удалены. Серверный выход завершится при восстановлении связи.');},{submit:'Выйти и очистить устройство',danger:true,dirty:false});}
 async function retryPending(){
  if(!state.pending)return;const p=state.pending;state.offline=false;
  try{await saveCommand(p.command,{revision:p.revision});if($('#modal').open)finishModal();notify('Сохранение подтверждено. Дубликат не создан.');}
  catch(e){if($('#modal').open)formError($('#modal form'),e);else notify(e.message);render();}
 }
 async function act(action,el){
  switch(action){
   case'nav':navigate(el.dataset.section);break;
   case'prev-month':changeMonth(nextMonth(state.month,-1));break;
   case'next-month':changeMonth(nextMonth(state.month,1));break;
   case'refresh':await refresh();break;
   case'all-entries':navigate('entries');break;
   case'new-entry':entryDialog();break;
   case'edit-entry':entryDialog(el.dataset.id);break;
   case'open-draft':entryDialog(null,true);break;
   case'save-draft':{const form=$('#modal form');if(form.elements.kind.value!=='expense')throw new Error('Локальный черновик предусмотрен для расхода.');saveDraft(values(form));$('#draft-status').textContent='Черновик сохранён только на этом устройстве.';notify('Черновик сохранён на устройстве');break;}
   case'delete-draft':confirmCommand('Удалить локальный черновик?','Расход ещё не отправлен на сервер. Удаление черновика необратимо.',{},'Удалить черновик');modalMeta.onSubmit=null;{const form=$('#modal form');form.replaceWith(form.cloneNode(true));bindForm($('#modal form'),async()=>{localStorage.removeItem(draftKey());finishModal();render();notify('Черновик удалён');});}break;
   case'new-category':categoryDialog();break;
   case'edit-category':categoryDialog(el.dataset.id);break;
   case'edit-plan':planDialog(el.dataset.cat);break;
   case'add-plan':planDialog();break;
   case'add-income-plan':planDialog(null,'income');break;
   case'month-settings':monthDialog();break;
   case'copy-plan':planTools(true);break;
   case'plan-tools':planTools();break;
   case'new-template':templateDialog();break;
   case'edit-template':templateDialog(el.dataset.id);break;
   case'delete-entry':{const r=state.budget.entries[el.dataset.id];confirmCommand('Удалить операцию?',`${state.budget.categories[r.categoryId].name} · ${money(r.amount)} · ${r.description||dateLabel(r)}`,{type:'deleteEntry',data:{id:r.id}});break;}
   case'delete-plan':confirmCommand('Убрать строку плана?','Фактические операции в категории сохранятся.',{type:'deletePlan',data:{id:el.dataset.id}});break;
   case'delete-template':confirmCommand('Удалить обычную сумму?','Уже заполненные месячные планы и операции сохранятся.',{type:'deleteTemplate',data:{id:el.dataset.id}});break;
   case'undo':confirmCommand('Отменить изменение?','Связанные данные вернутся к состоянию до этого изменения. Сервер проверит, что более новые правки не будут перезаписаны.',{type:'undo',data:{id:el.dataset.id}},'Отменить изменение');break;
   case'import':await importDialog();break;
   case'export':{const b=await api('export');download('Семейный-план-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(b,null,2),'application/json');notify('JSON-копия подготовлена');break;}
   case'csv':csvExport();break;
   case'restore':restoreDialog();break;
   case'password':passwordDialog();break;
   case'logout':logoutDialog();break;
   case'retry-pending':await retryPending();break;
   case'close-modal':closeModal();break;
   case'guard-keep':$('#guard').close();break;
   case'guard-discard':if(modalMeta?.entry){if(modalMeta.draftBefore)localStorage.setItem(draftKey(),JSON.stringify(modalMeta.draftBefore));else localStorage.removeItem(draftKey());}$('#guard').close();closeModal(true);render();break;
   case'guard-draft':{const form=$('#modal form');if(form.elements.kind.value!=='expense')throw new Error('Сохранение локального черновика доступно для расхода.');saveDraft(values(form));$('#guard').close();closeModal(true);render();notify('Черновик сохранён');break;}
   case'reauth':reauthDialog();break;
   case'refresh-session':await api('session');notify('Сессия обновлена. Ввод сохранён; повторите сохранение.');break;
   case'close-reauth':$('#reauth').close();break;
   case'resolve-conflict':{await refresh();if(state.stale)throw new Error('Не удалось загрузить актуальные данные. Проверьте связь.');modalMeta.revision=state.revision;const record=modalMeta.record,r=record?state.budget[record.collection][record.id]:null;$('.form-error',$('#modal')).textContent='Актуальный бюджет загружен. '+(record?(r?'Текущая запись: '+(r.amount!==undefined?money(r.amount)+' · ':'')+(r.description||r.name||'')+'. ':'Запись уже удалена. '):'')+'Ваш ввод сохранён. Проверьте его перед повторным сохранением.';break;}
   case'toggle-password':{const input=$('#'+el.dataset.field);input.type=input.type==='password'?'text':'password';el.setAttribute('aria-pressed',String(input.type==='text'));el.setAttribute('aria-label',input.type==='text'?'Скрыть пароль':'Показать пароль');break;}
   case'clear-search':state.query='';state.limit=30;render();$('#search')?.focus();break;
   case'clear-filters':Object.assign(state,{query:'',kind:'all',cat:'',limit:30});render();break;
   case'more-entries':state.limit+=30;render();break;
   case'more-history':state.historyLimit+=30;render();break;
   case'setup-finished':renderLogin();break;
   case'recover-screen':renderLogin(true);break;
   case'login-screen':renderLogin();break;
   case'restart':await start();break;
  }
 }
 document.addEventListener('click',e=>{const el=e.target.closest('button[data-action]');if(!el||el.disabled)return;act(el.dataset.action,el).catch(error=>{if($('#modal').open)formError($('#modal form'),error);else notify(error.message);});});
 document.addEventListener('change',e=>{if(e.target.id==='month')changeMonth(e.target.value);if(e.target.id==='kind-filter'){state.kind=e.target.value;state.limit=30;render();}if(e.target.id==='cat-filter'){state.cat=e.target.value;state.limit=30;render();}if(e.target.name==='showArchived'){state.showArchived=e.target.checked;render();}});
 document.addEventListener('input',e=>{if(e.target.id==='search'){state.query=e.target.value;state.limit=30;render();}});
 $('#modal').addEventListener('cancel',e=>{e.preventDefault();closeModal();});
 window.addEventListener('hashchange',()=>{const [section,month]=location.hash.slice(1).split('/');if(['budget','entries','categories','settings'].includes(section))state.section=section;if(/^20\d\d-(0[1-9]|1[0-2])$/.test(month||''))state.month=month;render();window.scrollTo(0,0);$('#page-title')?.focus();});
 window.addEventListener('offline',()=>{if(state.budget){state.offline=true;state.stale=true;render();}});
 window.addEventListener('online',()=>{if(localStorage.getItem('family:logoutPending')){start();return;}if(state.user)refresh();});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.user&&navigator.onLine)refresh({quiet:true});});
 window.addEventListener('beforeunload',e=>{if(modalMeta?.dirty&&!modalMeta.entry&&$('#modal').open&&JSON.stringify(values($('#modal form')))!==modalMeta.initial){e.preventDefault();e.returnValue='';}});
 start();
})();
