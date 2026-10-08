const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require("discord.js");

const config = require("../config/config");
const initializeDatabase = require("../database/schema");
const db = require("../database/database");

// ==========================================
// SCRIPTS
// ==========================================

const handleAccess = require("../scripts/access");
const handleApprove = require("../scripts/approve");
const handleReject = require("../scripts/reject");
const handleProfile = require("../scripts/profile");
const handleRanking = require("../scripts/ranking");
const handleSolicitacoes = require("../scripts/solicitacoes");

const {
  handleClearQueueCommand,
  handleClearQueueConfirm,
  handleClearQueueCancel
} = require("../scripts/clearQueue");

const {
  handleRemoveQueueCommand
} = require("../scripts/removeQueue");

const {
  handleHistory,
  handleMatchLookup
} = require("../scripts/history");

const seasonModule = require("../scripts/season");

const handleSeason =
  seasonModule.handleSeason || seasonModule;

const handleSeasons =
  seasonModule.handleSeasons || null;

// ==========================================
// MATCHMAKING
// ==========================================

const queueState = require("../scripts/queueState");

const {
  handleQueue,
  restoreQueuePanel,
  updateQueuePanel
} = require("../scripts/queue");

const {
  handleReadyCheck
} = require("../scripts/ready");

const {
  handleCaptainVote
} = require("../scripts/captains");

const {
  handleDraftPick,
  restoreDraft
} = require("../scripts/drafts");

const {
  handleMapVeto,
  restoreMapVeto
} = require("../scripts/mapVeto");

const {
  handleSideChoice
} = require("../scripts/side");

// ==========================================
// RESULTADOS
// ==========================================

const {
  handleResultReport,
  handleWinnerSelection,
  handleResultConfirmation,
  handleResultDispute,
  handleStaffResult,
  handleStaffCancel
} = require("../scripts/results");

// ==========================================
// BANCO DE DADOS
// ==========================================

initializeDatabase();

// ==========================================
// SOLICITAÇÕES TEMPORÁRIAS
// ==========================================

const pendingAccessForms = new Map();

const ACCESS_FORM_TIMEOUT_MS =
  15 * 60 * 1000;

// ==========================================
// RANKS R6
// ==========================================

const R6_RANKS = [
  { label: "Cobre", value: "Cobre" },
  { label: "Bronze", value: "Bronze" },
  { label: "Prata", value: "Prata" },
  { label: "Ouro", value: "Ouro" },
  { label: "Platina", value: "Platina" },
  { label: "Esmeralda", value: "Esmeralda" },
  { label: "Diamante", value: "Diamante" },
  { label: "Campeão", value: "Campeão" }
];

// ==========================================
// CLIENTE DISCORD
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ==========================================
// CONTROLE DE INICIALIZAÇÃO
// ==========================================

let matchmakingInitialized = false;
let matchmakingInitializing = false;

// ==========================================
// RECUPERAÇÃO DO MATCHMAKING
// ==========================================

