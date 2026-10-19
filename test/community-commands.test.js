const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {MessageFlags}=require('discord.js');
test('complaint commands keep allegations private, deny nonstaff consultation and notify only a protocol',async()=>{
  const file=require.resolve('../src/scripts/community'),original=Module._load;
  const events=[];let reads=0;
  let handle,commands;
  try {
    Module._load=function(request,parent){
      if(parent?.filename===file){
        if(request==='../config/config')return {discord:{guildId:'guild'}};
        if(request==='../database/database')return {prepare:()=>({get:()=>({id:1})})};
        if(request==='../services/communityFeatures')return {
          complain:()=>({id:42,match_code:'#1'}),
          complaints:()=>{reads++;return [{id:42,status:'open',match_code:'#1'}];}
        };
        if(request==='./scoreboards')return {staffAccess:i=>i.staff===true&&i.guildId==='guild'};
      }
      return original.apply(this,arguments);
    };
    delete require.cache[file];({handle,commands}=require(file));
  }finally{Module._load=original;}
  try {
    for(const c of commands)assert.ok(c.toJSON().name);
    const base={inGuild:()=>true,isChatInputCommand:()=>true,guildId:'guild',user:{id:'p0'},
      options:{getString:name=>name==='codigo'?'#1':'Relato confidencial',getUser:()=>null,getInteger:()=>null},
      reply:async payload=>events.push(['reply',payload]),
      client:{channels:{fetch:async()=>({guildId:'guild',isTextBased:()=>true,send:async payload=>events.push(['notice',payload])})}}};
    await handle({...base,commandName:'denuncias'});
    assert.equal(reads,0);assert.match(events.pop()[1].content,/exclusiva/);
    await handle({...base,commandName:'denunciar'});
    assert.equal(events[0][1].flags,MessageFlags.Ephemeral);
    assert.equal(events[1][0],'notice');assert.match(events[1][1].content,/42/);
    assert.doesNotMatch(events[1][1].content,/Relato|p0/);
    events.length=0;
    await handle({...base,commandName:'denuncias',staff:true,options:{getString:()=>null,getInteger:()=>null}});
    assert.equal(reads,1);assert.equal(events[0][1].flags,MessageFlags.Ephemeral);
    events.length=0;
    await handle({...base,commandName:'denuncias',staff:true,guildId:'other'});
    assert.equal(reads,1);assert.match(events[0][1].content,/autorizado/);
  }finally{delete require.cache[file];}
});
