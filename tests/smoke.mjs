import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(path.join(os.tmpdir(),'family-plan-test-'));
const quote=s=>"'"+s.replaceAll('\\','/').replaceAll("'","\\'")+"'";
const installKey=randomBytes(24).toString('hex'),password=randomBytes(16).toString('hex');
await writeFile(path.join(temp,'config.php'),`<?php return ['dsn'=>${quote('sqlite:'+path.join(temp,'test.sqlite'))},'installKey'=>'${installKey}','secure'=>false,'privateDir'=>${quote(temp)}];`);
const port=Number(process.env.TEST_PORT||18439),base=`http://127.0.0.1:${port}/api.php?action=`;
const options=process.env.PHP_EXT_DIR?['-n','-d',`extension_dir=${process.env.PHP_EXT_DIR}`,'-d','extension=pdo_sqlite']:[];
const server=spawn(process.env.PHP_BIN||'php',[...options,'-S',`127.0.0.1:${port}`,'-t',path.join(root,'public')],{env:{...process.env,FAMILY_CONFIG:path.join(temp,'config.php')},stdio:'ignore',windowsHide:true});
let launchError;server.on('error',e=>{launchError=e;});
const first={cookie:'',csrf:''},second={cookie:'',csrf:''};
async function request(client,action,body){
  const response=await fetch(base+action,{method:body?'POST':'GET',headers:{cookie:client.cookie,...(body?{'Content-Type':'application/json','X-CSRF-Token':client.csrf}:{})},body:body?JSON.stringify(body):undefined});
  const cookie=response.headers.get('set-cookie');if(cookie)client.cookie=cookie.split(';')[0];
  const data=await response.json();if(data.csrf)client.csrf=data.csrf;
  return {status:response.status,data};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
try{
  let ready=false;
  for(let i=0;i<80;i++){if(launchError)throw launchError;try{await request(first,'session');ready=true;break;}catch{await delay(80);}}
  assert.equal(ready,true,'PHP with PDO SQLite must be available');
  await test('Anonymous budget is protected',async()=>assert.equal((await request(second,'state')).status,401));
  await test('Two private logins are created once',async()=>{
    const users=[{login:'test_one',name:'Первый участник',password},{login:'test_two',name:'Второй участник',password}];
    assert.equal((await request(first,'setup',{installKey,users})).status,200);
    assert.equal((await request(first,'setup',{installKey,users})).status,409);
    assert.equal((await request(first,'login',{login:'test_one',password})).status,200);
    await request(second,'session');assert.equal((await request(second,'login',{login:'test_two',password})).status,200);
  });
  await test('A private source snapshot is optional and absent by default',async()=>assert.equal((await request(first,'source')).status,404));
  let state=(await request(first,'state')).data;
  const mutate=async(command,extra={})=>request(first,'mutate',{revision:state.revision,requestId:randomUUID(),command,...extra});
  let categoryId,entryId;
  await test('Manual category, plan and exact kopecks work',async()=>{
    let result=await mutate({type:'saveCategory',data:{name:'Тестовая категория',kind:'expense',order:0,archived:false}});
    assert.equal(result.status,200);categoryId=result.data.result.id;state=result.data;
    result=await mutate({type:'savePlan',data:{month:'2026-01',categoryId,amount:10001}});assert.equal(result.status,200);state=result.data;
    const body={revision:state.revision,requestId:randomUUID(),command:{type:'saveEntry',data:{month:'2026-01',date:null,categoryId,amount:123,description:'Вымышленная проверочная операция'}}};
    result=await request(first,'mutate',body);assert.equal(result.status,200);entryId=result.data.result.id;state=result.data;
    const replay=await request(first,'mutate',body);assert.equal(replay.status,200);assert.equal(replay.data.result.id,entryId);
    state=(await request(first,'state')).data;
    assert.equal(state.summary['2026-01'].expense,123);assert.equal(state.summary['2026-01'].plannedExpense,10001);
  });
  await test('The second participant sees the same data and stale writes fail',async()=>{
    const shared=(await request(second,'state')).data;assert.equal(shared.budget.entries[entryId].amount,123);
    assert.equal((await request(second,'mutate',{revision:0,requestId:randomUUID(),command:{type:'deleteEntry',data:{id:entryId}}})).status,409);
  });
  await test('JSON preview and restore preserve data with a pre-restore copy',async()=>{
    const backup=(await request(first,'export')).data;assert.equal(backup.format,'family-budget');
    let result=await mutate({type:'deleteEntry',data:{id:entryId}});assert.equal(result.status,200);state=result.data;
    const preview=await request(first,'restorePreview',{backup});assert.equal(preview.status,200);
    result=await mutate({type:'restore',data:{backup,fingerprint:preview.data.fingerprint}});assert.equal(result.status,200);state=result.data;
    state=(await request(first,'state')).data;
    assert.equal(state.budget.entries[entryId].amount,123);assert.equal((await readdir(path.join(temp,'backups'))).length,1);
  });
  console.log(`${passed} smoke scenarios passed`);
}finally{
  if(server.exitCode===null&&!launchError){server.kill();await Promise.race([once(server,'exit'),delay(2000)]);}
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('family-plan-test-'))throw Error('Unexpected temporary path');
  await rm(temp,{recursive:true,force:true});
}
