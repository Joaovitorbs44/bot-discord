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

const {
  refreshSeason
} = require(
  "../services/seasonService"
);

const queueState = require(
  "./queueState"
);

/*
 * Gera um código único
 * de 6 dígitos.
 */
function generateMatchCode() {
  let code;
  let exists;

  do {
    const number =
      Math.floor(
        100000 +
        Math.random() * 900000
      );

    code =
      `#${number}`;

    exists =
      db.prepare(`
        SELECT id
        FROM matches
        WHERE match_code = ?
        LIMIT 1
      `).get(
        code
      );
  } while (exists);

  return code;
}

/*
 * Cria uma nova partida.
 */
async function createMatch(
  interaction,
  matchData
) {
  /*
   * Valida todos os dados antes
   * de escrever qualquer coisa
   * no banco.
   */
  validateMatchData(
    matchData
  );

  /*
   * Obtém ou atualiza
   * a temporada ativa.
   */
  const seasonResult =
    refreshSeason();

  if (
    !seasonResult ||
    !seasonResult.season
  ) {
    throw new Error(
      "ACTIVE_SEASON_NOT_FOUND"
    );
  }

  const season =
    seasonResult.season;

  const matchCode =
    generateMatchCode();

  /*
   * Tudo é salvo em uma única
   * transação.
   *
   * Se qualquer INSERT falhar,
   * nenhuma parte da partida
   * fica salva pela metade.
   */
  const createMatchTransaction =
    db.transaction(() => {
      const result =
        db.prepare(`
          INSERT INTO matches (
            match_code,
            season_id,
            map,
            captain_a_discord_id,
            captain_b_discord_id,
            side_a,
            side_b,
            status
          )

          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'playing'
          )
        `).run(
          matchCode,
          season.id,
          matchData.map,
          matchData.captainA.discordId,
          matchData.captainB.discordId,
          matchData.sideA,
          matchData.sideB
        );

      const matchId =
        Number(
          result.lastInsertRowid
        );

      const insertPlayer =
        db.prepare(`
          INSERT INTO match_players (
            match_id,
            discord_id,
            team,
            is_captain
          )

          VALUES (
            ?,
            ?,
            ?,
            ?
          )
        `);

      /*
       * Time A.
       */
      for (
        const player
        of matchData.teamA
      ) {
        insertPlayer.run(
          matchId,
          player.discordId,
          "A",
          player.discordId ===
            matchData.captainA.discordId
            ? 1
            : 0
        );
      }

      /*
       * Time B.
       */
      for (
        const player
        of matchData.teamB
      ) {
        insertPlayer.run(
          matchId,
          player.discordId,
          "B",
          player.discordId ===
            matchData.captainB.discordId
            ? 1
            : 0
        );
      }

      return {
        matchId,
        matchCode
      };
    });

  /*
   * A transação só retorna
   * depois que a partida inteira
   * estiver salva.
   */
  const createdMatch =
    createMatchTransaction();

  /*
   * IDs dos 10 jogadores.
   */
  const playerIds = [
    ...matchData.teamA,
    ...matchData.teamB
  ].map(
    (player) =>
      player.discordId
  );

  /*
   * Agora que a partida existe,
   * removemos esses jogadores
   * da fila.
   */
  queueState.removePlayers(
    playerIds
  );

  /*
   * Libera imediatamente a fila
   * para uma nova partida.
   */
  queueState.unlockQueue();

  /*
   * Atualiza o painel principal.
   */
  await updateQueuePanel();

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `result_report:${createdMatch.matchCode}`
          )
          .setLabel(
            "Informar resultado"
          )
          .setStyle(
            ButtonStyle.Primary
          )
      );

  /*
   * Publica a partida criada.
   */
  await interaction.followUp({
    embeds: [
      createMatchEmbed(
        createdMatch,
        matchData,
        season
      )
    ],

    components: [
      buttons
    ]
  });

  return {
    ...createdMatch,

    season,

    ...matchData
  };
}

/*
 * Valida os dados recebidos
 * antes da criação da partida.
 */