async function initializeMatchmaking(readyClient) {
  if (
    matchmakingInitialized ||
    matchmakingInitializing
  ) {
    return;
  }

  matchmakingInitializing = true;

  console.log(
    "Inicializando matchmaking persistente..."
  );

  try {
    // ======================================
    // 1. RECUPERAR JOGADORES
    // ======================================

    const restored = queueState.restoreQueueState();

    console.log(
      `Jogadores recuperados: ${restored.restored}`
    );

    console.log(
      `Etapa recuperada: ${restored.stage}`
    );

    // ======================================
    // 2. RECUPERAR PAINEL
    // ======================================

    /*
     * IMPORTANTE:
     *
     * restoreQueuePanel() precisa estar
     * atualizado para NÃO chamar:
     *
     * queueState.clearQueue()
     * queueState.unlockQueue()
     *
     * Essa correção será feita em queue.js.
     */

    const queueMessage = await restoreQueuePanel(
      readyClient
    );

    if (queueMessage) {
      console.log(
        `Painel da fila localizado: ${queueMessage.id}`
      );
    } else {
      console.warn(
        "Painel da fila não foi localizado."
      );
    }

    // ======================================
    // 3. RECUPERAR ETAPA ATIVA
    // ======================================

    const session = queueState.getActiveSession();

    if (!session) {
      console.log(
        "Nenhuma sessão ativa para recuperar."
      );

      matchmakingInitialized = true;
      return;
    }

    switch (session.stage) {
      // ====================================
      // FILA
      // ====================================

      case "queue": {
        console.log(
          "Sessão restaurada na fila."
        );

        break;
      }

      // ====================================
      // READY CHECK
      // ====================================

      case "ready_check": {
        console.warn(
          "Ready Check persistido encontrado."
        );

        console.warn(
          "A recuperação do Ready Check será integrada em ready.js."
        );

        /*
         * Mantemos a sessão bloqueada.
         *
         * Não removemos jogadores e
         * não reiniciamos a fila.
         */

        break;
      }

      // ====================================
      // VOTAÇÃO DE CAPITÃES
      // ====================================

      case "captain_vote": {
        console.warn(
          "Votação de capitães persistida encontrada."
        );

        console.warn(
          "A recuperação da votação será integrada em captains.js."
        );

        break;
      }

      // ====================================
      // DRAFT
      // ====================================

      case "draft": {
        console.log(
          "Recuperando draft..."
        );

        if (typeof restoreDraft !== "function") {
          console.warn(
            "restoreDraft() não está disponível."
          );

          break;
        }

        try {
          const success = await restoreDraft(
            readyClient
          );

          console.log(
            success
              ? "Draft recuperado."
              : "Não foi possível recuperar o draft."
          );
        } catch (error) {
          console.error(
            "Erro ao recuperar draft:",
            error
          );
        }

        break;
      }

      // ====================================
      // VETO DE MAPAS
      // ====================================

      case "map_veto": {
        console.log(
          "Recuperando veto de mapas..."
        );

        if (typeof restoreMapVeto !== "function") {
          console.warn(
            "restoreMapVeto() não está disponível."
          );

          break;
        }

        try {
          const success = await restoreMapVeto(
            readyClient
          );

          console.log(
            success
              ? "Veto de mapas recuperado."
              : "Não foi possível recuperar o veto."
          );
        } catch (error) {
          console.error(
            "Erro ao recuperar veto:",
            error
          );
        }

        break;
      }

      // ====================================
      // ESCOLHA DE LADO
      // ====================================

      case "side_choice": {
        console.warn(
          "Escolha de lado persistida encontrada."
        );

        console.warn(
          "A recuperação será integrada em side.js."
        );

        break;
      }

      // ====================================
      // PARTIDA CRIADA
      // ====================================

      case "playing": {
        console.log(
          "Sessão de partida em andamento encontrada."
        );

        /*
         * As partidas já são registradas
         * na tabela matches.
         *
         * A reconciliação dessa etapa
         * será feita posteriormente.
         */

        break;
      }

      // ====================================
      // ETAPA DESCONHECIDA
      // ====================================

      default: {
        console.warn(
          `Etapa não reconhecida: ${session.stage}`
        );

        break;
      }
    }

    // ======================================
    // 4. SINCRONIZAR PAINEL
    // ======================================

    try {
      await updateQueuePanel();
    } catch (error) {
      console.error(
        "Erro ao sincronizar painel da fila:",
        error
      );
    }

    matchmakingInitialized = true;

    console.log(
      "Inicialização do matchmaking concluída."
    );
  } catch (error) {
    console.error(
      "Falha na inicialização do matchmaking:",
      error
    );
  } finally {
    matchmakingInitializing = false;
  }
}

// ==========================================
// BOT PRONTO
// ==========================================

client.once(
  Events.ClientReady,
  async (readyClient) => {
    console.log(
      `Bot conectado como ${readyClient.user.tag}`
    );

    await initializeMatchmaking(
      readyClient
    );
  }
);

// ==========================================
// INTERAÇÕES
// ==========================================

