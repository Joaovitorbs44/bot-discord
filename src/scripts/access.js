const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require("discord.js");

async function handleAccessRequestButton(
  interaction
) {
  const modal =
    new ModalBuilder()
      .setCustomId("access_modal")
      .setTitle("Solicitar acesso");

  const nameInput =
    new TextInputBuilder()
      .setCustomId("name")
      .setLabel("Seu nome")
      .setPlaceholder("Ex: João Vitor")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(50);

  const twitchInput =
    new TextInputBuilder()
      .setCustomId("twitch_nickname")
      .setLabel("Nickname da Twitch")
      .setPlaceholder("Ex: h4ckzera")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(30);

  const nicknameInput =
    new TextInputBuilder()
      .setCustomId("r6_nickname")
      .setLabel("Nickname no Rainbow Six")
      .setPlaceholder("Ex: h4ckzera")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(30);

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(nameInput),

    new ActionRowBuilder()
      .addComponents(twitchInput),

    new ActionRowBuilder()
      .addComponents(nicknameInput)
  );

  await interaction.showModal(
    modal
  );
}

module.exports =
  handleAccessRequestButton;