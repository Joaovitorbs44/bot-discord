const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const config = require(
  "../config/config"
);

const db = require(
  "../database/database"
);

const queueState = require(
  "./queueState"
);

const {
  updateQueuePanel
} = require(
  "./queue"
);

const {
  cancelReadyCheck,
  getReadyCheckPlayers
} = require(
  "./ready"
);

const {
  resetCaptainVote,
  getCaptainPlayers
} = require(
  "./captains"
);

const {
  resetDraft,
  getTeams
} = require(
  "./drafts"
);

const {
  resetMapVeto,
  getVetoData
} = require(
  "./mapVeto"
);

const {
  resetSideChoice,
  getMatchSetup
} = require(
  "./side"
);

/*
 * Verifica se o usuário
 * possui o cargo da Staff.
 */
function isStaff(
  interaction
) {
  if (
    !interaction.member
  ) {
    return false;
  }

  if (
    interaction.member.roles &&
    interaction.member.roles.cache
  ) {
    return interaction.member
      .roles.cache.has(
        config.discord.staffRoleId
      );
  }

  if (
    Array.isArray(
      interaction.member.roles
    )
  ) {
    return interaction.member
      .roles.includes(
        config.discord.staffRoleId
      );
  }

  return false;
}

/*
 * /limpar-fila
 *
 * Primeiro pede confirmação.
 */
async function handleClearQueueCommand(
  interaction
) {
  if (
    !isStaff(
      interaction
    )
  ) {
    return interaction.reply({
      content:
        "Apenas membros da Staff podem limpar a fila.",

      ephemeral: true
    });
  }

  const embed =
    new EmbedBuilder()
      .setTitle(
        "Limpar matchmaking"
      )
      .setDescription(
        "Essa ação irá limpar completamente a fila e cancelar qualquer formação de partida que esteja em andamento.\n\n" +
        "Se a formação já tiver criado uma partida ativa, ela também será marcada como **cancelada**.\n\n" +
        "**Nenhum ponto será alterado.**"
      )
      .setFooter({
        text:
          "Essa ação não pode ser desfeita."
      });

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "clear_queue_confirm"
          )
          .setLabel(
            "Confirmar"
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "clear_queue_cancel"
          )
          .setLabel(
            "Cancelar"
          )
          .setStyle(
            ButtonStyle.Secondary
          )
      );

  return interaction.reply({
    embeds: [
      embed
    ],

    components: [
      buttons
    ],

    ephemeral: true
  });
}

/*
 * Confirma o reset.
 */
async function handleClearQueueConfirm(
  interaction
) {
  if (
    !isStaff(
      interaction
    )
  ) {
    return interaction.reply({
      content:
        "Apenas membros da Staff podem limpar a fila.",

      ephemeral: true
    });
  }

  /*
   * Confirma imediatamente a
   * interação para evitar
   * "A aplicação não respondeu".
   */
  await interaction.deferUpdate();

  /*
   * IMPORTANTE:
   *
   * Precisamos descobrir os
   * jogadores envolvidos ANTES
   * de apagar os estados.
   */
  const formationPlayerIds =
    collectFormationPlayerIds();

  const queueSizeBefore =
    queueState.getSize();

  /*
   * Cancela eventual partida
   * ativa correspondente à
   * formação atual.
   */
  const cancelledMatches =
    cancelFormationMatches(
      formationPlayerIds
    );

  /*
   * Cancela Ready Check.
   */
  try {
    await cancelReadyCheck();
  } catch (error) {
    console.error(
      "Erro ao cancelar Ready Check:",
      error
    );
  }

  /*
   * Reseta todas as etapas.
   */
  try {
    resetCaptainVote();
  } catch (error) {
    console.error(
      "Erro ao resetar votação de capitães:",
      error
    );
  }

  try {
    resetDraft();
  } catch (error) {
    console.error(
      "Erro ao resetar draft:",
      error
    );
  }

  try {
    resetMapVeto();
  } catch (error) {
    console.error(
      "Erro ao resetar veto:",
      error
    );
  }

  try {
    resetSideChoice();
  } catch (error) {
    console.error(
      "Erro ao resetar escolha de lado:",
      error
    );
  }

  /*
   * Limpa fila e cooldowns.
   *
   * A versão atualizada do
   * queueState.clearQueue()
   * também limpa cooldowns.
   */
  queueState.clearQueue();

  /*
   * Garante que a fila
   * fique aberta.
   */
  queueState.unlockQueue();

  /*
   * Atualiza painel 0/10.
   */
  try {
    await updateQueuePanel();
  } catch (error) {
    console.error(
      "Erro ao atualizar painel após limpar fila:",
      error
    );
  }

  let description =
    "O matchmaking foi resetado completamente.\n\n" +
    `**Jogadores removidos da fila:** ${queueSizeBefore}\n` +
    `**Jogadores da formação identificados:** ${formationPlayerIds.length}\n` +
    `**Partidas canceladas:** ${cancelledMatches}\n\n` +
    "🟢 **Fila aberta novamente.**";

  if (
    cancelledMatches > 0
  ) {
    description +=
      "\n\nAs partidas canceladas continuam registradas no banco, mas não bloqueiam mais os jogadores.";
  }

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          "Matchmaking resetado"
        )
        .setDescription(
          description
        )
    ],

    components: []
  });
}

/*
 * Cancela a confirmação.
 */
