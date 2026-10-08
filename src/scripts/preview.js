const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits
} = require("discord.js");

const config = require("../config/config");

const {
  MAP_POOL,
  generateMapVetoImage
} = require("./mapVetoImage");

const PRIMARY = 0xFF3D2C;

const PANELS = [
  ["queue", "Fila"],
  ["ready", "Ready Check"],
  ["captains", "Capitães"],
  ["draft", "Draft"],
  ["maps", "Veto de mapas"],
  ["side", "Escolha de lado"],
  ["match", "Partida"],
  ["confirm", "Confirmação"],
  ["result", "Resultado final"]
];

const PLAYERS = Array.from(
  { length: 10 },
  (_, i) => ({
    id:
      "player" +
      String(i + 1).padStart(2, "0"),
    rank: [
      "Diamante",
      "Esmeralda",
      "Platina",
      "Ouro",
      "Prata"
    ][i % 5]
  })
);

const sessions = new Map();

const SESSION_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 100;

// ==========================================
// ESTADO DA SIMULAÇÃO
// ==========================================

function newSession() {
  return {
    panel: "queue",
    queue: PLAYERS.slice(0, 6).map(
      player => player.id
    ),
    ready: [],
    votes: {},
    captains: [],
    teams: {
      A: [],
      B: []
    },
    draftStep: 0,
    bans: [],
    selectedMap: null,
    side: null,
    winner: null,
    reported: false,
    disputed: false,
    finished: false,
    updated: Date.now()
  };
}

function getSession(id, reset = false) {
  const now = Date.now();

  for (const [key, session] of sessions) {
    if (
      now - session.updated >
      SESSION_MS
    ) {
      sessions.delete(key);
    }
  }

  if (reset || !sessions.has(id)) {
    if (sessions.size >= MAX_SESSIONS) {
      sessions.delete(
        sessions.keys().next().value
      );
    }

    sessions.set(id, newSession());
  }

  const session = sessions.get(id);

  session.updated = now;

  return session;
}

// ==========================================
// PERMISSÕES
// ==========================================

function isStaff(interaction) {
  const roleId =
    config.discord?.staffRoleId ||
    process.env.STAFF_ROLE_ID;

  const roles = interaction.member?.roles;

  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    ) ||
    (
      roleId &&
      (
        roles?.cache?.has?.(roleId) ||
        (
          Array.isArray(roles) &&
          roles.includes(roleId)
        )
      )
    )
  );
}

// ==========================================
// COMPONENTES VISUAIS
// ==========================================

function addText(container, content) {
  container.addTextDisplayComponents(
    new TextDisplayBuilder()
      .setContent(content)
  );
}

function separator(container) {
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(
        SeparatorSpacingSize.Small
      )
  );
}

function container(title, subtitle) {
  const component = new ContainerBuilder()
    .setAccentColor(PRIMARY);

  addText(
    component,
    [
      "## INVISIXTATIONAL",
      "### " + title,
      "-# " + subtitle
    ].join("\n")
  );

  separator(component);

  return component;
}

function list(ids, captains = []) {
  if (!ids.length) {
    return "-# Nenhum jogador";
  }

  return ids.map(id => {
    const player = PLAYERS.find(
      item => item.id === id
    );

    const marker = captains.includes(id)
      ? "👑"
      : "•";

    return (
      marker +
      " **" + id + "** · " +
      (player?.rank || "—")
    );
  }).join("\n");
}

function row(...buttons) {
  return new ActionRowBuilder()
    .addComponents(buttons);
}

function button(
  action,
  label,
  style = ButtonStyle.Secondary,
  disabled = false
) {
  return new ButtonBuilder()
    .setCustomId(
      "preview_action:" + action
    )
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

function select(
  action,
  placeholder,
  values,
  min = 1,
  max = 1
) {
  const options = values.map(value => {
    return typeof value === "string"
      ? {
          label: value,
          value
        }
      : value;
  });

  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          "preview_choice:" + action
        )
        .setPlaceholder(placeholder)
        .setMinValues(min)
        .setMaxValues(max)
        .addOptions(options)
    );
}

