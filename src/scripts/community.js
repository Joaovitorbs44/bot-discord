const {SlashCommandBuilder,MessageFlags,EmbedBuilder}=require('discord.js');
const config=require('../config/config');
const db=require('../database/database');
const stats=require('../services/competitiveStats');
const store=require('../services/communityFeatures');
const {staffAccess}=require('./scoreboards');
const {safe}=stats;
const commands=[
  new SlashCommandBuilder().setName('mapas').setDescription('Partidas, vitórias, derrotas e K/D por mapa.').setDMPermission(false)
    .addUserOption(o=>o.setName('jogador').setDescription('Jogador; vazio consulta seu perfil.'))
    .addIntegerOption(o=>o.setName('temporada').setDescription('Número da temporada; vazio usa a atual.').setMinValue(1)),
  new SlashCommandBuilder().setName('denunciar').setDescription('Envia à staff uma denúncia privada de uma partida sua.').setDMPermission(false)
    .addStringOption(o=>o.setName('codigo').setDescription('Código da partida do bot.').setRequired(true))
    .addStringOption(o=>o.setName('motivo').setDescription('Descreva o ocorrido; não inclua senhas ou dados pessoais.').setMinLength(10).setMaxLength(1000).setRequired(true))
    .addUserOption(o=>o.setName('jogador').setDescription('Jogador denunciado, quando houver.')),
  new SlashCommandBuilder().setName('denuncias').setDescription('Staff: consulta e encerra denúncias em privado.').setDMPermission(false)
    .addIntegerOption(o=>o.setName('protocolo').setDescription('Protocolo da denúncia; vazio lista as últimas.').setMinValue(1))
    .addStringOption(o=>o.setName('conclusao').setDescription('Preencha para registrar a decisão e encerrar o protocolo.').setMinLength(5).setMaxLength(1000))
];
const privateReply=(i,content)=>i.reply({content,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
async function maps(i) {
  const user=i.options.getUser('jogador')||i.user;
  const number=i.options.getInteger('temporada');
  const season=number?db.prepare('SELECT id,name FROM seasons WHERE id=?').get(number):stats.activeSeason();
  if(!season)return privateReply(i,'Temporada não encontrada ou nenhuma temporada ativa.');
  const player=stats.getPlayer(user.id);
  if(!player)return privateReply(i,'Esse jogador não possui perfil no matchmaking.');
  const rows=store.maps(user.id,season.id);
  const embed=new EmbedBuilder().setColor(0xFF3D2C).setTitle('Estatísticas por mapa')
    .setDescription(`**${safe(player.r6_nickname)}** · ${safe(season.name)}\n\n`+(rows.map(r=>`**${safe(r.map)}**\n${r.matches} partidas · ${r.wins}V / ${r.losses}D · ${stats.winRate(r.wins,r.matches)}% vitórias\n${r.kills} kills / ${r.deaths} mortes · **${r.kd} K/D** · ${r.kd_matches} placares aprovados`).join('\n\n')||'Nenhuma partida finalizada nesta temporada.'))
    .setFooter({text:'Partidas canceladas ou sem vencedor não contam. K/D: somente placares aprovados.'});
  return i.reply({embeds:[embed],flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
}
async function notify(i,id) {
  try {
    const channel=await i.client.channels.fetch('1557714957007593472');
    if(channel?.guildId!==config.discord.guildId||!channel.isTextBased())throw new Error('Canal da staff indisponível');
    // Only a protocol notice is posted; identities and allegations stay in private replies.
    await channel.send({content:`📩 Nova denúncia registrada. Protocolo **${id}**. Staff: consulte **/denuncias protocolo:${id}**.`,allowedMentions:{parse:[]}});
  } catch(error) { console.warn('[DENUNCIAS] Notificação indisponível; protocolo preservado:',id,error.code||error.message); }
}
async function handle(i) {
  if(!i.isChatInputCommand()||!['mapas','denunciar','denuncias'].includes(i.commandName))return false;
  if(!i.inGuild()||i.guildId!==config.discord.guildId){await privateReply(i,'Use este comando no servidor autorizado.');return true;}
  try {
    if(i.commandName==='mapas'){await maps(i);return true;}
    if(i.commandName==='denunciar') {
      const code=i.options.getString('codigo',true).trim().replace(/^#/,'');
      const match=db.prepare('SELECT id FROM matches WHERE match_code=? OR match_code=?').get(code,'#'+code);
      if(!match)throw new Error('Partida não encontrada. Confira o código gerado pelo bot.');
      const report=store.complain({matchId:match.id,reporterId:i.user.id,reportedId:i.options.getUser('jogador')?.id,reason:i.options.getString('motivo',true)});
      await privateReply(i,`Denúncia registrada no protocolo **${report.id}**, partida **${safe(report.match_code)}**. A staff poderá consultar seu relato em privado. Nenhuma punição é aplicada automaticamente.`);
      await notify(i,report.id);return true;
    }
    if(!staffAccess(i)){await privateReply(i,'Consulta exclusiva da staff.');return true;}
    const id=i.options.getInteger('protocolo'),resolution=i.options.getString('conclusao');
    if(resolution&&!id)throw new Error('Informe o protocolo para registrar uma conclusão.');
    if(!id) {
      await privateReply(i,store.complaints().map(r=>`**${r.id}** · ${safe(r.match_code)} · ${r.status==='open'?'🟠 Aberta':'✅ Encerrada'}`).join('\n')||'Nenhuma denúncia registrada.');return true;
    }
    const report=resolution?store.resolve(id,i.user.id,resolution):store.complaint(id);
    if(!report)throw new Error('Protocolo não encontrado.');
    const embed=new EmbedBuilder().setColor(0xFF3D2C).setTitle(`Denúncia ${report.id} · ${report.match_code}`)
      .setDescription(`**Mapa:** ${safe(report.map)}\n**Estado:** ${report.status==='open'?'Aberta':'Encerrada'}\n**Recebida em:** ${report.created_at} UTC\n**Autor:** <@${report.reporter_id}>\n**Jogador denunciado:** ${report.reported_id?`<@${report.reported_id}>`:'Não especificado'}\n\n**Relato:**\n${safe(report.reason,1400)}`+(report.resolution?`\n\n**Conclusão:**\n${safe(report.resolution,1400)}\n**Staff:** <@${report.reviewed_by}> · ${report.reviewed_at} UTC`:''));
    await i.reply({embeds:[embed],flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  }catch(error){await privateReply(i,safe(error.message,500));}
  return true;
}
module.exports={commands,handle};
