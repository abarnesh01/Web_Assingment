const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const base = process.env.TEST_URL || 'http://127.0.0.1:3000';
async function request(path, { token, method='GET', body }={}) {
  const r = await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await r.json(); return {status:r.status,data};
}
(async()=>{
  const suffix=Date.now().toString().slice(-8), username=`test_${suffix}`;
  let r=await request('/api/health');assert.equal(r.status,200);assert.equal(r.data.database,'connected');
  r=await request('/api/rooms');assert.equal(r.status,401,'rooms require auth');
  r=await request('/api/auth/register',{method:'POST',body:{username,password:'testing123'}});assert.equal(r.status,201);const token=r.data.token;
  r=await request('/api/auth/register',{method:'POST',body:{username,password:'testing123'}});assert.equal(r.status,409,'duplicate username rejected');
  r=await request('/api/auth/me',{token});assert.equal(r.data.user.username,username);
  r=await request('/api/rooms',{token});assert.equal(r.status,200);const roomId=r.data.rooms[0].id;
  r=await request(`/api/rooms/${roomId}/messages`,{token,method:'POST',body:{body:'smoke test'}});assert.equal(r.status,201);const messageId=r.data.message.id;
  r=await request(`/api/rooms/${roomId}/messages`,{token,method:'POST',body:{body:'  '}});assert.equal(r.status,400,'empty message rejected');
  const other=(await request('/api/auth/register',{method:'POST',body:{username:`other_${suffix}`,password:'testing123'}})).data.token;
  r=await request(`/api/messages/${messageId}`,{token:other,method:'PUT',body:{body:'not allowed'}});assert.equal(r.status,403,'cannot edit another user\'s message');
  r=await request(`/api/messages/${messageId}`,{token,method:'PUT',body:{body:'updated smoke test'}});assert.equal(r.status,200);assert.equal(r.data.message.edited,1);
  r=await request(`/api/rooms/${roomId}/messages`,{token});assert.ok(r.data.messages.some(m=>m.id===messageId&&m.body==='updated smoke test'));
  const socket=io(base,{auth:{token},transports:['websocket']});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);setTimeout(()=>reject(new Error('websocket connection timeout')),5000)});
  await new Promise((resolve,reject)=>socket.emit('room:join',roomId,ack=>ack?.ok?resolve():reject(new Error('room join failed'))));
  const received=new Promise((resolve,reject)=>{socket.once('message:new',resolve);setTimeout(()=>reject(new Error('websocket event timeout')),5000)});
  r=await request(`/api/rooms/${roomId}/messages`,{token,method:'POST',body:{body:'realtime event check'}});assert.equal(r.status,201);const event=await received;assert.equal(event.id,r.data.message.id);
  r=await request(`/api/messages/${messageId}`,{token,method:'DELETE'});assert.equal(r.status,200);
  r=await request(`/api/messages/${messageId}`,{token,method:'DELETE'});assert.equal(r.status,404);
  r=await request(`/api/rooms/${roomId}/messages`,{token});assert.ok(!r.data.messages.some(m=>m.id===messageId));
  socket.disconnect();console.log('PASS: auth, validation, REST CRUD, persistence, ownership, JSON and Socket.IO broadcast');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
