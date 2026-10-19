const {ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
function channelLink(guildId,channelId,label='Abrir canal correto',messageId=null) {
  if(!/^\d{17,20}$/.test(guildId||'')||!/^\d{17,20}$/.test(channelId||''))return [];
  const url=`https://discord.com/channels/${guildId}/${channelId}`+(/^\d{17,20}$/.test(messageId||'')?`/${messageId}`:'');
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url))];
}
function situationButton() {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("my_situation:refresh").setLabel("Ver minha situação").setStyle(ButtonStyle.Secondary))];
}
module.exports={channelLink,situationButton};
