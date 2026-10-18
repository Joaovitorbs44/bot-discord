const { execute: executeHomologation } = require("../scripts/homologation");

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
const { handleRankingPage } = require("../scripts/ranking");
const { enforceChannel } = require("../scripts/channelGuard");
const { handleSessionComponent } = require("../services/matchmakingInteractionRouter");
const readyCheckPanels = require("../services/readyCheckPanels");
const captainVotePanels = require("../services/captainVotePanels");
const draftPanels = require("../services/draftPanels");
const mapVetoPanels = require("../services/mapVetoPanels");
const sideChoicePanels = require("../services/sideChoicePanels");
const multiLobbyQueue = require("../services/multiLobbyQueue");
const handleSolicitacoes = require("../scripts/solicitacoes");

// ==========================================
// GERENCIAMENTO MANUAL DE PONTOS
// ==========================================

const handlePoints = require("../scripts/points");

// ==========================================
// ADMINISTRAÇÃO DA FILA
// ==========================================

const {
  handleClearQueueCommand,
  handleClearQueueConfirm,
  handleClearQueueCancel
} = require("../scripts/clearQueue");

const {
  handleRemoveQueueCommand
} = require("../scripts/removeQueue");

const {
  handleRemoveTimeout
} = require("../scripts/removeTimeout");

const {
  handleStaffPanel,
  handleStaffPanelButton
} = require("../scripts/staffPanel");

// ==========================================
// PREVIEW INTERATIVO
// ==========================================

const {
  executePreview,
  handlePreviewSelect,
  handlePreviewAction
} = require("../scripts/preview");

// ==========================================
// HISTÓRICO E TEMPORADAS
// ==========================================

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
  handleReadyCheck,
  restoreReadyCheck
} = require("../scripts/ready");

