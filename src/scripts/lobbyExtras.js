const {SlashCommandBuilder,MessageFlags,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle}=require('discord.js');
const db=require('../database/database'),config=require('../config/config');
const store=require('../services/lobbyExtrasStore');
const {staffAccess}=require('./scoreboards');
const {safe}=require('../services/competitiveStats');
const {channelLink}=require('../ui/guidance');
const commands=[
 new SlashCommandBuilder().setName('reserva').setDescription('Entra, sai ou consulta sua posição na reserva do lobby.').setDMPermission(false).addStringOption(o=>o.setName('acao').setDescription('O que deseja fazer?').setRequired(true).addChoices({name:'Entrar na reserva',value:'entrar'},{name:'Sair da reserva',value:'sair'},{name:'Consultar minha posição',value:'consultar'})),
 new SlashCommandBuilder().setName('cancelar').setDescription('Solicita à staff o cancelamento de uma partida sua.').setDMPermission(false).addStringOption(o=>o.setName('codigo').setDescription('Código da partida.').setRequired(true)).addStringOption(o=>o.setName('motivo').setDescription('Por que a partida precisa ser cancelada?').setMinLength(10).setMaxLength(500).setRequired(true)),
 new SlashCommandBuilder().setName('cancelamentos').setDescription('Staff: analisa pedidos de cancelamento em privado.').setDMPermission(false).addIntegerOption(o=>o.setName('protocolo').setDescription('Protocolo para analisar; vazio lista os últimos.').setMinValue(1)),
 new SlashCommandBuilder().setName('voz').setDescription('Abre ou recupera as salas de voz dos times do seu lobby.').setDMPermission(false)
];
const reply=(i,content,components=[])=>i.reply({content,components,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
async function notify(i,id){try{const c=await i.client.channels.fetch('1557714957007593472');if(c?.guildId!==config.discord.guildId)throw new Error('Canal da staff indisponível');await c.send({content:`📩 Pedido de cancelamento **${id}** aguardando decisão. Staff: **/cancelamentos protocolo:${id}**.`,allowedMentions:{parse:[]}});}catch(error){console.warn('[CANCELAMENTO] Protocolo preservado:',id,error.code||error.message);}}
function view(r){
 const pending=r.status==='pending';
 const embed=new EmbedBuilder().setColor(0xFF3D2C).setTitle(`Cancelamento ${r.id} · ${r.match_code}`).setDescription(`**Estado:** ${{pending:'Pendente',approved:'Aprovado',rejected:'Recusado'}[r.status]}\n**Solicitante:** <@${r.requested_by}>\n**Motivo:** ${safe(r.reason,1000)}`+(r.reviewed_by?`\n\n**Decisão por:** <@${r.reviewed_by}>\n**Justificativa:** ${safe(r.review_note,600)}\n${r.reviewed_at} UTC`:''));
 const components=pending?[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cancelreq:approve:${r.id}`).setLabel('Aprovar cancelamento').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`cancelreq:reject:${r.id}`).setLabel('Recusar pedido').setStyle(ButtonStyle.Secondary))]:[];
 return {embeds:[embed],components,allowedMentions:{parse:[]}};
}
async function handle(i){
 const component=i.customId?.startsWith('cancelreq:');
 if(!component&&!(i.isChatInputCommand()&&commands.some(c=>c.name===i.commandName)))return false;
 if(!i.inGuild()||i.guildId!==config.discord.guildId){await reply(i,'Use no servidor autorizado.');return true;}
 try{
  if(component){
   if(!staffAccess(i))throw new Error('A decisão é exclusiva da staff.');
   const [,action,rawId]=i.customId.split(':');
   if(action==='list'){
    const rows=store.cancellations();
    const components=rows.length?[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('cancelreq:open').setPlaceholder('Selecionar pedido de cancelamento').addOptions(rows.map(r=>({label:`${r.id} · ${r.match_code} · ${{pending:'Pendente',approved:'Aprovado',rejected:'Recusado'}[r.status]}`,value:String(r.id)}))))]:[];
    await reply(i,rows.length?'Selecione o pedido para conferir o motivo e decidir.':'Nenhum pedido registrado.',components);return true;
   }
   const id=Number(action==='open'?i.values?.[0]:rawId);
   if(action==='open'&&i.isStringSelectMenu()){
    const selected=store.cancellation(id);if(!selected)throw new Error('Protocolo não encontrado.');
    await i.update({content:'',...view(selected)});return true;
   }
   if(!Number.isSafeInteger(id)||id<1)throw new Error('Protocolo inválido.');
   const r=store.cancellation(id);if(!r||r.status!=='pending')throw new Error('Este pedido não está mais pendente.');
   if(['approve','reject'].includes(action)&&i.isButton()){
    const modal=new ModalBuilder().setCustomId(`cancelreq:${action==='approve'?'confirm':'deny'}:${id}`).setTitle('Decisão de cancelamento').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note').setLabel('Justificativa da decisão').setStyle(TextInputStyle.Paragraph).setMinLength(5).setMaxLength(300).setRequired(true)));
    await i.showModal(modal);return true;
   }
   if(['confirm','deny'].includes(action)&&i.isModalSubmit()){
    const decided=store.decide(id,i.user.id,action==='confirm',i.fields.getTextInputValue('note'));
    await i.deferUpdate();await i.editReply(view(decided));
    if(decided.status==='approved'){
     try{const c=await i.client.channels.fetch(config.discord.resultsChannelId);await c.send({content:`Partida **${safe(decided.match_code)} cancelada pela staff** após análise do pedido. Não serão atribuídos pontos por esta partida.`,allowedMentions:{parse:[]}});}catch(error){console.warn('[CANCELAMENTO] Resultado não anunciado:',error.message);}
     await require('../services/teamVoice').cleanup(i.client);
    }return true;
   }
   throw new Error('Ação inválida.');
  }
  if(i.commandName==='reserva'){
   const action=i.options.getString('acao',true);
   if(action==='entrar'){const pos=store.joinReserve(i.guildId,i.user.id);await reply(i,`Você está na **posição ${pos} da reserva**. Se for chamado, confirme presença no prazo do novo painel. Só jogadores conectados são movidos para voz; a reserva não confirma presença automaticamente.`,channelLink(i.guildId,config.discord.draftChannelId,'Abrir confirmação de presença'));}
   else if(action==='sair'){store.leaveReserve(i.guildId,i.user.id);await reply(i,'Você saiu da reserva. Se já foi chamado para um lobby, use /situacao para consultar sua etapa atual.');}
   else {const pos=store.reserves(i.guildId).findIndex(p=>p.discord_id===i.user.id)+1;await reply(i,pos?`Sua posição na reserva: **${pos}**. Sua elegibilidade será conferida novamente quando houver uma vaga.`:'Você não está na reserva. Use /reserva acao:Entrar na reserva.');}
   return true;
  }
  if(i.commandName==='cancelar'){
   const code=i.options.getString('codigo',true).trim().replace(/^#/,'');const m=db.prepare('SELECT id FROM matches WHERE match_code=? OR match_code=?').get(code,'#'+code);if(!m)throw new Error('Partida não encontrada. Confira o código em /historico.');
   const r=store.requestCancel(m.id,i.user.id,i.options.getString('motivo',true));await reply(i,`Pedido **${r.id}** registrado. A partida **${safe(r.match_code)} continua ativa** até a staff decidir. Não abandone a partida apenas por ter enviado o pedido.`);await notify(i,r.id);return true;
  }
  if(i.commandName==='cancelamentos'){
   if(!staffAccess(i))throw new Error('Consulta exclusiva da staff.');
   const id=i.options.getInteger('protocolo');
   if(!id){await reply(i,store.cancellations().map(r=>`**${r.id}** · ${safe(r.match_code)} · ${{pending:'Pendente',approved:'Aprovado',rejected:'Recusado'}[r.status]}`).join('\n')||'Nenhum pedido registrado.');return true;}
   const r=store.cancellation(id);if(!r)throw new Error('Protocolo não encontrado.');await i.reply({...view(r),flags:MessageFlags.Ephemeral});return true;
  }
  if(i.commandName==='voz'){
   const s=db.prepare("SELECT s.id FROM matchmaking_sessions s JOIN matchmaking_session_players sp ON sp.session_id=s.id LEFT JOIN matches m ON m.id=s.match_id WHERE s.guild_id=? AND sp.discord_id=? AND s.stage IN ('map_veto','side_choice','playing') AND (s.status='active' OR m.status IN ('playing','pending_confirmation','disputed')) ORDER BY s.id DESC LIMIT 1").get(i.guildId,i.user.id);
   if(!s)throw new Error('Você não possui um lobby com times definidos. Consulte /situacao.');
   await i.deferReply({flags:MessageFlags.Ephemeral});
   const rooms=await require('../services/teamVoice').ensure(i.client,s.id);
   await i.editReply({content:rooms.map(r=>`**Time ${safe(r.teamName)}:** <#${r.channelId}> · ${r.moved} jogador(es) movidos`+(r.failed?` · ${r.failed} indisponível(is) para mover`: '')).join('\n')+'\nQuem estiver desconectado pode entrar diretamente na sala do seu time.',allowedMentions:{parse:[]}});return true;
  }
 }catch(error){const payload={content:safe(error.message,800),flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}};if(i.deferred||i.replied)await i.followUp(payload);else await i.reply(payload);}
 return true;
}
module.exports={commands,handle};