// ==========================================
// DRAFT
// ==========================================

function currentDraftTeam(session) {
  const order = [
    "A", "B", "B", "A",
    "A", "B", "B", "A"
  ];

  return order[session.draftStep] || null;
}

function availableDraft(session) {
  return PLAYERS.map(
    player => player.id
  ).filter(id => {
    return (
      !session.teams.A.includes(id) &&
      !session.teams.B.includes(id)
    );
  });
}

function autoCaptains(session) {
  const totals = {};

  for (
    const voted of Object.values(
      session.votes
    )
  ) {
    totals[voted] =
      (totals[voted] || 0) + 1;
  }

  const ranked = PLAYERS.map(
    player => player.id
  ).sort((a, b) => {
    return (
      (totals[b] || 0) -
      (totals[a] || 0) ||
      a.localeCompare(b)
    );
  });

  session.captains = ranked.slice(0, 2);

  session.teams = {
    A: [session.captains[0]],
    B: [session.captains[1]]
  };

  session.draftStep = 0;
}

function ensureDraft(session) {
  if (session.captains.length !== 2) {
    autoCaptains(session);
  }
}

function ensureTeams(session) {
  ensureDraft(session);

  while (availableDraft(session).length) {
    const team =
      currentDraftTeam(session) ||
      (
        session.teams.A.length <=
        session.teams.B.length
          ? "A"
          : "B"
      );

    session.teams[team].push(
      availableDraft(session)[0]
    );

    session.draftStep++;
  }
}

function ensureMap(session) {
  if (!session.selectedMap) {
    session.selectedMap =
      MAP_POOL.find(map => {
        return !session.bans.some(
          ban => ban.map === map
        );
      }) || MAP_POOL[0];
  }
}

function ensureResult(session) {
  ensureTeams(session);
  ensureMap(session);

  if (!session.side) {
    session.side = "attack";
  }

  if (!session.winner) {
    session.winner = "A";
  }
}

// ==========================================
// CONSTRUIR PAINÉIS
// ==========================================

