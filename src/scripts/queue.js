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

const queueState = require(
  "./queueState"
);

const {
  startReadyCheck
} = require(
  "./ready"
);

const {
  logQueueJoin,
  logQueueLeave
} = require(
  "./logs"
);

/*
 * Processa os botões
 * da fila.
 */
async function handleQueue(
  interaction
) {
  const player =
    db.prepare(`
      SELECT *
      FROM players
      WHERE discord_id = ?
    `).get(
      interaction.user.id
    );

  /*
   * Somente jogadores
   * aprovados.
   */
  if (
    !player ||
    player.access_active !== 1
  ) {
    return interaction.reply({
      content:
        "Você não possui acesso ao matchmaking.",
      ephemeral: true
    });
  }

  /*
   * Jogador banido.
   */
  if (
    player.is_banned === 1
  ) {
    return interaction.reply({
      content:
        "Você está impedido de participar do matchmaking.",
      ephemeral: true
    });
  }

  /*
   * Durante a formação
   * da partida ninguém
   * pode entrar ou sair.
   */
  if (
    queueState.isQueueLocked()
  ) {
    return interaction.reply({
      content:
        "A fila está bloqueada enquanto uma partida está sendo formada.",
      ephemeral: true
    });
  }

  /*
   * Cooldown.
   */
  const remaining =
    queueState
      .getCooldownRemaining(
        interaction.user.id,
        config.matchmaking
          .queueCooldownSeconds
      );

  if (
    remaining > 0
  ) {
    const seconds =
      Math.ceil(
        remaining / 1000
      );

    return interaction.reply({
      content:
        `Aguarde **${seconds}s** antes de usar a fila novamente.`,
      ephemeral: true
    });
  }

  if (
    interaction.customId ===
    "queue_join"
  ) {
    return joinQueue(
      interaction,
      player
    );
  }

  if (
    interaction.customId ===
    "queue_leave"
  ) {
    return leaveQueue(
      interaction
    );
  }
}

/*
 * Entra na fila.
 */
async function joinQueue(
  interaction,
  player
) {
  const requiredPlayers =
    config.matchmaking
      .requiredPlayers;

  if (
    queueState.hasPlayer(
      interaction.user.id
    )
  ) {
    return interaction.reply({
      content:
        "Você já está na fila.",
      ephemeral: true
    });
  }

  /*
   * Verifica se o jogador
   * já está em uma partida.
   */
  const activeMatch =
    db.prepare(`
      SELECT
        matches.match_code

      FROM match_players

      INNER JOIN matches
        ON matches.id =
          match_players.match_id

      WHERE
        match_players.discord_id = ?

        AND matches.status IN (
          'playing',
          'pending_confirmation',
          'disputed'
        )

      LIMIT 1
    `).get(
      interaction.user.id
    );

  if (activeMatch) {
    return interaction.reply({
      content:
        `Você já participa da partida **${activeMatch.match_code}**.`,
      ephemeral: true
    });
  }

  /*
   * Impede ultrapassar
   * o limite.
   */
  if (
    queueState.getSize() >=
    requiredPlayers
  ) {
    return interaction.reply({
      content:
        "A fila já está completa.",
      ephemeral: true
    });
  }

  const added =
    queueState.addPlayer({
      discordId:
        interaction.user.id,

      nickname:
        player.r6_nickname,

      rank:
        player.r6_rank
    });

  if (!added) {
    return interaction.reply({
      content:
        "Não foi possível adicionar você à fila.",
      ephemeral: true
    });
  }

  /*
   * Inicia cooldown.
   */
  queueState.setCooldown(
    interaction.user.id
  );

  /*
   * Guarda a mensagem
   * principal da fila.
   */
  queueState.setQueueMessage(
    interaction.message
  );

  await interaction.update(
    createQueuePanel()
  );

  await interaction.followUp({
    content:
      `Você entrou na fila. (${queueState.getSize()}/${requiredPlayers})`,
    ephemeral: true
  });

  /*
   * Log.
   */
  await logQueueJoin(
    interaction,
    player,
    queueState.getSize(),
    requiredPlayers
  );

  /*
   * Fila completa.
   */
  if (
    queueState.getSize() ===
    requiredPlayers
  ) {
    queueState.lockQueue();

    await updateQueuePanel();

    const players =
      queueState.getPlayers();

    try {
      /*
       * Alerta público.
       */
      await interaction.followUp({
        content:
          createMatchFoundMessage(
            players
          ),
        allowedMentions: {
          users:
            players.map(
              (player) =>
                player.discordId
            )
        }
      });

      /*
       * Inicia Ready Check.
       */
      await startReadyCheck(
        interaction,
        players
      );
    } catch (error) {
      queueState.unlockQueue();

      await updateQueuePanel();

      console.error(
        "Erro ao iniciar Ready Check:",
        error
      );

      try {
        await interaction.followUp({
          content:
            "Não foi possível iniciar o Ready Check. A fila foi liberada novamente.",
          ephemeral: true
        });
      } catch {
        // A interação pode
        // já ter expirado.
      }
    }
  }
}