const {
  handleCaptainVote,
  restoreCaptainVote
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
  handleSideChoice,
  restoreSideChoice
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
// RANKS
// ==========================================

const R6_RANKS = [
  "Cobre",
  "Bronze",
  "Prata",
  "Ouro",
  "Platina",
  "Esmeralda",
  "Diamante",
  "Campeão"
].map(rank => ({
  label: rank,
  value: rank
}));

// ==========================================
// CLIENTE DISCORD
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

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
    const recovery =
      queueState.restoreQueueState();

    console.log(
      `Jogadores recuperados: ${recovery.restored}`
    );

    console.log(
      `Etapa encontrada: ${recovery.stage}`
    );

    const queueMessage =
      await restoreQueuePanel(readyClient);

    if (queueMessage) {
      console.log(
        `Painel da fila restaurado: ${queueMessage.id}`
      );
    } else {
      console.warn(
        "Não foi possível localizar o painel da fila."
      );
    }

    const session =
      queueState.getActiveSession();

    if (!session) {
      console.log(
        "Nenhuma sessão ativa encontrada."
      );
    } else {
      const recoveryHandlers = {
        ready_check: restoreReadyCheck,
        captain_vote: restoreCaptainVote,
        draft: restoreDraft,
        map_veto: restoreMapVeto,
        side_choice: restoreSideChoice
      };

      const restoreHandler =
        recoveryHandlers[session.stage];

      if (session.stage === "queue") {
        console.log(
          "Fila restaurada e disponível."
        );
      } else if (
        session.stage === "playing"
      ) {
        console.log(
          "Partida em andamento encontrada."
        );
      } else if (
        typeof restoreHandler === "function"
      ) {
        console.log(
          `Recuperando etapa: ${session.stage}`
        );

        try {
          const restored =
            await restoreHandler(readyClient);

          console.log(
            restored
              ? `Etapa ${session.stage} recuperada.`
              : `Não foi possível recuperar ${session.stage}.`
          );
        } catch (error) {
          console.error(
            `Erro ao recuperar ${session.stage}:`,
            error
          );
        }
      } else {
        console.warn(
          `Etapa sem recuperação: ${session.stage}`
        );
      }
    }

    try {
      await updateQueuePanel();
    } catch (error) {
      console.error(
        "Erro ao sincronizar painel:",
        error
      );
    }

    try {
      const { restoreMatchPublications } = require("../scripts/match");
      await restoreMatchPublications(readyClient);
    } catch (error) {
      console.error("Erro ao recuperar publicações de partidas:", error);
    }

    if (process.env.MULTILOBBY_RECOVERY_ENABLED === "true") {
      await readyCheckPanels.recover(readyClient, config.discord.guildId);
      await captainVotePanels.recover(readyClient, config.discord.guildId);
      await draftPanels.recover(readyClient, config.discord.guildId);
      await mapVetoPanels.recover(readyClient, config.discord.guildId);
      await sideChoicePanels.recover(readyClient, config.discord.guildId);
      if (multiLobbyQueue.enabled()) await multiLobbyQueue.recover(readyClient);
    }

    matchmakingInitialized = true;

    console.log(
      "Matchmaking inicializado com sucesso."
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
  async readyClient => {
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
  async interaction => {
    try {
      if (await handleSessionComponent(interaction)) return;
      if (await enforceChannel(interaction)) return;
      if (interaction.isButton() && interaction.customId.startsWith("ranking_page:")) return handleRankingPage(interaction);

      // ======================================
      // PREVIEW - NAVEGAÇÃO
      // ======================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "preview_select"
      ) {
        return handlePreviewSelect(
          interaction
        );
      }

      // ======================================
      // PREVIEW - AÇÕES
      // ======================================

      if (
        (
          interaction.isButton() ||
          interaction.isStringSelectMenu()
        ) &&
        (
          interaction.customId.startsWith(
            "preview_action:"
          ) ||
          interaction.customId.startsWith(
            "preview_choice:"
          )
        )
      ) {
        return handlePreviewAction(
          interaction
        );
      }

      // ======================================
      // SOLICITAR ACESSO
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "access_request"
      ) {
        return handleAccess(interaction);
      }

      // ======================================
      // FORMULÁRIO
      // ======================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId ===
          "access_modal"
      ) {
        return handleAccessModal(
          interaction
        );
      }

      // ======================================
      // SELEÇÃO DE RANK
      // ======================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "access_rank"
      ) {
        return handleAccessRank(
          interaction
        );
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
        return handleApprove(
          interaction
        );
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
        return handleReject(
          interaction
        );
      }

      // ======================================
      // PAINEL DA STAFF
      // ======================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "staff_panel:"
        )
      ) {
        return handleStaffPanelButton(
          interaction
        );
      }

      // ======================================
      // FILA
      // ======================================

      if (
        interaction.isButton() &&
        (
          interaction.customId ===
            "queue_join" ||
          interaction.customId ===
            "queue_leave"
        )
      ) {
        if (!matchmakingInitialized) {
          return interaction.reply({
            content:
              "O matchmaking está inicializando. " +
              "Tente novamente em instantes.",
            ephemeral: true
          });
        }

        if (multiLobbyQueue.enabled()) return multiLobbyQueue.handle(interaction);

        return handleQueue(
          interaction
        );
      }

      // ======================================
      // LIMPAR FILA
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
        interaction.customId ===
          "ready_confirm"
      ) {
        return handleReadyCheck(
          interaction
        );
      }

      // ======================================
      // CAPITÃES
      // ======================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "captain_vote"
      ) {
        return handleCaptainVote(
          interaction
        );
      }

      // ======================================
      // DRAFT
      // ======================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "draft_pick"
      ) {
        return handleDraftPick(
          interaction
        );
      }

      // ======================================
      // VETO DE MAPAS
      // ======================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "map_veto"
      ) {
        return handleMapVeto(
          interaction
        );
      }

      // ======================================
      // ESCOLHA DE LADO
      // ======================================

      if (
        interaction.isButton() &&
        (
          interaction.customId ===
            "side_attack" ||
          interaction.customId ===
            "side_defense"
        )
      ) {
        return handleSideChoice(
          interaction
        );
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
        return handleResultReport(
          interaction
        );
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
        return handleWinnerSelection(
          interaction
        );
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
        return handleStaffResult(
          interaction
        );
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
        return handleStaffCancel(
          interaction
        );
      }

      // ======================================
      // COMANDOS SLASH
      // ======================================

      if (
        interaction.isChatInputCommand()
      ) {
        switch (interaction.commandName) {
          case "homologacao":
            return executeHomologation(interaction);
          case "preview":
            return executePreview(
              interaction
            );

          case "perfil":
            return handleProfile(
              interaction
            );

          case "ranking":
            return handleRanking(
              interaction
            );

          // ==================================
          // GERENCIAMENTO DE PONTOS
          // ==================================

          case "pontos":
            return handlePoints(
              interaction
            );

          case "historico":
            return handleHistory(
              interaction
            );

          case "partida":
            return handleMatchLookup(
              interaction
            );

          case "temporada":
            if (
              typeof handleSeason ===
              "function"
            ) {
              return handleSeason(
                interaction
              );
            }

            return interaction.reply({
              content:
                "O comando de temporada " +
                "ainda não está configurado.",
              ephemeral: true
            });

          case "temporadas":
            if (
              typeof handleSeasons ===
              "function"
            ) {
              return handleSeasons(
                interaction
              );
            }

            return interaction.reply({
              content:
                "O histórico de temporadas " +
                "ainda não está configurado.",
              ephemeral: true
            });

          case "solicitacoes":
            return handleSolicitacoes(
              interaction
            );

          case "remover-fila":
            return handleRemoveQueueCommand(
              interaction
            );

          case "limpar-fila":
            return handleClearQueueCommand(
              interaction
            );

          case "remover-timeout":
            return handleRemoveTimeout(
              interaction
            );

          case "painel-staff":
            return handleStaffPanel(
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
          return await interaction.followUp({
            content:
              "Ocorreu um erro ao processar essa ação.",
            ephemeral: true
          });
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
    existingRequest?.status ===
    "pending"
  ) {
    return interaction.reply({
      content:
        "Você já possui uma solicitação " +
        "aguardando análise.",
      ephemeral: true
    });
  }

  if (
    existingRequest?.status ===
    "approved"
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

  const twitchNickname =
    interaction.fields
      .getTextInputValue(
        "twitch_nickname"
      )
      .trim()
      .replace(/^@/, "");

  const r6Nickname =
    interaction.fields
      .getTextInputValue(
        "r6_nickname"
      )
      .trim();

  if (
    !name ||
    !twitchNickname ||
    !r6Nickname
  ) {
    return interaction.reply({
      content:
        "Preencha todos os campos " +
        "da solicitação.",
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

  const embed = new EmbedBuilder()
    .setTitle("Selecione seu rank")
    .setDescription(
      "Agora selecione seu rank atual " +
      "no Rainbow Six Siege."
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
    components: [
      new ActionRowBuilder()
        .addComponents(rankSelect)
    ],
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
        "Sua solicitação expirou. " +
        "Clique novamente em Solicitar acesso.",
      embeds: [],
      components: []
    });
  }

  const r6Rank =
    interaction.values[0];

  if (
    !R6_RANKS.some(
      rank => rank.value === r6Rank
    )
  ) {
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
    if (
      existingRequest.status ===
        "pending" ||
      existingRequest.status ===
        "approved"
    ) {
      pendingAccessForms.delete(
        interaction.user.id
      );

      return interaction.update({
        content:
          existingRequest.status === "pending"
            ? "Você já possui uma solicitação aguardando análise."
            : "Você já possui acesso ao matchmaking.",
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
      "Um novo usuário solicitou " +
      "acesso ao matchmaking."
    )
    .addFields(
      {
        name: "Usuário",
        value:
          `<@${interaction.user.id}>`,
        inline: false
      },
      {
        name: "Nome",
        value: form.name,
        inline: true
      },
      {
        name: "Twitch",
        value:
          `@${form.twitchNickname}`,
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

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `access_approve:${requestId}`
          )
          .setLabel("Aprovar")
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `access_reject:${requestId}`
          )
          .setLabel("Rejeitar")
          .setStyle(
            ButtonStyle.Danger
          )
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
      "Sua solicitação foi enviada. " +
      "Aguarde a análise da Staff.",
    embeds: [],
    components: []
  });
}

// ==========================================
// LOGIN
// ==========================================

client.login(config.discord.token);