async function buildPanel(session) {
  const components = [];
  const files = [];

  let c;

  switch (session.panel) {
    case "queue": {
      c = container(
        "FILA COMPETITIVA",
        "SIMULAÇÃO · 5V5"
      );

      addText(
        c,
        `**Jogadores:** ${session.queue.length}/10\n` +
        `**Status:** ${
          session.queue.length === 10
            ? "Completa"
            : "Aberta"
        }`
      );

      separator(c);

      addText(
        c,
        "### JOGADORES NA FILA\n" +
        list(session.queue)
      );

      components.push(
        row(
          button(
            "join",
            "Adicionar jogador",
            ButtonStyle.Success,
            session.queue.length === 10
          ),
          button(
            "leave",
            "Remover jogador",
            ButtonStyle.Secondary,
            session.queue.length === 0
          )
        )
      );

      components.push(
        row(
          button(
            "fill",
            "Completar fila",
            ButtonStyle.Primary,
            session.queue.length === 10
          ),
          button(
            "to_ready",
            "Iniciar Ready Check",
            ButtonStyle.Success,
            session.queue.length !== 10
          )
        )
      );

      break;
    }

    case "ready": {
      c = container(
        "READY CHECK",
        "CONFIRMAÇÃO FICTÍCIA"
      );

      addText(
        c,
        `**Confirmados:** ${session.ready.length}/10\n` +
        "**Prazo demonstrativo:** sem limite"
      );

      separator(c);

      addText(
        c,
        PLAYERS.map(player => {
          return (
            (
              session.ready.includes(player.id)
                ? "✅"
                : "⏳"
            ) +
            " " +
            player.id
          );
        }).join("\n")
      );

      if (session.ready.length < 10) {
        components.push(
          select(
            "ready",
            "Confirmar jogador",
            PLAYERS.map(
              player => player.id
            ).filter(id => {
              return !session.ready.includes(id);
            })
          )
        );
      }

      components.push(
        row(
          button(
            "ready_all",
            "Confirmar todos",
            ButtonStyle.Primary,
            session.ready.length === 10
          ),
          button(
            "to_captains",
            "Votar capitães",
            ButtonStyle.Success,
            session.ready.length !== 10
          )
        )
      );

      break;
    }

    case "captains": {
      c = container(
        "VOTAÇÃO DE CAPITÃES",
        "10 JOGADORES · 2 CAPITÃES"
      );

      addText(
        c,
        `**Votos:** ${
          Object.keys(session.votes).length
        }/10\n` +
        `**Capitães:** ${
          session.captains.join(" e ") ||
          "A definir"
        }`
      );

      separator(c);

      addText(
        c,
        PLAYERS.map(player => {
          const voted =
            session.votes[player.id];

          return (
            (voted ? "✅" : "⏳") +
            " " +
            player.id +
            (
              voted
                ? " → " + voted
                : ""
            )
          );
        }).join("\n")
      );

      if (
        Object.keys(session.votes).length < 10
      ) {
        components.push(
          select(
            "captain",
            "Vote no capitão",
            PLAYERS.map(
              player => player.id
            )
          )
        );
      }

      components.push(
        row(
          button(
            "captain_auto",
            "Concluir votação",
            ButtonStyle.Primary
          ),
          button(
            "to_draft",
            "Ir ao draft",
            ButtonStyle.Success,
            session.captains.length !== 2
          )
        )
      );

      break;
    }

    case "draft": {
      ensureDraft(session);

      const available =
        availableDraft(session);

      const team =
        currentDraftTeam(session);

      c = container(
        "DRAFT 5V5",
        "ESCOLHA DE JOGADORES"
      );

      addText(
        c,
        `**Escolha:** ${
          Math.min(session.draftStep + 1, 8)
        }/8\n` +
        `**Vez:** ${
          team
            ? "Time " + team
            : "Concluído"
        }\n` +
        `**Disponíveis:** ${available.length}`
      );

      separator(c);

      addText(
        c,
        "### 🔴 TIME A\n" +
        list(
          session.teams.A,
          session.captains
        )
      );

      separator(c);

      addText(
        c,
        "### 🔵 TIME B\n" +
        list(
          session.teams.B,
          session.captains
        )
      );

      if (available.length) {
        components.push(
          select(
            "draft",
            "Escolha um jogador para o Time " +
              team,
            available
          )
        );
      }

      components.push(
        row(
          button(
            "draft_auto",
            "Completar draft",
            ButtonStyle.Primary,
            available.length === 0
          ),
          button(
            "to_maps",
            "Ir ao veto",
            ButtonStyle.Success,
            available.length !== 0
          )
        )
      );

      break;
    }

    case "maps": {
      c = container(
        "VETO DE MAPAS",
        "PICK & BAN · MELHOR DE 1"
      );

      const available =
        MAP_POOL.filter(map => {
          return !session.bans.some(
            ban => ban.map === map
          );
        });

      addText(
        c,
        `**Banimentos:** ${
          session.bans.length
        }/8\n` +
        `**Vez:** Time ${
          session.bans.length % 2
            ? "B"
            : "A"
        }\n` +
        `**Mapa escolhido:** ${
          session.selectedMap ||
          "A definir"
        }`
      );

      separator(c);

      addText(
        c,
        "### MAP POOL\n" +
        "-# Verde: disponível ou escolhido · " +
        "Vermelho: banido"
      );

      const name =
        "map-veto-preview.png";

      const image =
        await generateMapVetoImage({
          bannedMaps: session.bans,
          selectedMap: session.selectedMap
        });

      files.push(
        new AttachmentBuilder(image, {
          name
        })
      );

      const gallery =
        new MediaGalleryBuilder()
          .addItems(
            new MediaGalleryItemBuilder()
              .setURL(
                "attachment://" + name
              )
              .setDescription(
                "Mosaico 3x3 dos mapas"
              )
          );

      c.addMediaGalleryComponents(
        gallery
      );

      separator(c);

      addText(
        c,
        "### MAPAS DISPONÍVEIS\n" +
        (
          available.map(
            map => "🟢 " + map
          ).join("\n") ||
          "Nenhum"
        )
      );

      separator(c);

      addText(
        c,
        "### HISTÓRICO\n" +
        (
          session.bans.map(
            (ban, index) => {
              return (
                `${index + 1}. ❌ ` +
                ban.map +
                " · Time " +
                ban.captainTeam
              );
            }
          ).join("\n") ||
          "-# Sem banimentos"
        )
      );

      if (
        available.length > 1 &&
        !session.selectedMap
      ) {
        components.push(
          select(
            "map",
            "Banir um mapa",
            available
          )
        );
      }

      components.push(
        row(
          button(
            "map_auto",
            "Concluir veto",
            ButtonStyle.Primary,
            Boolean(session.selectedMap)
          ),
          button(
            "to_side",
            "Escolher lado",
            ButtonStyle.Success,
            !session.selectedMap
          )
        )
      );

      break;
    }

    case "side": {
      ensureTeams(session);
      ensureMap(session);

      c = container(
        "ESCOLHA DE LADO",
        "CONFIGURAÇÃO DA PARTIDA"
      );

      addText(
        c,
        `**Mapa:** ${session.selectedMap}\n` +
        `**Time A:** ${
          session.side === "attack"
            ? "Ataque"
            : session.side === "defense"
              ? "Defesa"
              : "A definir"
        }`
      );

      separator(c);

      addText(
        c,
        "### 🔴 TIME A\n" +
        list(
          session.teams.A,
          session.captains
        )
      );

      separator(c);

      addText(
        c,
        "### 🔵 TIME B\n" +
        list(
          session.teams.B,
          session.captains
        )
      );

      components.push(
        row(
          button(
            "attack",
            "Ataque",
            ButtonStyle.Danger
          ),
          button(
            "defense",
            "Defesa",
            ButtonStyle.Primary
          )
        )
      );

      components.push(
        row(
          button(
            "to_match",
            "Iniciar partida",
            ButtonStyle.Success,
            !session.side
          )
        )
      );

      break;
    }

    case "match": {
      ensureTeams(session);
      ensureMap(session);

      c = container(
        "PARTIDA COMPETITIVA",
        "PARTIDA DEMONSTRATIVA #482731"
      );

      addText(
        c,
        `**Mapa:** ${session.selectedMap}\n` +
        `**Status:** ${
          session.reported
            ? "Resultado informado"
            : "Em andamento"
        }`
      );

      separator(c);

      addText(
        c,
        "### 🔴 TIME A · " +
        (
          session.side === "defense"
            ? "DEFESA"
            : "ATAQUE"
        ) +
        "\n" +
        list(
          session.teams.A,
          session.captains
        )
      );

      separator(c);

      addText(
        c,
        "### 🔵 TIME B · " +
        (
          session.side === "defense"
            ? "ATAQUE"
            : "DEFESA"
        ) +
        "\n" +
        list(
          session.teams.B,
          session.captains
        )
      );

      components.push(
        row(
          button(
            "winner_A",
            "Vitória Time A",
            ButtonStyle.Danger
          ),
          button(
            "winner_B",
            "Vitória Time B",
            ButtonStyle.Primary
          )
        )
      );

      break;
    }

    case "confirm": {
      ensureResult(session);

      c = container(
        "CONFIRMAÇÃO DE RESULTADO",
        "PARTIDA #482731"
      );

      addText(
        c,
        `**Mapa:** ${session.selectedMap}\n` +
        `**Vencedor informado:** Time ${
          session.winner
        }\n` +
        `**Status:** ${
          session.disputed
            ? "⚠️ Contestado"
            : "⏳ Aguardando confirmação"
        }`
      );

      separator(c);

      addText(
        c,
        session.disputed
          ? "A Staff pode decidir o vencedor " +
            "ou cancelar a simulação."
          : "Confirme ou conteste o " +
            "resultado fictício."
      );

      if (!session.disputed) {
        components.push(
          row(
            button(
              "confirm",
              "Confirmar",
              ButtonStyle.Success
            ),
            button(
              "dispute",
              "Contestar",
              ButtonStyle.Danger
            )
          )
        );
      } else {
        components.push(
          row(
            button(
              "staff_A",
              "Staff: Time A",
              ButtonStyle.Danger
            ),
            button(
              "staff_B",
              "Staff: Time B",
              ButtonStyle.Primary
            ),
            button(
              "cancel",
              "Cancelar",
              ButtonStyle.Secondary
            )
          )
        );
      }

      break;
    }

    case "result": {
      ensureResult(session);

      c = container(
        "PARTIDA FINALIZADA",
        "PARTIDA #482731"
      );

      addText(
        c,
        `**Mapa:** ${session.selectedMap}\n` +
        `**Status:** ${
          session.finished
            ? "Finalizada"
            : "Prévia demonstrativa"
        }\n` +
        `🏆 **Time ${
          session.winner
        } venceu!**`
      );

      separator(c);

      addText(
        c,
        "### 🏆 VENCEDORES · +5 PONTOS\n" +
        list(
          session.teams[session.winner],
          session.captains
        )
      );

      separator(c);

      addText(
        c,
        "### DERROTADOS · -3 PONTOS\n" +
        list(
          session.teams[
            session.winner === "A"
              ? "B"
              : "A"
          ],
          session.captains
        )
      );

      break;
    }

    default:
      throw new Error(
        "INVALID_PREVIEW_PANEL"
      );
  }

  separator(c);

  addText(
    c,
    "-# Ambiente de testes · " +
    "Nenhum dado real é modificado"
  );

  components.unshift(c);

  components.push(
    new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("preview_select")
          .setPlaceholder(
            "Navegar pelos painéis"
          )
          .addOptions(
            PANELS.map(
              ([value, label]) => ({
                value,
                label,
                default:
                  value === session.panel
              })
            )
          )
      )
  );

  components.push(
    row(
      button(
        "reset",
        "Reiniciar simulação",
        ButtonStyle.Secondary
      )
    )
  );

  return {
    components,
    files,
    allowedMentions: {
      parse: []
    }
  };
}

