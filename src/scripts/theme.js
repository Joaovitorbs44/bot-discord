
const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require("discord.js");

const COLORS = {
  primary: 0xFF3D2C,
  success: 0x278451,
  danger: 0xE93425,
  neutral: 0x2B2D35
};

function createContainer(title, description) {
  return new ContainerBuilder()
    .setAccentColor(COLORS.primary)
    .addTextDisplayComponents(
      new TextDisplayBuilder()
        .setContent(`## ${title}`)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder()
        .setContent(description)
    );
}

function addDivider(container) {
  return container.addSeparatorComponents(
    new SeparatorBuilder()
      .setSpacing(SeparatorSpacingSize.Small)
      .setDivider(true)
  );
}

module.exports = {
  COLORS,
  createContainer,
  addDivider,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextDisplayBuilder
};
