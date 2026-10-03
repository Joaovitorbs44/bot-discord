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

/*
 * Processa os botões da fila.
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
   * Somente jogadores aprovados
   * e com acesso ativo.
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
   * Durante a formação da partida,
   * ninguém pode entrar ou sair.
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
    config.matchmaking.requiredPlayers;

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
   * Não permite entrar se já
   * estiver em uma partida ativa.
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
   * Segurança para impedir
   * mais jogadores que o limite.
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
   * Guarda a mensagem original
   * do painel.
   */
  queueState.setQueueMessage(
    interaction.message
  );

  /*
   * Atualiza imediatamente
   * a interação do botão.
   */
  await interaction.update(
    createQueuePanel()
  );

  await interaction.followUp({
    content:
      `Você entrou na fila. (${queueState.getSize()}/${requiredPlayers})`,
    ephemeral: true
  });

  /*
   * Ao atingir o número necessário,
   * a fila é bloqueada.
   */
  if (
    queueState.getSize() ===
    requiredPlayers
  ) {
    queueState.lockQueue();

    await updateQueuePanel();

    try {
      await startReadyCheck(
        interaction,
        queueState.getPlayers()
      );
    } catch (error) {
      /*
       * Se o Ready Check não
       * conseguir iniciar, a fila
       * precisa voltar a funcionar.
       */
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
        // A interação pode já ter expirado.
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
    config.matchmaking.requiredPlayers;

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
}

/*
 * Atualiza o painel principal.
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
    config.matchmaking.requiredPlayers;

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
 * Funções mantidas para
 * compatibilidade com outros
 * arquivos do projeto.
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
  removePlayersFromQueue
};