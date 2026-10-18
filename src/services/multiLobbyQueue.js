// Opt-in persistent multi-lobby queue. Legacy queue remains the default.
const {MessageFlags}=require("discord.js");
const db=require("../database/database");
const config=require("../config/config");
const waiting=require("./waitingQueue");
const readyPanels=require("./readyCheckPanels");
const queueState=require("../scripts/queueState");
function enabled(){return process.env.MULTILOBBY_QUEUE_ENABLED==="true";}
function assertReady(){
 const index=db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_matchmaking_one_active_guild'").get();
 if(index)throw new Error("MULTILOBBY_SCHEMA_NOT_MIGRATED");
 const legacy=db.prepare("SELECT COUNT(*) AS n FROM matchmaking_sessions WHERE status='active' AND stage='queue'").get();
 if(legacy.n)throw new Error("LEGACY_QUEUE_SESSION_ACTIVE");
}
function validatePlayer(id){
 const player=db.prepare("SELECT access_active,is_banned FROM players WHERE discord_id=?").get(id);
 if(!player||player.access_active!==1)return "Você não possui acesso ao matchmaking.";
 if(player.is_banned===1)return "Você está impedido de participar do matchmaking.";
 const penalty=queueState.getPenaltyRemaining(id);
 if(penalty>0)return `Você possui cooldown de matchmaking por mais ${Math.ceil(penalty/60000)} minuto(s).`;
 const match=db.prepare(`SELECT 1 FROM match_players mp JOIN matches m ON m.id=mp.match_id
 WHERE mp.discord_id=? AND m.status IN ('playing','pending_confirmation','disputed') LIMIT 1`).get(id);
 if(match)return "Você já está participando de uma partida.";
 return null;
}
async function drain(client,guildId,channelId){
 const created=[];
 while(true){
  const reservation=waiting.reserveIntoSession(guildId,channelId,config.matchmaking.requiredPlayers);
  if(!reservation)break;
  created.push(reservation.sessionId);
  try{await readyPanels.start(client,reservation.sessionId);}
  catch(error){
   // Reservation stays persisted; startup recovery retries publication.
   console.error("[MULTILOBBY] Ready Check publication failed:",reservation.sessionId,error);
  }
 }
 return created;
}
async function handle(interaction){
 if(!enabled())return false;
 if(!interaction.isButton?.()||!["queue_join","queue_leave"].includes(interaction.customId))return false;
 if(interaction.guildId!==config.discord.guildId||interaction.channelId!==config.discord.queueChannelId){
  await interaction.reply({content:"Use a fila no canal de matchmaking.",flags:MessageFlags.Ephemeral});
  return true;
 }
 try{assertReady();}
 catch(error){
  console.error("[MULTILOBBY] Queue unavailable:",error);
  await interaction.reply({content:"Fila múltipla indisponível: migração pendente ou fila antiga ainda ativa.",flags:MessageFlags.Ephemeral});
  return true;
 }
 const guildId=interaction.guildId,id=interaction.user.id;
 if(interaction.customId==="queue_join"){
  const problem=validatePlayer(id);
  if(problem){
   await interaction.reply({content:problem,flags:MessageFlags.Ephemeral});
   return true;
  }
  if(!waiting.enqueue(guildId,id)){
   await interaction.reply({content:"Você já está na fila ou em um lobby ativo.",flags:MessageFlags.Ephemeral});
   return true;
  }
 }else if(!waiting.dequeue(guildId,id)){
  await interaction.reply({content:"Você não está na fila de espera.",flags:MessageFlags.Ephemeral});
  return true;
 }
 const size=waiting.listWaiting(guildId).length;
 await interaction.reply({content:interaction.customId==="queue_join"
  ? `Você entrou na fila. ${size} jogador(es) aguardando.`
  : `Você saiu da fila. ${size} jogador(es) aguardando.`,flags:MessageFlags.Ephemeral});
 if(interaction.customId==="queue_join"){
  try{await drain(interaction.client,guildId,interaction.channelId);}
  catch(error){console.error("[MULTILOBBY] Queue handoff failed:",error);}
 }
 return true;
}
async function recover(client){
 if(!enabled())return [];
 assertReady();
 return drain(client,config.discord.guildId,config.discord.queueChannelId);
}
module.exports={enabled,handle,recover,drain};
