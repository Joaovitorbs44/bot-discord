const test=require("node:test"),assert=require("node:assert/strict");
const {captainTeam,matchTeam}=require("../src/services/teamLabels");
test("team names use captain nicknames and keep buttons readable and bounded",()=>{
 const db={prepare:()=>({get:id=>({r6_nickname:id==="one"?"yHacKzz7.":"HurThZ"})})};
 const match={captain_a_discord_id:"one",captain_b_discord_id:"two"};
 assert.equal(matchTeam(db,match,"A"),"Time yHacKzz7.");
 assert.equal(matchTeam(db,match,"B"),"Time HurThZ");
 assert.equal(captainTeam({nickname:"nome_com_underscore"},null,true),"Time nome_com_underscore");
 assert.equal(captainTeam({nickname:"nome_com_underscore"}),"Time nome\\_com\\_underscore");
 assert.ok(captainTeam({nickname:"x".repeat(200)},null,true).length+7<=80);
 assert.equal(captainTeam("player01"),"Time player01");
 assert.equal(matchTeam(db,match,null),"Não definido");
});
