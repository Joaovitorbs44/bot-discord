const {SlashCommandBuilder,MessageFlags,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
const config=require('../config/config');
const {snapshot}=require('../services/playerSituation');
const {channelLink}=require('../ui/guidance');
const {safe}=require('../services/competitiveStats');
const command=new SlashCommandBuilder().setName('situacao').setDescription('Veja sua fila, partida, confirmação e penalidade em privado.').setDMPermission(false);
function view(i) {
  const s=snapshot(i.guildId,i.user.id),c=config.discord;
  const lines=[];let channel=c.queueChannelId,messageId=null,label='Abrir fila';
  if(!s.player||s.player.access_active!==1){lines.push('**Acesso pendente:** solicite seu acesso e aguarde a aprovação da staff.');channel=c.accessChannelId;label='Solicitar acesso';}
  else if(s.player.is_banned){lines.push('**Acesso bloqueado:** procure a staff para entender o motivo e solicitar uma revisão.');channel=c.accessChannelId;label='Abrir canal de acesso';}
  else lines.push('**Acesso:** aprovado.');
  if(s.penalty)lines.push(`**Penalidade ativa:** ${safe(s.penalty.reason,250)}\nVocê poderá voltar à fila em <t:${Math.ceil(s.penalty.expires_at/1000)}:F> (<t:${Math.ceil(s.penalty.expires_at/1000)}:R>).`);
  if(s.match){
    lines.push(`**Partida ${safe(s.match.match_code)} · ${safe(s.match.map)}**\n`+({playing:'Em andamento. Ao terminar, os capitães informam o resultado.',pending_confirmation:'Pendente: aguardando confirmação do resultado pelo outro capitão.',disputed:'Em disputa: aguardando decisão da staff.'}[s.match.status]));
    channel=c.resultsChannelId;label='Abrir resultados';
  } else if(s.session&&s.session.stage!=='queue') {
    const stage=s.session.stage;
    const stages={ready_check:'Confirmar presença',captain_vote:'Votação de capitães',draft:'Escolha dos jogadores',map_veto:'Banimento de mapas',side_choice:'Escolha do lado',playing:'Partida em andamento'};
    lines.push(`**Lobby #${s.session.id}:** ${stages[stage]||'Em preparação'}.`);
    if(stage==='ready_check')lines.push(s.session.ready_confirmed?'**Presença confirmada.** Aguarde os demais jogadores.':'**Presença pendente.** Abra o canal e clique em “Confirmar presença”.');
    if(s.session.deadline_at)lines.push(`Prazo: <t:${Math.ceil(s.session.deadline_at/1000)}:F> (<t:${Math.ceil(s.session.deadline_at/1000)}:R>).`);
    channel=['map_veto','side_choice'].includes(stage)?c.mapVetoChannelId:stage==='playing'?c.resultsChannelId:c.draftChannelId;
    label=['map_veto','side_choice'].includes(stage)?'Abrir banimento de mapas':stage==='playing'?'Abrir resultados':'Abrir seleção de jogadores';
    try{const state=JSON.parse(s.session.state_json||'{}');const key={ready_check:'readyCheckPanel',captain_vote:'captainVotePanel',draft:'draftPanel',map_veto:'mapVetoPanel',side_choice:'sideChoicePanel'}[stage];if(state[key]?.channelId===channel)messageId=state[key].messageId;}catch{}
  } else if(s.position)lines.push(`**Na fila:** posição ${s.position} · ${s.total} jogadores aguardando.\nAguarde a formação da partida e a confirmação de presença.`);
  else if(s.player?.access_active===1&&!s.player.is_banned&&!s.penalty)lines.push('**Disponível para jogar.** Abra a fila e clique em “Entrar na fila”.');
  const embed=new EmbedBuilder().setColor(0xFF3D2C).setTitle('Minha situação').setDescription(lines.join('\n\n')).setFooter({text:'Consulta privada. Atualize para consultar seu estado atual.'});
  const refresh=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('my_situation:refresh').setLabel('Atualizar minha situação').setStyle(ButtonStyle.Secondary));
  return {content:"",embeds:[embed],components:[...channelLink(i.guildId,channel,label,messageId),refresh],allowedMentions:{parse:[]}};
}
async function handle(i) {
  const refresh=i.customId==='my_situation:refresh';
  if(!(i.isChatInputCommand()&&i.commandName==='situacao')&&!refresh)return false;
  if(!i.inGuild()||i.guildId!==config.discord.guildId){await i.reply({content:'Abra este comando no servidor do INVI SIX PRO.',flags:MessageFlags.Ephemeral});return true;}
  const payload=view(i);
  if(refresh&&i.message.flags.has(MessageFlags.Ephemeral))await i.update(payload);
  else await i.reply({...payload,flags:MessageFlags.Ephemeral});
  return true;
}
module.exports={command,handle};
