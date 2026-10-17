
const {
  EmbedBuilder
} = require("discord.js");

const config = require("../config/config");

// ==========================================
// CONTROLE DE ERROS DE ACESSO
// ==========================================

const ACCESS_RETRY_MS = 5 * 60 * 1000;

let blockedUntil = 0;
let blockedChannelId = null;

// ==========================================
// ENVIAR LOG
// ==========================================

async function sendLog(
  client,
  {
    title,
    description = null,
    fields = [],
    footer = null
  }
) {
  const channelId =
    config.discord?.logChannelId;

  if (!client || !channelId) {
    return false;
  }

  if (blockedChannelId !== channelId) {
    blockedChannelId = channelId;
    blockedUntil = 0;
  }

  if (Date.now() < blockedUntil) {
    return false;
  }

  try {
    const channel =
      await client.channels.fetch(channelId);

    if (
      !channel ||
      !channel.isTextBased() ||
      typeof channel.send !== "function"
    ) {
      console.error(
        `[Logs] Canal ${channelId} não encontrado ou não aceita mensagens.`
      );

      blockedUntil =
        Date.now() + ACCESS_RETRY_MS;

      return false;
    }

    const embed = new EmbedBuilder()
      .setTitle(title || "Log")
      .setTimestamp();

    if (description) {
      embed.setDescription(description);
    }

    if (
      Array.isArray(fields) &&
      fields.length > 0
    ) {
      embed.addFields(fields);
    }

    if (footer) {
      embed.setFooter({
        text: footer
      });
    }

    await channel.send({
      embeds: [embed]
    });

    blockedUntil = 0;

    return true;
  } catch (error) {
    if (
      [50001, 50013, 10003].includes(
        Number(error.code)
      )
    ) {
      blockedUntil =
        Date.now() + ACCESS_RETRY_MS;

      console.error(
        `[Logs] Sem acesso ao canal ${channelId} ` +
        `(Discord ${error.code}). ` +
        "Confira o ID e as permissões Ver canal, " +
        "Enviar mensagens e Inserir links. " +
        "Nova tentativa em 5 minutos."
      );
    } else {
      console.error(
        "Erro ao enviar log:",
        error
      );
    }

    return false;
  }
}

// ==========================================
// ENTRADA NA FILA
// ==========================================

async function logQueueJoin(
  interaction,
  player,
  queueSize,
  requiredPlayers
) {
  return sendLog(interaction.client, {
    title: "Jogador entrou na fila",

    description:
      `<@${interaction.user.id}> entrou na fila do matchmaking.`,

    fields: [
      {
        name: "Nickname R6",
        value: player.r6_nickname || "—",
        inline: true
      },
      {
        name: "Rank",
        value: player.r6_rank || "—",
        inline: true
      },
      {
        name: "Fila",
        value: `${queueSize}/${requiredPlayers}`,
        inline: true
      }
    ]
  });
}

// ==========================================
// SAÍDA DA FILA
// ==========================================

async function logQueueLeave(
  interaction,
  queueSize,
  requiredPlayers
) {
  return sendLog(interaction.client, {
    title: "Jogador saiu da fila",

    description:
      `<@${interaction.user.id}> saiu da fila do matchmaking.`,

    fields: [
      {
        name: "Fila",
        value: `${queueSize}/${requiredPlayers}`,
        inline: true
      }
    ]
  });
}

// ==========================================
// REMOÇÃO PELA STAFF
// ==========================================

async function logQueueRemoval(
  interaction,
  targetUser
) {
  return sendLog(interaction.client, {
    title: "Jogador removido da fila",

    description:
      `<@${targetUser.id}> foi removido manualmente da fila.`,

    fields: [
      {
        name: "Removido por",
        value: `<@${interaction.user.id}>`,
        inline: true
      },
      {
        name: "Jogador",
        value: `<@${targetUser.id}>`,
        inline: true
      }
    ]
  });
}

// ==========================================
// READY CHECK INICIADO
// ==========================================

async function logReadyCheckStarted(
  client,
  players
) {
  const playerList = players
    .map(
      player => `<@${player.discordId}>`
    )
    .join("\n");

  return sendLog(client, {
    title: "Ready Check iniciado",

    description:
      "A fila atingiu o número necessário de jogadores.",

    fields: [
      {
        name: "Jogadores",
        value: playerList || "—",
        inline: false
      }
    ]
  });
}

// ==========================================
// READY CHECK EXPIRADO
// ==========================================

async function logReadyCheckTimeout(
  client,
  missingPlayers
) {
  const playerList =
    missingPlayers.length > 0
      ? missingPlayers
          .map(
            player =>
              `<@${player.discordId}> — ${player.nickname}`
          )
          .join("\n")
      : "Nenhum.";

  return sendLog(client, {
    title: "Ready Check expirado",

    description:
      "Nem todos os jogadores confirmaram dentro do tempo.",

    fields: [
      {
        name: "Removidos da fila",
        value: playerList,
        inline: false
      }
    ]
  });
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  sendLog,

  logQueueJoin,
  logQueueLeave,
  logQueueRemoval,

  logReadyCheckStarted,
  logReadyCheckTimeout
};