// ==========================================
// MENSAGEM DO PREVIEW
// ==========================================

async function createPreviewMessage(
  type = "queue",
  session = null
) {
  const current =
    session || newSession();

  current.panel = PANELS.some(
    panel => panel[0] === type
  )
    ? type
    : "queue";

  return {
    ...await buildPanel(current),
    flags: MessageFlags.IsComponentsV2
  };
}

// ==========================================
// COMANDO /PREVIEW
// ==========================================

const command = new SlashCommandBuilder()
  .setName("preview")
  .setDescription(
    "Simular os painéis do InviSixTational."
  )
  .setDMPermission(false);

async function executePreview(interaction) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content:
        "Acesso restrito à Staff.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  const session = getSession(
    interaction.user.id,
    true
  );

  return interaction.editReply(
    await createPreviewMessage(
      "queue",
      session
    )
  );
}

// ==========================================
// NAVEGAÇÃO
// ==========================================

async function handlePreviewSelect(interaction) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content:
        "Acesso restrito à Staff.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate();

  const session = getSession(
    interaction.user.id
  );

  const type =
    interaction.values?.[0];

  if (
    !PANELS.some(
      panel => panel[0] === type
    )
  ) {
    return interaction.followUp({
      content: "Painel inválido.",
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.editReply({
    ...await createPreviewMessage(
      type,
      session
    ),
    attachments: []
  });
}

// ==========================================
// AÇÕES INTERATIVAS
// ==========================================

async function handlePreviewAction(interaction) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content:
        "Acesso restrito à Staff.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate();

  let session = getSession(
    interaction.user.id
  );

  const action =
    interaction.customId.slice(15);

  const value =
    interaction.isStringSelectMenu()
      ? interaction.values?.[0]
      : null;

  switch (action) {
    case "reset":
      session = getSession(
        interaction.user.id,
        true
      );
      break;

    case "join": {
      const id = PLAYERS.map(
        player => player.id
      ).find(id => {
        return !session.queue.includes(id);
      });

      if (id) {
        session.queue.push(id);
      }

      break;
    }

    case "leave":
      session.queue.pop();
      break;

    case "fill":
      session.queue = PLAYERS.map(
        player => player.id
      );
      break;

    case "to_ready":
      if (session.queue.length === 10) {
        session.panel = "ready";
      }
      break;

    case "ready":
      if (
        PLAYERS.some(
          player => player.id === value
        ) &&
        !session.ready.includes(value)
      ) {
        session.ready.push(value);
      }
      break;

    case "ready_all":
      session.ready = PLAYERS.map(
        player => player.id
      );
      break;

    case "to_captains":
      if (session.ready.length === 10) {
        session.panel = "captains";
      }
      break;

    case "captain": {
      if (
        !PLAYERS.some(
          player => player.id === value
        )
      ) {
        break;
      }

      const voter = PLAYERS.map(
        player => player.id
      ).find(id => {
        return !Object.hasOwn(
          session.votes,
          id
        );
      });

      if (voter) {
        session.votes[voter] = value;
      }

      if (
        Object.keys(
          session.votes
        ).length === 10
      ) {
        autoCaptains(session);
      }

      break;
    }

    case "captain_auto":
      autoCaptains(session);
      break;

    case "to_draft":
      if (
        session.captains.length === 2
      ) {
        session.panel = "draft";
      }
      break;

    case "draft": {
      ensureDraft(session);

      if (
        availableDraft(session).includes(
          value
        )
      ) {
        session.teams[
          currentDraftTeam(session)
        ].push(value);

        session.draftStep++;
      }

      break;
    }

    case "draft_auto":
      ensureTeams(session);
      break;

    case "to_maps":
      if (
        !availableDraft(session).length
      ) {
        session.panel = "maps";
      }
      break;

    case "map": {
      const available = MAP_POOL.filter(
        map => {
          return !session.bans.some(
            ban => ban.map === map
          );
        }
      );

      if (
        !session.selectedMap &&
        available.length > 1 &&
        available.includes(value)
      ) {
        session.bans.push({
          map: value,
          captainTeam:
            session.bans.length % 2 === 0
              ? "A"
              : "B"
        });

        if (session.bans.length === 8) {
          ensureMap(session);
        }
      }

      break;
    }

    case "map_auto": {
      while (session.bans.length < 8) {
        const map = MAP_POOL.find(
          item => {
            return !session.bans.some(
              ban => ban.map === item
            );
          }
        );

        session.bans.push({
          map,
          captainTeam:
            session.bans.length % 2 === 0
              ? "A"
              : "B"
        });
      }

      ensureMap(session);
      break;
    }

    case "to_side":
      if (session.selectedMap) {
        session.panel = "side";
      }
      break;

    case "attack":
      session.side = "attack";
      break;

    case "defense":
      session.side = "defense";
      break;

    case "to_match":
      if (session.side) {
        session.panel = "match";
      }
      break;

    case "winner_A":
    case "winner_B":
      session.winner =
        action.slice(-1);

      session.reported = true;
      session.disputed = false;
      session.panel = "confirm";
      break;

    case "confirm":
      session.finished = true;
      session.panel = "result";
      break;

    case "dispute":
      session.disputed = true;
      break;

    case "staff_A":
    case "staff_B":
      session.winner =
        action.slice(-1);

      session.finished = true;
      session.panel = "result";
      break;

    case "cancel":
      session.reported = false;
      session.disputed = false;
      session.winner = null;
      session.panel = "match";
      break;

    default:
      break;
  }

  return interaction.editReply({
    ...await createPreviewMessage(
      session.panel,
      session
    ),
    attachments: []
  });
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  command,
  executePreview,
  handlePreviewSelect,
  handlePreviewAction,
  createPreviewMessage
};