/*
 * Sai da fila.
 */
async function leaveQueue(
  interaction
) {
  const requiredPlayers =
    config.matchmaking
      .requiredPlayers;

  if (
    !queueState.hasPlayer(
      interaction.user.id
    )
  ) {
    return interaction.reply({
      content:
        "Você não está na fila.",
      ephemeral: true
    });
  }

  queueState.removePlayer(
    interaction.user.id
  );

  queueState.setCooldown(
    interaction.user.id
  );

  queueState.setQueueMessage(
    interaction.message
  );

  await interaction.update(
    createQueuePanel()
  );

  await interaction.followUp({
    content:
      `Você saiu da fila. (${queueState.getSize()}/${requiredPlayers})`,
    ephemeral: true
  });

  await logQueueLeave(
    interaction,
    queueState.getSize(),
    requiredPlayers
  );
}

/*
 * Mensagem enviada quando
 * encontramos os 10 jogadores.
 */
function createMatchFoundMessage(
  players
) {
  const mentions =
    players
      .map(
        (player) =>
          `<@${player.discordId}>`
      )
      .join(" ");

  return (
    "🔔 **PARTIDA ENCONTRADA!**\n\n" +
    `${mentions}\n\n` +
    "Os **10 jogadores** foram encontrados.\n" +
    "Confirmem presença no **Ready Check** abaixo."
  );
}

/*
 * Atualiza o painel
 * principal da fila.
 */
async function updateQueuePanel() {
  const queueMessage =
    queueState.getQueueMessage();

  if (!queueMessage) {
    return;
  }

  try {
    await queueMessage.edit(
      createQueuePanel()
    );
  } catch (error) {
    console.error(
      "Erro ao atualizar painel da fila:",
      error
    );
  }
}

/*
 * Cria o painel da fila.
 */
function createQueuePanel() {
  const players =
    queueState.getPlayers();

  const requiredPlayers =
    config.matchmaking
      .requiredPlayers;

  const locked =
    queueState.isQueueLocked();

  let playerList =
    "Nenhum jogador na fila.";

  if (
    players.length > 0
  ) {
    playerList =
      players
        .map(
          (
            player,
            index
          ) =>
            `**${index + 1}.** ` +
            `${player.nickname} — ` +
            `${player.rank}`
        )
        .join("\n");
  }

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Matchmaking 5v5"
      )
      .setDescription(
        locked
          ? "Uma partida está sendo formada. A fila está temporariamente bloqueada."
          : "Entre na fila para procurar uma partida competitiva."
      )
      .addFields(
        {
          name:
            "Jogadores na fila",

          value:
            `${queueState.getSize()}/${requiredPlayers}`,

          inline: true
        },

        {
          name:
            "Status",

          value:
            locked
              ? "🔒 Formando partida"
              : "🟢 Aberta",

          inline: true
        },

        {
          name:
            "Fila",

          value:
            playerList,

          inline: false
        }
      )
      .setFooter({
        text:
          "Rainbow Six Siege • Matchmaking"
      });

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "queue_join"
          )
          .setLabel(
            "Entrar na fila"
          )
          .setStyle(
            ButtonStyle.Success
          )
          .setDisabled(
            locked ||
            queueState.getSize() >=
              requiredPlayers
          ),

        new ButtonBuilder()
          .setCustomId(
            "queue_leave"
          )
          .setLabel(
            "Sair da fila"
          )
          .setStyle(
            ButtonStyle.Secondary
          )
          .setDisabled(
            locked
          )
      );

  return {
    embeds: [
      embed
    ],

    components: [
      buttons
    ]
  };
}

/*
 * Compatibilidade com
 * outros arquivos.
 */
function getQueue() {
  return queueState.getPlayers();
}

function getQueueSize() {
  return queueState.getSize();
}

function setQueueMessage(
  message
) {
  queueState.setQueueMessage(
    message
  );
}

function removePlayer(
  discordId
) {
  queueState.removePlayer(
    discordId
  );
}

function removePlayersFromQueue(
  discordIds
) {
  queueState.removePlayers(
    discordIds
  );
}

module.exports = {
  handleQueue,

  getQueue,
  getQueueSize,

  createQueuePanel,

  setQueueMessage,
  updateQueuePanel,

  removePlayer,
  removePlayersFromQueue,

  createMatchFoundMessage
};