client.on(
  Events.InteractionCreate,
  async (interaction) => {
    try {
      // ======================================
      // SOLICITAR ACESSO
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId === "access_request"
      ) {
        return handleAccess(interaction);
      }

      // ======================================
      // FORMULÁRIO
      // ======================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId === "access_modal"
      ) {
        return handleAccessModal(interaction);
      }

      // ======================================
      // SELEÇÃO DE RANK
      // ======================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === "access_rank"
      ) {
        return handleAccessRank(interaction);
      }

      // ======================================
      // APROVAR ACESSO
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "access_approve:"
        )
      ) {
        return handleApprove(interaction);
      }

      // ======================================
      // REJEITAR ACESSO
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "access_reject:"
        )
      ) {
        return handleReject(interaction);
      }

      // ======================================
      // FILA
      // ======================================

      if (
        interaction.isButton() &&
        (
          interaction.customId === "queue_join" ||
          interaction.customId === "queue_leave"
        )
      ) {
        if (!matchmakingInitialized) {
          return interaction.reply({
            content:
              "O matchmaking está inicializando. Tente novamente em instantes.",
            ephemeral: true
          });
        }

        return handleQueue(interaction);
      }

      // ======================================
      // LIMPAR FILA - CONFIRMAR
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "clear_queue_confirm"
      ) {
        return handleClearQueueConfirm(
          interaction
        );
      }

      // ======================================
      // LIMPAR FILA - CANCELAR
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "clear_queue_cancel"
      ) {
        return handleClearQueueCancel(
          interaction
        );
      }

      // ======================================
      // READY CHECK
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId === "ready_confirm"
      ) {
        return handleReadyCheck(interaction);
      }

      // ======================================
      // CAPITÃES
      // ======================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === "captain_vote"
      ) {
        return handleCaptainVote(interaction);
      }

      // ======================================
      // DRAFT
      // ======================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === "draft_pick"
      ) {
        return handleDraftPick(interaction);
      }

      // ======================================
      // VETO DE MAPAS
      // ======================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === "map_veto"
      ) {
        return handleMapVeto(interaction);
      }

      // ======================================
      // ESCOLHA DE LADO
      // ======================================

      if (
        interaction.isButton() &&
        (
          interaction.customId === "side_attack" ||
          interaction.customId === "side_defense"
        )
      ) {
        return handleSideChoice(interaction);
      }

      // ======================================
      // INFORMAR RESULTADO
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "result_report:"
        )
      ) {
        return handleResultReport(interaction);
      }

      // ======================================
      // SELECIONAR VENCEDOR
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "result_winner:"
        )
      ) {
        return handleWinnerSelection(interaction);
      }

      // ======================================
      // CONFIRMAR RESULTADO
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "result_confirm:"
        )
      ) {
        return handleResultConfirmation(
          interaction
        );
      }

      // ======================================
      // CONTESTAR RESULTADO
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "result_dispute:"
        )
      ) {
        return handleResultDispute(
          interaction
        );
      }

      // ======================================
      // STAFF DEFINE RESULTADO
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "staff_result:"
        )
      ) {
        return handleStaffResult(interaction);
      }

      // ======================================
      // STAFF CANCELA PARTIDA
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "staff_cancel:"
        )
      ) {
        return handleStaffCancel(interaction);
      }

      // ======================================
      // COMANDOS
      // ======================================

      if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
          case "perfil":
            return handleProfile(interaction);

          case "ranking":
            return handleRanking(interaction);

          case "historico":
            return handleHistory(interaction);

          case "partida":
            return handleMatchLookup(interaction);

          case "temporada":
            if (typeof handleSeason !== "function") {
              return interaction.reply({
                content:
                  "O comando de temporada ainda não está configurado.",
                ephemeral: true
              });
            }

            return handleSeason(interaction);

          case "temporadas":
            if (typeof handleSeasons !== "function") {
              return interaction.reply({
                content:
                  "O histórico de temporadas ainda não está configurado.",
                ephemeral: true
              });
            }

            return handleSeasons(interaction);

          case "solicitacoes":
            return handleSolicitacoes(interaction);

          case "remover-fila":
            return handleRemoveQueueCommand(
              interaction
            );

          case "limpar-fila":
            return handleClearQueueCommand(
              interaction
            );

          default:
            return;
        }
      }
    } catch (error) {
      console.error(
        "Erro ao processar interação:",
        error
      );

      try {
        if (
          interaction.replied ||
          interaction.deferred
        ) {
          await interaction.followUp({
            content:
              "Ocorreu um erro ao processar essa ação.",
            ephemeral: true
          });

          return;
        }

        await interaction.reply({
          content:
            "Ocorreu um erro ao processar essa ação.",
          ephemeral: true
        });
      } catch (replyError) {
        console.error(
          "Não foi possível responder à interação:",
          replyError
        );
      }
    }
  }
);

// ==========================================
// MODAL DE SOLICITAÇÃO
// ==========================================

