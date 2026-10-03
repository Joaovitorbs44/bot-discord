const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const db = require(
  "../database/database"
);

const config = require(
  "../config/config"
);

function isStaff(interaction) {
  if (!interaction.member) {
    return false;
  }

  if (
    interaction.member.roles &&
    interaction.member.roles.cache
  ) {
    return interaction.member.roles.cache.has(
      config.discord.staffRoleId
    );
  }

  if (
    Array.isArray(
      interaction.member.roles
    )
  ) {
    return interaction.member.roles.includes(
      config.discord.staffRoleId
    );
  }

  return false;
}

function createRequestMessage(request) {
  const embed =
    new EmbedBuilder()
      .setTitle(
        "Solicitação pendente"
      )
      .setDescription(
        "Esta solicitação está aguardando análise da Staff."
      )
      .addFields(
        {
          name: "Usuário",
          value:
            `<@${request.discord_id}>`,
          inline: false
        },
        {
          name: "Nome",
          value:
            request.name ||
            "Não informado",
          inline: true
        },
        {
          name: "Twitch",
          value:
            request.twitch_nickname
              ? `@${request.twitch_nickname}`
              : "Não informado",
          inline: true
        },
        {
          name: "Nickname R6",
          value:
            request.r6_nickname ||
            "Não informado",
          inline: true
        },
        {
          name: "Rank R6",
          value:
            request.r6_rank ||
            "Não informado",
          inline: true
        }
      )
      .setFooter({
        text:
          `Solicitação #${request.id}`
      })
      .setTimestamp();

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `access_approve:${request.id}`
          )
          .setLabel(
            "Aprovar"
          )
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `access_reject:${request.id}`
          )
          .setLabel(
            "Rejeitar"
          )
          .setStyle(
            ButtonStyle.Danger
          )
      );

  return {
    embeds: [embed],
    components: [buttons]
  };
}

async function handleSolicitacoes(
  interaction
) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content:
        "Apenas membros da Staff podem usar este comando.",
      ephemeral: true
    });
  }

  await interaction.deferReply({
    ephemeral: true
  });

  const requests =
    db.prepare(`
      SELECT *
      FROM access_requests
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `).all();

  if (requests.length === 0) {
    return interaction.editReply({
      content:
        "Não existem solicitações pendentes."
    });
  }

  const staffChannel =
    await interaction.guild
      .channels.fetch(
        config.discord.staffChannelId
      );

  if (
    !staffChannel ||
    !staffChannel.isTextBased()
  ) {
    return interaction.editReply({
      content:
        "O canal da Staff não foi encontrado."
    });
  }

  let sent = 0;

  for (const request of requests) {
    try {
      await staffChannel.send(
        createRequestMessage(
          request
        )
      );

      sent++;
    } catch (error) {
      console.error(
        `Erro ao reenviar solicitação #${request.id}:`,
        error
      );
    }
  }

  if (sent === 0) {
    return interaction.editReply({
      content:
        "Não foi possível enviar as solicitações pendentes para o canal da Staff."
    });
  }

  return interaction.editReply({
    content:
      `${sent} solicitação(ões) pendente(s) enviada(s) para <#${config.discord.staffChannelId}>.`
  });
}

module.exports =
  handleSolicitacoes;
