
const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits
} = require("discord.js");

const config = require("../config/config");

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const PRIMARY = 0xFF3D2C;

const PLAYERS = Array.from(
  { length: 10 },
  (_, index) => ({
    id: `player${String(index + 1).padStart(2, "0")}`,
    nickname:
      `player${String(index + 1).padStart(2, "0")}`,
    rank: [
      "Diamante",
      "Esmeralda",
      "Platina",
      "Ouro",
      "Prata"
    ][index % 5]
  })
);

const TEAM_A = [
  PLAYERS[0],
  PLAYERS[2],
  PLAYERS[4],
  PLAYERS[6],
  PLAYERS[8]
];

const TEAM_B = [
  PLAYERS[1],
  PLAYERS[3],
  PLAYERS[5],
  PLAYERS[7],
  PLAYERS[9]
];

const MAPS = [
  "Bank",
  "Border",
  "Chalet",
  "Clubhouse",
  "Villa",
  "Kafe Dostoyevsky",
  "Lair",
  "Nighthaven Labs",
  "Fortress"
];

const PANELS = [
  { label: "Fila", value: "queue", emoji: "🎮" },
  { label: "Ready Check", value: "ready", emoji: "✅" },
  { label: "Capitães", value: "captains", emoji: "👑" },
  { label: "Draft", value: "draft", emoji: "🎯" },
  { label: "Veto de mapas", value: "maps", emoji: "🗺️" },
  { label: "Escolha de lado", value: "side", emoji: "⚔️" },
  { label: "Partida", value: "match", emoji: "🏆" },
  { label: "Confirmação", value: "confirm", emoji: "📋" },
  { label: "Resultado final", value: "result", emoji: "🥇" }
];

// ==========================================
// PERMISSÕES
// ==========================================

function isStaff(interaction) {
  const roleId = config.discord?.staffRoleId;

  const hasRole = Boolean(
    roleId &&
    (
      interaction.member?.roles?.cache?.has?.(roleId) ||
      (
        Array.isArray(interaction.member?.roles) &&
        interaction.member.roles.includes(roleId)
      )
    )
  );

  const administrator =
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    ) || false;

  return hasRole || administrator;
}

// ==========================================
// UTILITÁRIOS
// ==========================================

function separator(container) {
  return container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small)
  );
}

function addText(container, text) {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(text)
  );

  return container;
}

function listPlayers(players, captain = null) {
  return players.map(player => {
    const marker =
      player.id === captain ? "👑" : "•";

    return (
      `${marker} **${player.nickname}**` +
      ` · ${player.rank}`
    );
  }).join("\n");
}

function createContainer(title, subtitle) {
  const container = new ContainerBuilder()
    .setAccentColor(PRIMARY);

  addText(
    container,
    "## INVISIXTATIONAL\n" +
    `### ${title}\n` +
    `-# ${subtitle}`
  );

  separator(container);

  return container;
}

function createButton(id, label, emoji, style) {
  return new ButtonBuilder()
    .setCustomId(`preview_demo_${id}`)
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(style)
    .setDisabled(true);
}

function buttonRow(...buttons) {
  return new ActionRowBuilder()
    .addComponents(buttons);
}

// ==========================================
// PAINÉIS
// ==========================================