async function handleClearQueueCancel(
  interaction
) {
  if (
    !isStaff(
      interaction
    )
  ) {
    return interaction.reply({
      content:
        "Apenas membros da Staff podem executar essa ação.",

      ephemeral: true
    });
  }

  return interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          "Operação cancelada"
        )
        .setDescription(
          "A fila não foi alterada."
        )
    ],

    components: []
  });
}

/*
 * Descobre todos os jogadores
 * envolvidos na formação atual.
 */
function collectFormationPlayerIds() {
  const ids =
    new Set();

  /*
   * Fila.
   */
  try {
    const queuePlayers =
      queueState.getPlayers();

    addPlayersToSet(
      ids,
      queuePlayers
    );
  } catch (error) {
    console.error(
      "Erro ao ler jogadores da fila:",
      error
    );
  }

  /*
   * Ready Check.
   */
  try {
    if (
      typeof getReadyCheckPlayers ===
      "function"
    ) {
      const readyPlayers =
        getReadyCheckPlayers();

      addPlayersToSet(
        ids,
        readyPlayers
      );
    }
  } catch (error) {
    console.error(
      "Erro ao ler jogadores do Ready Check:",
      error
    );
  }

  /*
   * Votação de capitães.
   */
  try {
    if (
      typeof getCaptainPlayers ===
      "function"
    ) {
      addPlayersToSet(
        ids,
        getCaptainPlayers()
      );
    }
  } catch (error) {
    console.error(
      "Erro ao ler jogadores da votação:",
      error
    );
  }

  /*
   * Draft.
   */
  try {
    const teams =
      getTeams();

    if (teams) {
      addPlayersToSet(
        ids,
        teams.teamA
      );

      addPlayersToSet(
        ids,
        teams.teamB
      );
    }
  } catch (error) {
    console.error(
      "Erro ao ler jogadores do draft:",
      error
    );
  }

  /*
   * Veto.
   */
  try {
    const vetoData =
      getVetoData();

    if (vetoData) {
      addPlayersToSet(
        ids,
        vetoData.teamA
      );

      addPlayersToSet(
        ids,
        vetoData.teamB
      );
    }
  } catch (error) {
    console.error(
      "Erro ao ler jogadores do veto:",
      error
    );
  }

  /*
   * Escolha de lado.
   */
  try {
    const setup =
      getMatchSetup();

    if (setup) {
      addPlayersToSet(
        ids,
        setup.teamA
      );

      addPlayersToSet(
        ids,
        setup.teamB
      );
    }
  } catch (error) {
    console.error(
      "Erro ao ler jogadores da escolha de lado:",
      error
    );
  }

  return [
    ...ids
  ];
}

/*
 * Adiciona jogadores a um Set.
 */
function addPlayersToSet(
  set,
  players
) {
  if (
    !Array.isArray(players)
  ) {
    return;
  }

  for (
    const player
    of players
  ) {
    if (
      player &&
      player.discordId
    ) {
      set.add(
        String(
          player.discordId
        )
      );
    }
  }
}

/*
 * Cancela somente partidas
 * ativas relacionadas aos
 * jogadores da formação atual.
 *
 * Não apaga match_players.
 * Não altera pontos.
 */
function cancelFormationMatches(
  playerIds
) {
  if (
    !Array.isArray(playerIds) ||
    playerIds.length === 0
  ) {
    return 0;
  }

  const placeholders =
    playerIds
      .map(
        () => "?"
      )
      .join(", ");

  /*
   * Procuramos partidas ativas
   * contendo jogadores da
   * formação atual.
   */
  const matches =
    db.prepare(`
      SELECT DISTINCT
        matches.id,
        matches.match_code

      FROM matches

      INNER JOIN match_players
        ON match_players.match_id =
          matches.id

      WHERE
        matches.status IN (
          'playing',
          'pending_confirmation',
          'disputed'
        )

        AND match_players.discord_id
          IN (${placeholders})
    `).all(
      ...playerIds
    );

  if (
    matches.length === 0
  ) {
    return 0;
  }

  /*
   * Segurança:
   *
   * Só cancelamos uma partida
   * quando todos os jogadores
   * dela pertencem à formação
   * que estamos resetando.
   */
  const formationSet =
    new Set(
      playerIds.map(
        String
      )
    );

  const matchesToCancel = [];

  for (
    const match
    of matches
  ) {
    const players =
      db.prepare(`
        SELECT discord_id
        FROM match_players
        WHERE match_id = ?
      `).all(
        match.id
      );

    if (
      players.length !==
      config.matchmaking.requiredPlayers
    ) {
      continue;
    }

    const allBelong =
      players.every(
        (player) =>
          formationSet.has(
            String(
              player.discord_id
            )
          )
      );

    if (allBelong) {
      matchesToCancel.push(
        match
      );
    }
  }

  if (
    matchesToCancel.length === 0
  ) {
    return 0;
  }

  const cancelTransaction =
    db.transaction(() => {
      const update =
        db.prepare(`
          UPDATE matches

          SET status =
            'cancelled'

          WHERE
            id = ?

            AND status IN (
              'playing',
              'pending_confirmation',
              'disputed'
            )
        `);

      let changed = 0;

      for (
        const match
        of matchesToCancel
      ) {
        const result =
          update.run(
            match.id
          );

        changed +=
          result.changes;
      }

      return changed;
    });

  return cancelTransaction();
}

module.exports = {
  handleClearQueueCommand,
  handleClearQueueConfirm,
  handleClearQueueCancel
};
