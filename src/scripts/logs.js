const {
  EmbedBuilder
} = require("discord.js");

const config = require(
  "../config/config"
);

/*
 * Envia um log para o canal
 * configurado da Staff.
 */
async function sendLog(
  client,
  {
    title,
    description = null,
    fields = [],
    footer = null
  }
) {
  if (
    !client ||
    !config.discord.logChannelId
  ) {
    return false;
  }

  try {
    const channel =
      await client.channels.fetch(
        config.discord.logChannelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      console.error(
        "Canal de logs não encontrado ou não é um canal de texto."
      );

      return false;
    }

    const embed =
      new EmbedBuilder()
        .setTitle(
          title || "Log"
        )
        .setTimestamp();

    if (description) {
      embed.setDescription(
        description
      );
    }

    if (
      Array.isArray(fields) &&
      fields.length > 0
    ) {
      embed.addFields(
        fields
      );
    }

    if (footer) {
      embed.setFooter({
        text: footer
      });
    }

    await channel.send({
      embeds: [embed]
    });

    return true;
  } catch (error) {
    console.error(
      "Erro ao enviar log:",
      error
    );

    return false;
  }
}

/*
 * Log de entrada na fila.
 */
async function logQueueJoin(
  interaction,
  player,
  queueSize,
  requiredPlayers
) {
  return sendLog(
    interaction.client,
    {
      title:
        "Jogador entrou na fila",

      description:
        `<@${interaction.user.id}> entrou na fila do matchmaking.`,

      fields: [
        {
          name: "Nickname R6",
          value:
            player.r6_nickname || "—",
          inline: true
        },
        {
          name: "Rank",
          value:
            player.r6_rank || "—",
          inline: true
        },
        {
          name: "Fila",
          value:
            `${queueSize}/${requiredPlayers}`,
          inline: true
        }
      ]
    }
  );
}

/*
 * Log de saída da fila.
 */
async function logQueueLeave(
  interaction,
  queueSize,
  requiredPlayers
) {
  return sendLog(
    interaction.client,
    {
      title:
        "Jogador saiu da fila",

      description:
        `<@${interaction.user.id}> saiu da fila do matchmaking.`,

      fields: [
        {
          name: "Fila",
          value:
            `${queueSize}/${requiredPlayers}`,
          inline: true
        }
      ]
    }
  );
}

/*
 * Log de remoção manual
 * realizada pela Staff.
 */
async function logQueueRemoval(
  interaction,
  targetUser
) {
  return sendLog(
    interaction.client,
    {
      title:
        "Jogador removido da fila",

      description:
        `<@${targetUser.id}> foi removido manualmente da fila.`,

      fields: [
        {
          name: "Removido por",
          value:
            `<@${interaction.user.id}>`,
          inline: true
        },
        {
          name: "Jogador",
          value:
            `<@${targetUser.id}>`,
          inline: true
        }
      ]
    }
  );
}

/*
 * Log de Ready Check iniciado.
 */
async function logReadyCheckStarted(
  client,
  players
) {
  const playerList =
    players
      .map(
        (player) =>
          `<@${player.discordId}>`
      )
      .join("\n");

  return sendLog(
    client,
    {
      title:
        "Ready Check iniciado",

      description:
        "A fila atingiu o número necessário de jogadores.",

      fields: [
        {
          name: "Jogadores",
          value:
            playerList || "—",
          inline: false
        }
      ]
    }
  );
}

/*
 * Log de Ready Check expirado.
 */
async function logReadyCheckTimeout(
  client,
  missingPlayers
) {
  const playerList =
    missingPlayers.length > 0
      ? missingPlayers
          .map(
            (player) =>
              `<@${player.discordId}> — ${player.nickname}`
          )
          .join("\n")
      : "Nenhum.";

  return sendLog(
    client,
    {
      title:
        "Ready Check expirado",

      description:
        "Nem todos os jogadores confirmaram dentro do tempo.",

      fields: [
        {
          name:
            "Removidos da fila",
          value:
            playerList,
          inline: false
        }
      ]
    }
  );
}

module.exports = {
  sendLog,

  logQueueJoin,
  logQueueLeave,
  logQueueRemoval,

  logReadyCheckStarted,
  logReadyCheckTimeout
};
