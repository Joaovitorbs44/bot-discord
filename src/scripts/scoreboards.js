const { matchTeam } = require("../services/teamLabels");
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const db = require("../database/database");
const config = require("../config/config");
const store = require("../services/scoreboardStore");
const ocr = require("../services/scoreboardOcr");
const { safe } = require("../services/competitiveStats");
const RESULTS = "1555941357061804145";
let processing = false;
const commands = [
  new SlashCommandBuilder().setName("placar").setDescription("Envia o placar para revisão do K/D pela staff.").setDMPermission(false)
    .addStringOption(o=>o.setName("codigo").setDescription("Código da partida do bot.").setRequired(true))
    .addAttachmentOption(o=>o.setName("imagem").setDescription("Print do placar final; envio privado."))
    .addStringOption(o=>o.setName("mensagem").setDescription("Ou ID da mensagem com o print já enviado neste canal.")),
  new SlashCommandBuilder().setName("partidas").setDescription("Staff: revisa placares e consulta imagens arquivadas.").setDMPermission(false)
    .addStringOption(o=>o.setName("codigo").setDescription("Código para abrir o placar; vazio lista os últimos 10."))
];
function isStaff(i) { return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator) || i.member?.roles?.cache?.has(config.discord.staffRoleId) || (Array.isArray(i.member?.roles)&&i.member.roles.includes(config.discord.staffRoleId))); }
function staffAccess(i) { return i.inGuild() && i.guildId===config.discord.guildId && isStaff(i); }
function findMatch(code) { return store.match(code) || store.match("#"+String(code).replace(/^#/,"")); }
const fail = (i,content) => i.reply({content,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
function archiveRoot() { return path.join(path.dirname(db.name), "scoreboards"); }
function archivedFile(report) {
  const root=path.resolve(archiveRoot()),file=path.resolve(report.image_path);
  if(path.dirname(file)!==root || !/^[a-f0-9]{64}\.png$/.test(path.basename(file)))throw new Error("Caminho da imagem arquivada inválido.");
  return file;
}
async function download(attachment) {
  if(attachment.size>8*1024*1024)throw new Error("A imagem deve ter até 8 MB.");
  const url=new URL(attachment.url);
  if(url.protocol!=="https:"||!["cdn.discordapp.com","media.discordapp.net"].includes(url.hostname))throw new Error("Envie um anexo de imagem do Discord.");
  const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error("Não foi possível baixar o anexo.");
  const chunks=[];let size=0;
  for await(const chunk of response.body) {
    size+=chunk.length;
    if(size>8*1024*1024){await response.body.cancel().catch(()=>{});throw new Error("A imagem deve ter até 8 MB.");}
    chunks.push(chunk);
  }
  const original=Buffer.concat(chunks);
  const metadata=await sharp(original,{limitInputPixels:20000000}).metadata();
  if(!["jpeg","png","webp"].includes(metadata.format)||metadata.pages>1)throw new Error("Envie um print PNG, JPG ou WebP estático.");
  return {hash:crypto.createHash("sha256").update(original).digest("hex"),buffer:await sharp(original,{limitInputPixels:20000000}).png().toBuffer()};
}
async function sendScoreboard(i) {
  if(!i.inGuild() || i.guildId!==config.discord.guildId || (i.channelId!==RESULTS && !staffAccess(i)))return fail(i,`Envie o placar em <#${RESULTS}>.`);
  const match=findMatch(i.options.getString("codigo",true));
  if(!match)return fail(i,"Partida não encontrada. Use o código gerado pelo bot.");
  if(!isStaff(i)&&![match.captain_a_discord_id,match.captain_b_discord_id].includes(i.user.id))return fail(i,"Somente os capitães desta partida ou a staff podem enviar o placar.");
  if(match.status==="cancelled")return fail(i,"Não é possível registrar K/D de uma partida cancelada.");
  const previous=store.forMatch(match.id);
  if(previous&&previous.status!=="rejected")return fail(i,"Esta partida já possui um placar. A staff pode consultá-lo com /partidas.");
  if(processing)return fail(i,"Outra imagem está sendo processada. Tente novamente em instantes.");
  let attachment=i.options.getAttachment("imagem");
  const messageId=i.options.getString("mensagem");
  if(Boolean(attachment)===Boolean(messageId))return fail(i,"Informe a imagem OU o ID da mensagem com o print.");
  if(messageId&&!/^\d{17,20}$/.test(messageId))return fail(i,"ID de mensagem inválido.");
  processing=true;
  let file;
  try {
    await i.deferReply({flags:MessageFlags.Ephemeral});
    let source;
    if(messageId) {
      if(i.channelId!==RESULTS)throw new Error("Para vincular uma mensagem, execute /placar no canal resultados.");
      source=await i.channel.messages.fetch(messageId);
      if(!isStaff(i)&&source.author.id!==i.user.id)throw new Error("O print precisa estar em uma mensagem sua.");
      if(source.attachments.size!==1)throw new Error("A mensagem deve conter exatamente um print.");
      attachment=source.attachments.first();
    }
    const players=store.roster(match.id);
    if(players.length!==10)throw new Error("A partida precisa ter 10 jogadores cadastrados.");
    const image=await download(attachment);
    let result={rows:players.map(p=>({discordId:p.discord_id,kills:null,deaths:null})),text:""};
    let note=null;
    try { result=await ocr.extract(image.buffer,players); }
    catch(error){note="Leitura automática incompleta. Preencha os campos manualmente.";console.warn("[K/D] OCR:",error.message);}
    fs.mkdirSync(archiveRoot(),{recursive:true,mode:0o700});
    file=path.join(archiveRoot(),image.hash+".png");
    fs.writeFileSync(file,image.buffer,{mode:0o600});
    const report=store.submit({matchId:match.id,hash:image.hash,path:file,submitter:i.user.id,channelId:source?.channelId,messageId:source?.id,rows:result.rows,note});
    const complete=result.rows.filter(r=>r.kills!==null&&r.deaths!==null).length;
    await i.editReply({content:`Placar de **${safe(report.match_code)}** arquivado para revisão. Leitura: **${complete}/10 jogadores**.\nA staff deve usar **/partidas codigo:${safe(report.match_code)}** no painel-staff para conferir e aprovar. Nenhuma estatística foi alterada.`,allowedMentions:{parse:[]}});
  } catch(error) {
    console.warn("[K/D] Envio:",error.message);
    // Keep an archive only when a report actually references it.
    if(file&&!db.prepare("SELECT 1 FROM scoreboard_reports WHERE image_path=?").get(file))fs.rmSync(file,{force:true});
    if(i.deferred)await i.editReply({content:`Não foi possível registrar o placar: ${safe(error.message,350)}`});else throw error;
  } finally {processing=false;}
}
function view(report) {
  const players=store.roster(report.match_id),rows=JSON.parse(report.rows_json);
  const match=store.match(report.match_code);
  const approved=report.status==="approved";
  const audit=approved ? store.corrections(report.id) : [];
  const status={approved:"✅ K/D aprovado",pending:"⏳ Aguardando revisão",rejected:"❌ Placar rejeitado"}[report.status]||report.status;
  const winner=match?.winner_team ? matchTeam(db,match,match.winner_team) : "Não definido";
  const description=[
    `**${status}**`,
    `**Vencedor da partida:** ${winner}`,
    approved ? "Estatísticas registradas. Nenhuma ação pendente." : report.status==="pending"
      ? "Confira a imagem e os 10 jogadores. Use o seletor para corrigir os campos antes de aprovar."
      : "Este envio não entra nas estatísticas.",
    report.status==="pending" ? report.ocr_note : null,
    audit.length ? "\n**Últimas correções (UTC):**\n"+audit.map(a=>`<@${a.staff_id}> · <@${a.discord_id}> · ${a.old_kills}/${a.old_deaths} → ${a.new_kills}/${a.new_deaths} · ${a.created_at}\n${safe(a.reason,180)}`).join("\n") : null
  ].filter(Boolean).join("\n");
  const teamFields=["A","B"].map(team=>{
    const captainId=team==="A"?match?.captain_a_discord_id:match?.captain_b_discord_id;
    const roster=players.filter(player=>player.team===team)
      .sort((a,b)=>Number(b.discord_id===captainId)-Number(a.discord_id===captainId));
    const value=roster.map(player=>{
      const row=rows.find(item=>item.discordId===player.discord_id);
      const name=`${player.discord_id===captainId?"👑 ":""}**${safe(player.r6_nickname,40)}**`;
      if(!row||row.kills===null||row.deaths===null)return name+"\n⚠️ Kills e mortes pendentes";
      const kd=row.deaths?(row.kills/row.deaths).toFixed(2).replace(".",","):(row.kills?"∞":"0,00");
      return name+`\n${row.kills} kills · ${row.deaths} mortes · **${kd} K/D**`;
    }).join("\n\n");
    return {name:`${team==="A"?"🟠":"🔵"} ${matchTeam(db,match,team,true)}`,value:value||"Nenhum jogador registrado.",inline:false};
  });
  const embed=new EmbedBuilder().setColor(approved?0x278451:report.status==="rejected"?0x454650:0xFF3D2C)
    .setTitle(`Partida ${report.match_code} · ${report.map}`)
    .setDescription(description).addFields(teamFields)
    .setFooter({text:"K/D desta partida. /perfil e /ranking mostram o acumulado da temporada."})
    .setImage("attachment://placar.png");
  const components=[];
  if(["pending","approved"].includes(report.status)) {
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`kd:choose:${report.id}`).setPlaceholder("Corrigir kills e mortes de um jogador").addOptions(players.map(p=>({label:p.r6_nickname.slice(0,100),value:p.discord_id})))));
  }
  if(report.status==="pending") {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kd:approve:${report.id}`).setLabel("Conferi os 10 jogadores — Aprovar").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kd:reject:${report.id}`).setLabel("Rejeitar placar").setStyle(ButtonStyle.Danger)));
  }
  return {embeds:[embed],files:[new AttachmentBuilder(archivedFile(report),{name:"placar.png"})],components,allowedMentions:{parse:[]}};
}
async function removeSource(i,report) {
  if(!report.source_message_id)return true;
  try {
    const channel=await i.client.channels.fetch(report.source_channel_id);
    const message=await channel.messages.fetch(report.source_message_id);
    await message.delete();return true;
  }catch(error){if(error.code===10008)return true;console.warn("[K/D] Não foi possível apagar envio:",error.message);return false;}
}
async function history(i) {
  if(!staffAccess(i))return fail(i,"Consulta exclusiva da staff.");
  const code=i.options.getString("codigo");
  if(!code) {
    const reports=store.recent();
    return i.reply({content:reports.map(r=>`**${safe(r.match_code)}** · ${safe(r.map)} · ${{approved:"✅ Aprovado",pending:"⏳ Aguardando revisão",rejected:"❌ Rejeitado"}[r.status]||r.status}`).join("\n")||"Nenhum placar enviado. Use /partidas codigo:... para abrir uma imagem arquivada.",flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  }
  const match=findMatch(code),report=match&&store.forMatch(match.id);
  if(!report)return fail(i,"Esta partida ainda não possui um placar enviado.");
  await i.deferReply({flags:MessageFlags.Ephemeral});
  if(report.status==="approved")await removeSource(i,report);
  await i.editReply(view(store.get(report.id)));
}
async function handle(i) {
  if(!i.customId?.startsWith("kd:"))return false;
  if(!staffAccess(i)){await fail(i,"Revisão exclusiva da staff.");return true;}
  const [,action,rawId,playerId,oldKills,oldDeaths]=i.customId.split(":");
  if(!/^\d+$/.test(rawId)){await fail(i,"Placar inválido.");return true;}
  const report=store.get(Number(rawId));
  if(!report){await fail(i,"Placar não encontrado.");return true;}
  try {
    if(action==="choose"&&i.isStringSelectMenu()) {
      if(!["pending","approved"].includes(report.status))throw new Error("Este placar não pode ser corrigido.");
      const id=i.values[0],row=JSON.parse(report.rows_json).find(r=>r.discordId===id);
      if(!row)throw new Error("Jogador inválido.");
      const modal=new ModalBuilder().setCustomId(report.status==="approved"?`kd:amend:${report.id}:${id}:${row.kills}:${row.deaths}`:`kd:edit:${report.id}:${id}`).setTitle("Corrigir K/D");
      for(const [key,label,value] of [["kills","Kills",row.kills],["deaths","Mortes",row.deaths]]) {
        const input=new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2);
        if(value!==null)input.setValue(String(value));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      }
      if(report.status==="approved")modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel("Motivo da correção (fica registrado)").setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(5).setMaxLength(300)));
      await i.showModal(modal);return true;
    }
    if(["edit","amend"].includes(action)&&i.isModalSubmit()) {
      const k=i.fields.getTextInputValue("kills").trim(),d=i.fields.getTextInputValue("deaths").trim();
      if(!/^\d{1,2}$/.test(k)||!/^\d{1,2}$/.test(d))throw new Error("Use inteiros de 0 a 99.");
      if(action==="amend") {
        if(!/^\d{1,2}$/.test(oldKills||"")||!/^\d{1,2}$/.test(oldDeaths||""))throw new Error("Abra /partidas novamente para corrigir.");
        store.amend(report.id,playerId,Number(k),Number(d),i.user.id,i.fields.getTextInputValue("reason"),Number(oldKills),Number(oldDeaths));
      } else {
        store.correct(report.id,playerId,Number(k),Number(d));
      }
      await i.deferUpdate();
      await i.editReply({...view(store.get(report.id)),attachments:[]});return true;
    }
    if(action==="approve"&&i.isButton()) {
      // Archive existence is verified before committing any statistics.
      fs.accessSync(archivedFile(report),fs.constants.R_OK);
      const approved=store.approve(report.id,i.user.id);
      await i.deferUpdate();
      const deleted=await removeSource(i,approved);
      await i.editReply({content:`K/D de **${safe(report.match_code)}** aprovado e registrado uma única vez.\n${deleted?"Envio original removido (quando existente).":"Não consegui apagar o envio original. Confira a permissão Gerenciar mensagens e abra /partidas novamente para tentar."}\nImagem disponível somente na consulta privada /partidas.`,embeds:[],components:[],attachments:[],allowedMentions:{parse:[]}});return true;
    }
    if(action==="reject"&&i.isButton()) {
      store.reject(report.id,i.user.id);
      await i.update({content:"Placar rejeitado. Nenhum K/D foi somado; o capitão pode enviar um novo print.",embeds:[],components:[],attachments:[]});return true;
    }
    throw new Error("Ação inválida.");
  } catch(error) {
    const payload={content:safe(error.message,350),flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}};
    if(i.deferred||i.replied)await i.followUp(payload);else await i.reply(payload);
  }
  return true;
}
module.exports={commands,sendScoreboard,history,handle,isStaff,staffAccess};