async function handleAccessModal(interaction) {
  const existingRequest = db.prepare(`
    SELECT *
    FROM access_requests
    WHERE discord_id = ?
  `).get(interaction.user.id);

  if (
    existingRequest &&
    existingRequest.status === "pending"
  ) {
    return interaction.reply({
      content:
        "Você já possui uma solicitação aguardando análise.",
      ephemeral: true
    });
  }

  if (
    existingRequest &&
    existingRequest.status === "approved"
  ) {
    return interaction.reply({
      content:
        "Você já possui acesso ao matchmaking.",
      ephemeral: true
    });
  }

  const name = interaction.fields
    .getTextInputValue("name")
    .trim();

  const twitchNickname = interaction.fields
    .getTextInputValue("twitch_nickname")
    .trim()
    .replace(/^@/, "");

  const r6Nickname = interaction.fields
    .getTextInputValue("r6_nickname")
    .trim();

  if (
    !name ||
    !twitchNickname ||
    !r6Nickname
  ) {
    return interaction.reply({
      content:
        "Preencha todos os campos da solicitação.",
      ephemeral: true
    });
  }

  pendingAccessForms.set(
    interaction.user.id,
    {
      name,
      twitchNickname,
      r6Nickname,
      createdAt: Date.now()
    }
  );

  const rankSelect =
    new StringSelectMenuBuilder()
      .setCustomId("access_rank")
      .setPlaceholder(
        "Selecione seu rank atual"
      )
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(R6_RANKS);

  const row =
    new ActionRowBuilder()
      .addComponents(rankSelect);

  const embed =
    new EmbedBuilder()
      .setTitle("Selecione seu rank")
      .setDescription(
        "Agora selecione seu rank atual no Rainbow Six Siege."
      )
      .addFields(
        {
          name: "Nome",
          value: name,
          inline: true
        },
        {
          name: "Twitch",
          value: `@${twitchNickname}`,
          inline: true
        },
        {
          name: "Nickname R6",
          value: r6Nickname,
          inline: true
        }
      );

  return interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

// ==========================================
// SELECIONAR RANK
// ==========================================

async function handleAccessRank(interaction) {
  const form = pendingAccessForms.get(
    interaction.user.id
  );

  if (
    !form ||
    Date.now() - form.createdAt >
      ACCESS_FORM_TIMEOUT_MS
  ) {
    pendingAccessForms.delete(
      interaction.user.id
    );

    return interaction.update({
      content:
        "Sua solicitação expirou. Clique novamente em Solicitar acesso.",
      embeds: [],
      components: []
    });
  }

  const r6Rank = interaction.values[0];

  const validRank = R6_RANKS.some(
    (rank) => rank.value === r6Rank
  );

  if (!validRank) {
    return interaction.reply({
      content: "Rank inválido.",
      ephemeral: true
    });
  }

  const existingRequest = db.prepare(`
    SELECT *
    FROM access_requests
    WHERE discord_id = ?
  `).get(interaction.user.id);

  let requestId;

  if (existingRequest) {
    if (existingRequest.status === "pending") {
      pendingAccessForms.delete(
        interaction.user.id
      );

      return interaction.update({
        content:
          "Você já possui uma solicitação aguardando análise.",
        embeds: [],
        components: []
      });
    }

    if (existingRequest.status === "approved") {
      pendingAccessForms.delete(
        interaction.user.id
      );

      return interaction.update({
        content:
          "Você já possui acesso ao matchmaking.",
        embeds: [],
        components: []
      });
    }

    db.prepare(`
      UPDATE access_requests
      SET
        discord_username = ?,
        name = ?,
        twitch_nickname = ?,
        r6_nickname = ?,
        r6_rank = ?,
        status = 'pending',
        reviewed_by = NULL,
        reviewed_at = NULL,
        created_at = CURRENT_TIMESTAMP
      WHERE discord_id = ?
    `).run(
      interaction.user.username,
      form.name,
      form.twitchNickname,
      form.r6Nickname,
      r6Rank,
      interaction.user.id
    );

    requestId = existingRequest.id;
  } else {
    const result = db.prepare(`
      INSERT INTO access_requests (
        discord_id,
        discord_username,
        name,
        twitch_nickname,
        r6_nickname,
        r6_rank
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      interaction.user.id,
      interaction.user.username,
      form.name,
      form.twitchNickname,
      form.r6Nickname,
      r6Rank
    );

    requestId = result.lastInsertRowid;
  }

  const staffChannel =
    await interaction.guild.channels.fetch(
      config.discord.staffChannelId
    );

  if (
    !staffChannel ||
    !staffChannel.isTextBased() ||
    !staffChannel.send
  ) {
    throw new Error(
      "Canal da Staff não encontrado."
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("Nova solicitação")
    .setDescription(
      "Um novo usuário solicitou acesso ao matchmaking."
    )
    .addFields(
      {
        name: "Usuário",
        value: `<@${interaction.user.id}>`,
        inline: false
      },
      {
        name: "Nome",
        value: form.name,
        inline: true
      },
      {
        name: "Twitch",
        value: `@${form.twitchNickname}`,
        inline: true
      },
      {
        name: "Nickname R6",
        value: form.r6Nickname,
        inline: true
      },
      {
        name: "Rank R6",
        value: r6Rank,
        inline: true
      }
    )
    .setFooter({
      text: `Solicitação #${requestId}`
    })
    .setTimestamp();

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          `access_approve:${requestId}`
        )
        .setLabel("Aprovar")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(
          `access_reject:${requestId}`
        )
        .setLabel("Rejeitar")
        .setStyle(ButtonStyle.Danger)
    );

  await staffChannel.send({
    embeds: [embed],
    components: [buttons]
  });

  pendingAccessForms.delete(
    interaction.user.id
  );

  return interaction.update({
    content:
      "Sua solicitação foi enviada. Aguarde a análise da Staff.",
    embeds: [],
    components: []
  });
}

// ==========================================
// LOGIN
// ==========================================

client.login(config.discord.token);