function validateMatchData(
  matchData
) {
  if (!matchData) {
    throw new Error(
      "INVALID_MATCH_DATA"
    );
  }

  if (
    !matchData.map ||
    typeof matchData.map !==
      "string"
  ) {
    throw new Error(
      "INVALID_MATCH_MAP"
    );
  }

  if (
    !matchData.captainA ||
    !matchData.captainB ||
    !matchData.captainA.discordId ||
    !matchData.captainB.discordId
  ) {
    throw new Error(
      "INVALID_MATCH_CAPTAINS"
    );
  }

  /*
   * Capitães precisam
   * ser diferentes.
   */
  if (
    matchData.captainA.discordId ===
    matchData.captainB.discordId
  ) {
    throw new Error(
      "MATCH_CAPTAINS_MUST_BE_DIFFERENT"
    );
  }

  /*
   * Validação dos lados.
   */
  const validSides =
    new Set([
      "Ataque",
      "Defesa"
    ]);

  if (
    !validSides.has(
      matchData.sideA
    ) ||
    !validSides.has(
      matchData.sideB
    )
  ) {
    throw new Error(
      "INVALID_MATCH_SIDES"
    );
  }

  /*
   * Os dois times precisam
   * começar em lados opostos.
   */
  if (
    matchData.sideA ===
    matchData.sideB
  ) {
    throw new Error(
      "MATCH_SIDES_MUST_BE_DIFFERENT"
    );
  }

  /*
   * Times precisam existir.
   */
  if (
    !Array.isArray(
      matchData.teamA
    ) ||
    !Array.isArray(
      matchData.teamB
    )
  ) {
    throw new Error(
      "INVALID_MATCH_TEAMS"
    );
  }

  /*
   * Cada time precisa ter
   * exatamente 5 jogadores.
   */
  if (
    matchData.teamA.length !==
      config.matchmaking.teamSize ||
    matchData.teamB.length !==
      config.matchmaking.teamSize
  ) {
    throw new Error(
      "INVALID_MATCH_TEAM_SIZE"
    );
  }

  const allPlayers = [
    ...matchData.teamA,
    ...matchData.teamB
  ];

  /*
   * Todos precisam possuir
   * um Discord ID.
   */
  const invalidPlayer =
    allPlayers.some(
      (player) =>
        !player ||
        !player.discordId
    );

  if (invalidPlayer) {
    throw new Error(
      "INVALID_MATCH_PLAYER"
    );
  }

  /*
   * Precisamos ter exatamente
   * 10 IDs diferentes.
   */
  const uniquePlayerIds =
    new Set(
      allPlayers.map(
        (player) =>
          player.discordId
      )
    );

  if (
    uniquePlayerIds.size !==
    config.matchmaking.requiredPlayers
  ) {
    throw new Error(
      "DUPLICATED_MATCH_PLAYERS"
    );
  }

  /*
   * Capitão A precisa estar
   * dentro do Time A.
   */
  const captainAInTeam =
    matchData.teamA.some(
      (player) =>
        player.discordId ===
        matchData.captainA.discordId
    );

  /*
   * Capitão B precisa estar
   * dentro do Time B.
   */
  const captainBInTeam =
    matchData.teamB.some(
      (player) =>
        player.discordId ===
        matchData.captainB.discordId
    );

  if (
    !captainAInTeam ||
    !captainBInTeam
  ) {
    throw new Error(
      "MATCH_CAPTAIN_NOT_IN_TEAM"
    );
  }
}

/*
 * Atualiza o painel da fila.
 *
 * A importação de queue.js
 * acontece somente aqui para
 * evitar:
 *
 * queue
 *   -> ready
 *   -> captains
 *   -> drafts
 *   -> mapVeto
 *   -> side
 *   -> match
 *   -> queue
 */
async function updateQueuePanel() {
  const queueMessage =
    queueState.getQueueMessage();

  if (!queueMessage) {
    return;
  }

  try {
    const {
      createQueuePanel
    } = require(
      "./queue"
    );

    await queueMessage.edit(
      createQueuePanel()
    );
  } catch (error) {
    console.error(
      "Erro ao atualizar painel da fila após criar partida:",
      error
    );
  }
}

/*
 * Cria o embed da partida.
 */
function createMatchEmbed(
  createdMatch,
  matchData,
  season
) {
  const teamAList =
    createTeamList(
      matchData.teamA,
      matchData.captainA
    );

  const teamBList =
    createTeamList(
      matchData.teamB,
      matchData.captainB
    );

  return new EmbedBuilder()
    .setTitle(
      `Partida ${createdMatch.matchCode}`
    )
    .setDescription(
      `**${season.name}**`
    )
    .addFields(
      {
        name:
          "Mapa",

        value:
          matchData.map,

        inline: true
      },

      {
        name:
          "Status",

        value:
          "Em andamento",

        inline: true
      },

      {
        name:
          `Time A — ${matchData.sideA}`,

        value:
          teamAList,

        inline: true
      },

      {
        name:
          `Time B — ${matchData.sideB}`,

        value:
          teamBList,

        inline: true
      }
    )
    .setFooter({
      text:
        "Somente os capitães podem informar o resultado."
    })
    .setTimestamp();
}

/*
 * Cria a lista de jogadores
 * para o embed da partida.
 */
function createTeamList(
  players,
  captain
) {
  if (
    !Array.isArray(players) ||
    players.length === 0
  ) {
    return "—";
  }

  return players
    .map(
      (player) => {
        const isCaptain =
          player.discordId ===
          captain.discordId;

        return (
          `${isCaptain ? "👑" : "•"} ` +
          `<@${player.discordId}> — ` +
          `${player.nickname}`
        );
      }
    )
    .join("\n");
}

module.exports = {
  createMatch,
  generateMatchCode
};