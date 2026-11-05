import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:net';
const root=process.cwd(), require=createRequire(path.join(root,'package.json'));
const {Pool}=require('pg'), WebSocket=require('ws');
const databaseUrl=process.env.PG_CRASH_DATABASE_URL;
assert(databaseUrl && /^laitse_poc_crash_[0-9]+$/u.test(new URL(databaseUrl).pathname.slice(1)), 'Use a newly created dedicated crash diagnostic database');
assert.equal(process.version,'v26.13.0');
const A=randomBytes(18).toString('base64url'), B=randomBytes(18).toString('base64url'), hostToken=randomBytes(32).toString('base64url');
const secrets=[databaseUrl,new URL(databaseUrl).password,A,B,hostToken];
const pool=new Pool({connectionString:databaseUrl,connectionTimeoutMillis:2000,options:'-c statement_timeout=5000'});
const origin='http://127.0.0.1:4174';
const report={kind:'owned-SIGKILL-and-advisory-lock-loss-diagnostic',processes:[],checks:[],rawTokensRetained:false,credentialsRetained:false,fullPOCPass:false};
const children=[],sockets=[];
let active;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label,ms=10000){const end=Date.now()+ms;while(Date.now()<end){const r=await predicate();if(r)return r;await delay(25);}throw new Error('Timed out: '+label);}
async function start(label){
 const child=spawn(process.execPath,['dist/server/index.js'],{cwd:root,env:{PATH:process.env.PATH,HOST:'127.0.0.1',PORT:'4174',HOST_CONTROL_TOKEN:hostToken,MEETING_ROOM_PASSWORD:A,DATABASE_URL:databaseUrl},stdio:'ignore'});
 const rec={label,pid:child.pid,owned:true,startedAt:new Date().toISOString()};children.push(child);report.processes.push(rec);active=child;
 child.on('exit',(code,signal)=>{rec.exitCode=code;rec.exitSignal=signal;rec.endedAt=new Date().toISOString();});
 await until(async()=>{assert(child.exitCode===null && child.signalCode===null,'Owned app exited before readiness');try{const r=await fetch(origin+'/api/health');return r.ok && (await r.json()).persistence==='postgresql';}catch{return false;}},label+' health');
 return child;
}
async function connect(){const ws=new WebSocket(origin.replace('http:','ws:')+'/ws',{origin});sockets.push(ws);ws.on('error',()=>{});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});return ws;}
function next(ws,pred){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>done(new Error('Protocol observation timeout')),5000);const onMessage=raw=>{const v=JSON.parse(raw.toString());if(pred(v))done(null,v)};const onClose=()=>done(new Error('Socket closed before expected control'));function done(err,v){clearTimeout(timer);ws.off('message',onMessage);ws.off('close',onClose);err?reject(err):resolve(v)}ws.on('message',onMessage);ws.once('close',onClose);});}
async function request(ws,payload,type,pred=()=>true){const response=next(ws,v=>v.type===type && pred(v));ws.send(JSON.stringify(payload));return response;}
try{
 await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen({host:'127.0.0.1',port:4174,exclusive:true},()=>probe.close(err=>err?reject(err):resolve()));});
 const first=await start('before-hard-kill'), ws=await connect();
 const issued=next(ws,v=>v.type==='session.issued'), joined=next(ws,v=>v.type==='room.snapshot');ws.send(JSON.stringify({type:'join',roomId:'studio',displayName:'Crash fixture',password:A,resumable:true}));const session=await issued;secrets.push(session.token);await joined;
 await request(ws,{type:'host.claim',token:hostToken},'host.claimed');
 await request(ws,{type:'host.setMeetingRoomPassword',password:B},'host.actionResult',v=>v.action==='setMeetingRoomPassword');
 const chat=await request(ws,{type:'interaction.submit',kind:'chat',text:'Synthetic crash fixture',eventId:'crash-chat'},'interaction.ack',v=>v.eventId==='crash-chat');
 await request(ws,{type:'interaction.submit',kind:'feedback',feedback:'like',eventId:'crash-feedback'},'interaction.ack',v=>v.eventId==='crash-feedback');
 assert.equal((await pool.query('select count(*)::int as n from interaction_archive')).rows[0].n,2);
 report.checks.push({name:'ACKs-already-visible-in-SQL-before-kill',archiveRows:2,chatInteractionId:chat.interactionId});
 first.kill('SIGKILL');await until(()=>first.signalCode==='SIGKILL','owned SIGKILL exit');
 assert.equal((await pool.query('select count(*)::int as n from interaction_archive')).rows[0].n,2);
 const second=await start('after-hard-kill');assert.notEqual(first.pid,second.pid);
 const restored=await connect();
 const gate=await request(restored,{type:'session.resume',token:session.token},'protocol.error');assert.equal(gate.code,'room_password_required');
 const snapshot=next(restored,v=>v.type==='room.snapshot'), interaction=next(restored,v=>v.type==='interaction.snapshot');
 const resume=await request(restored,{type:'session.resume',token:session.token,password:B},'session.resumed');assert.equal(resume.participantId,session.participantId);
 const [room,history]=await Promise.all([snapshot,interaction]);assert.equal(room.room.publishAllowed,false);assert(history.history.some(v=>v.id===chat.interactionId));assert.equal(history.feedbackStats.like.count,1);
 const duplicate=await request(restored,{type:'interaction.submit',kind:'chat',text:'Synthetic crash fixture',eventId:'crash-chat'},'interaction.ack',v=>v.eventId==='crash-chat');assert.equal(duplicate.duplicate,true);
 assert.equal((await pool.query('select count(*)::int as n from interaction_archive')).rows[0].n,2);
 assert.equal((await pool.query("select interactions from room_counters where room_id='studio'")).rows[0].interactions,'2');
 report.checks.push({name:'hard-kill-durable-data-and-same-proof',sameParticipantId:true,participantId:resume.participantId,latestPasswordRequired:true,feedbackCount:1,chatInteractionId:chat.interactionId,hostPublishAllowed:false,duplicate:true,archiveRowsAfterReplay:2});
 const lock=await pool.query("select pid from pg_locks where locktype='advisory' and granted and database=(select oid from pg_database where datname=current_database())");assert.equal(lock.rows.length,1);
 const lockPid=lock.rows[0].pid;await pool.query('select pg_terminate_backend($1)',[lockPid]);
 await until(()=>second.exitCode!==null || second.signalCode!==null,'app stop after advisory connection lost');
 const healthy=await fetch(origin+'/api/health').then(r=>r.ok).catch(()=>false);assert.equal(healthy,false);
 report.checks.push({name:'advisory-backend-loss-stops-idle-app',databaseBackendPid:lockPid,appStopped:true,healthUnavailable:true});
 report.status='passed';
}catch(error){report.status='failed';let message=String(error?.message??error);for(const secret of secrets)message=message.split(secret).join('[redacted]');report.error=message;process.exitCode=1;}
finally{
 for(const ws of sockets)ws.terminate();
 for(const child of children){if(child.exitCode===null && child.signalCode===null){child.kill('SIGTERM');try{await until(()=>child.exitCode!==null || child.signalCode!==null,'cleanup',5000)}catch{child.kill('SIGKILL');await until(()=>child.exitCode!==null || child.signalCode!==null,'fallback',2000)}}}
 await pool.end();report.finishedAt=new Date().toISOString();
 let serialized=JSON.stringify(report,null,2)+'\n';assert(!secrets.some(v=>serialized.includes(v)),'No raw secrets in evidence');writeFileSync('docs/poc/evidence/POC-06-R002/crash-lock-report.json',serialized);console.log(JSON.stringify({status:report.status,checks:report.checks.map(v=>v.name),error:report.error??null}));
}