function buildPanel(type) {
  let container;
  const components = [];

  switch (type) {
    case "queue": {
      container = createContainer(
        "FILA COMPETITIVA",
        "MATCHMAKING · 5V5"
      );

      addText(
        container,
        "**Status:** 🟢 Aberta\n" +
        "**Jogadores:** 6/10\n" +
        "**Formato:** Melhor de 1 · 5v5"
      );

      separator(container);

      addText(
        container,
        "### JOGADORES NA FILA\n" +
        listPlayers(PLAYERS.slice(0, 6))
      );

      components.push(
        buttonRow(
          createButton(
            "join",
            "Entrar na fila",
            "➕",
            ButtonStyle.Success
          ),
          createButton(
            "leave",
            "Sair da fila",
            "➖",
            ButtonStyle.Secondary
          )
        )
      );

      break;
    }

    case "ready": {
      container = createContainer(
        "READY CHECK",
        "CONFIRMAÇÃO DE PRESENÇA"
      );

      addText(
        container,
        "**Status:** Aguardando jogadores\n" +
        "**Confirmados:** 7/10\n" +
        "**Prazo:** 60 segundos"
      );

      separator(container);

      addText(
        container,
        PLAYERS.map((player, index) =>
          `${index < 7 ? "✅" : "⏳"} ` +
          player.nickname
        ).join("\n")
      );

      components.push(
        buttonRow(
          createButton(
            "ready",
            "Confirmar presença",
            "✅",
            ButtonStyle.Success
          )
        )
      );

      break;
    }

    case "captains": {
      container = createContainer(
        "VOTAÇÃO DE CAPITÃES",
        "10 JOGADORES · 2 CAPITÃES"
      );

      addText(
        container,
        "**Votos registrados:** 6/10\n" +
        "Cada jogador escolhe um capitão."
      );

      separator(container);

      addText(
        container,
        PLAYERS.map((player, index) =>
          `• ${player.nickname} · ` +
          `${index < 6 ? "Votou" : "Pendente"}`
        ).join("\n")
      );

      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("preview_demo_captain")
            .setPlaceholder("Escolha um capitão")
            .setDisabled(true)
            .addOptions(
              PLAYERS.map(player => ({
                label: player.nickname,
                value: player.id
              }))
            )
        )
      );

      break;
    }

    case "draft": {
      container = createContainer(
        "DRAFT 5V5",
        "ESCOLHA DE JOGADORES"
      );

      addText(
        container,
        "**Rodada:** 2/5\n" +
        "**Vez:** player02 · Time B\n" +
        "**Escolhas:** 2 jogadores\n" +
        "**Prazo:** 45 segundos"
      );

      separator(container);

      addText(
        container,
        "### 🔴 TIME A\n" +
        listPlayers(
          [PLAYERS[0], PLAYERS[2]],
          "player01"
        )
      );

      separator(container);

      addText(
        container,
        "### 🔵 TIME B\n" +
        listPlayers(
          [PLAYERS[1]],
          "player02"
        )
      );

      separator(container);

      const available = PLAYERS.filter(
        player =>
          !["player01", "player02", "player03"]
            .includes(player.id)
      );

      addText(
        container,
        "### DISPONÍVEIS\n" +
        listPlayers(available)
      );

      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("preview_demo_draft")
            .setPlaceholder("Escolha 2 jogadores")
            .setMinValues(2)
            .setMaxValues(2)
            .setDisabled(true)
            .addOptions(
              available.map(player => ({
                label: player.nickname,
                description: player.rank,
                value: player.id
              }))
            )
        )
      );

      break;
    }

    case "maps": {
      container = createContainer(
        "VETO DE MAPAS",
        "PICK & BAN · 9 MAPAS"
      );

      addText(
        container,
        "**Vez:** player01 · Time A\n" +
        "**Tempo:** 30 segundos\n" +
        "**Mapas restantes:** 7"
      );

      separator(container);

      addText(
        container,
        "### MAPAS DISPONÍVEIS\n" +
        MAPS.slice(2).map(map =>
          `• ${map}`
        ).join("\n")
      );

      separator(container);

      addText(
        container,
        "### BANIMENTOS\n" +
        "❌ Bank · Time A\n" +
        "❌ Border · Time B"
      );

      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("preview_demo_map")
            .setPlaceholder("Escolha um mapa para banir")
            .setDisabled(true)
            .addOptions(
              MAPS.slice(2).map(map => ({
                label: map,
                value: map
              }))
            )
        )
      );

      break;
    }

    case "side": {
      container = createContainer(
        "ESCOLHA DE LADO",
        "CONFIGURAÇÃO DA PARTIDA"
      );

      addText(
        container,
        "**Mapa:** Chalet\n" +
        "**Capitão responsável:** player01\n\n" +
        "O Time A escolhe o lado inicial."
      );

      separator(container);

      addText(
        container,
        "### 🔴 TIME A\n" +
        listPlayers(TEAM_A, "player01")
      );

      separator(container);

      addText(
        container,
        "### 🔵 TIME B\n" +
        listPlayers(TEAM_B, "player02")
      );

      components.push(
        buttonRow(
          createButton(
            "attack",
            "Ataque",
            "⚔️",
            ButtonStyle.Danger
          ),
          createButton(
            "defense",
            "Defesa",
            "🛡️",
            ButtonStyle.Primary
          )
        )
      );

      break;
    }

    case "match": {
      container = createContainer(
        "PARTIDA COMPETITIVA",
        "PARTIDA #482731 · 5V5"
      );

      addText(
        container,
        "**Mapa:** Chalet\n" +
        "**Status:** 🟢 Em andamento\n" +
        "**Temporada:** Temporada atual"
      );

      separator(container);

      addText(
        container,
        "### 🔴 TIME A · ⚔️ ATAQUE\n" +
        listPlayers(TEAM_A, "player01")
      );

      separator(container);

      addText(
        container,
        "### 🔵 TIME B · 🛡️ DEFESA\n" +
        listPlayers(TEAM_B, "player02")
      );

      components.push(
        buttonRow(
          createButton(
            "report",
            "Informar resultado",
            "📋",
            ButtonStyle.Primary
          )
        )
      );

      break;
    }

    case "confirm": {
      container = createContainer(
        "CONFIRMAÇÃO DE RESULTADO",
        "PARTIDA #482731"
      );

      addText(
        container,
        "**Mapa:** Chalet\n" +
        "**Resultado informado:** Time A venceu\n" +
        "**Status:** ⏳ Aguardando confirmação"
      );

      separator(container);

      addText(
        container,
        "O capitão **player02** precisa confirmar " +
        "ou contestar o resultado."
      );

      components.push(
        buttonRow(
          createButton(
            "confirm",
            "Confirmar",
            "✅",
            ButtonStyle.Success
          ),
          createButton(
            "dispute",
            "Contestar",
            "⚠️",
            ButtonStyle.Danger
          )
        )
      );

      break;
    }

    case "result": {
      container = createContainer(
        "PARTIDA FINALIZADA",
        "PARTIDA #482731"
      );

      addText(
        container,
        "**Mapa:** Chalet\n" +
        "**Status:** ✅ Finalizada\n" +
        "🏆 **Time A venceu!**"
      );

      separator(container);

      addText(
        container,
        "### 🏆 VENCEDORES · +5 PONTOS\n" +
        listPlayers(TEAM_A, "player01")
      );

      separator(container);

      addText(
        container,
        "### DERROTADOS · −3 PONTOS\n" +
        listPlayers(TEAM_B, "player02")
      );

      break;
    }

    default:
      throw new Error("INVALID_PREVIEW_PANEL");
  }

  return {
    components: [
      container,
      ...components
    ],
    flags:
      MessageFlags.IsComponentsV2 |
      MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

// ==========================================
// MENU DE NAVEGAÇÃO
// ==========================================

function createNavigation() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("preview_select")
      .setPlaceholder("Escolha o painel para visualizar")
      .addOptions(
        PANELS.map(panel => ({
          label: panel.label,
          value: panel.value,
          emoji: panel.emoji
        }))
      )
  );
}

function createPreviewMessage(type = "queue") {
  const panel = buildPanel(type);

  return {
    ...panel,
    components: [
      ...panel.components,
      createNavigation()
    ]
  };
}

// ==========================================
// COMANDO /PREVIEW
// ==========================================

const command = new SlashCommandBuilder()
  .setName("preview")
  .setDescription(
    "Visualizar os painéis do InviSixTational."
  )
  .setDMPermission(false);

async function executePreview(interaction) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content:
        "Somente a Staff pode visualizar os painéis.",
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.reply(
    createPreviewMessage()
  );
}

// ==========================================
// MENU INTERATIVO
// ==========================================

async function handlePreviewSelect(interaction) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content: "Acesso restrito à Staff.",
      flags: MessageFlags.Ephemeral
    });
  }

  const type = interaction.values?.[0];

  if (!PANELS.some(panel => panel.value === type)) {
    return interaction.reply({
      content: "Painel inválido.",
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.update(
    createPreviewMessage(type)
  );
}

// ==========================================
// EXPORTAÇÕES
// ==========================================

module.exports = {
  command,
  executePreview,
  handlePreviewSelect,
  createPreviewMessage
};
