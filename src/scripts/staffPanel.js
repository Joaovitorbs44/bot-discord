
const {
  EmbedBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits
} = require("discord.js");

const db = require("../database/database");
const config = require("../config/config");
const queueState = require("./queueState");

const PREFIX = "staff_panel:";

async function isStaff(interaction) {
  if (!interaction.inGuild()) return false;

  const member = await interaction.guild.members.fetch(
    interaction.user.id
  );

  const staffRoleId = config.discord.staffRoleId;

  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    Boolean(
      staffRoleId &&
      member.roles.cache.has(staffRoleId)
    )
  );
}

function safeQuery(sql, ...params) {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    console.error("Erro no painel da Staff:", error);
    return [];
  }
}

function safeGet(sql, ...params) {
  try {
    return db.prepare(sql).get(...params) || null;
  } catch (error) {
    console.error("Erro no painel da Staff:", error);
    return null;
  }
}

function formatDate(value) {
  if (!value) return "—";

  let date;

  if (typeof value === "number") {
    date = new Date(value);
  } else if (/^\d+$/.test(String(value))) {
    date = new Date(Number(value));
  } else {
    date = new Date(
      String(value).replace(" ", "T") + "Z"
    );
  }

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function shorten(value, max = 950) {
  const text = String(value || "Nenhum registro.");

  return text.length > max
    ? text.slice(0, max - 3) + "..."
    : text;
}

function createButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}home`)
        .setLabel("Início")
        .setEmoji("🏠")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(`${PREFIX}queue`)
        .setLabel("Fila")
        .setEmoji("👥")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId(`${PREFIX}matches`)
        .setLabel("Partidas")
        .setEmoji("🎮")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId(`${PREFIX}penalties`)
        .setLabel("Punições")
        .setEmoji("⏱️")
        .setStyle(ButtonStyle.Primary)
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}system`)
        .setLabel("Sistema")
        .setEmoji("⚙️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(`${PREFIX}refresh`)
        .setLabel("Atualizar")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function createHomeEmbed() {
  const session = queueState.getActiveSession();

  const activeMatches = safeGet(`
    SELECT COUNT(*) AS total
    FROM matches
    WHERE status IN (
      'playing',
      'pending_confirmation',
      'disputed'
    )
  `);

  const pendingResults = safeGet(`
    SELECT COUNT(*) AS total
    FROM matches
    WHERE status = 'pending_confirmation'
  `);

  const disputes = safeGet(`
    SELECT COUNT(*) AS total
    FROM matches
    WHERE status = 'disputed'
  `);

  const penalties = safeGet(`
    SELECT COUNT(*) AS total
    FROM player_cooldowns
    WHERE expires_at > ?
  `, Date.now());

  return new EmbedBuilder()
    .setColor(0xFF3D2C)
    .setTitle("🛡️ InviSixTational • Painel da Staff")
    .setDescription(
      "Central administrativa do matchmaking.\n\n" +
      "Utilize os botões para consultar informações atualizadas."
    )
    .addFields(
      {
        name: "Jogadores na fila",
        value: String(queueState.getSize()),
        inline: true
      },
      {
        name: "Etapa atual",
        value: session?.stage || "queue",
        inline: true
      },
      {
        name: "Partidas ativas",
        value: String(activeMatches?.total || 0),
        inline: true
      },
      {
        name: "Resultados pendentes",
        value: String(pendingResults?.total || 0),
        inline: true
      },
      {
        name: "Contestações",
        value: String(disputes?.total || 0),
        inline: true
      },
      {
        name: "Punições ativas",
        value: String(penalties?.total || 0),
        inline: true
      }
    )
    .setFooter({
      text: "Acesso exclusivo da Staff • Somente consulta"
    })
    .setTimestamp();
}

function createQueueEmbed() {
  const players = queueState.getPlayers();
  const session = queueState.getActiveSession();

  const list = players.length
    ? players.map((player, index) => {
        return (
          `**${index + 1}.** ` +
          `<@${player.discordId}> — ` +
          `${player.nickname || "Sem nick"}`
        );
      }).join("\n")
    : "Nenhum jogador na fila.";

  return new EmbedBuilder()
    .setColor(0xFF3D2C)
    .setTitle("👥 Staff • Fila")
    .setDescription(shorten(list, 3900))
    .addFields(
      {
        name: "Jogadores",
        value: `${players.length}/${config.matchmaking.requiredPlayers}`,
        inline: true
      },
      {
        name: "Status",
        value: queueState.isQueueLocked()
          ? "Bloqueada"
          : "Aberta",
        inline: true
      },
      {
        name: "Etapa",
        value: session?.stage || "queue",
        inline: true
      }
    )
    .setTimestamp();
}

function createMatchesEmbed() {
  const matches = safeQuery(`
    SELECT
      match_code,
      map,
      status,
      captain_a_discord_id,
      captain_b_discord_id
    FROM matches
    WHERE status IN (
      'playing',
      'pending_confirmation',
      'disputed'
    )
    ORDER BY id DESC
    LIMIT 10
  `);

  const statusLabels = {
    playing: "Em andamento",
    pending_confirmation: "Aguardando confirmação",
    disputed: "Contestada"
  };

  const list = matches.length
    ? matches.map(match => {
        return (
          `**${match.match_code}** • ${match.map}\n` +
          `Status: ${statusLabels[match.status] || match.status}\n` +
          `Capitães: <@${match.captain_a_discord_id}> / ` +
          `<@${match.captain_b_discord_id}>`
        );
      }).join("\n\n")
    : "Nenhuma partida pendente ou em andamento.";

  return new EmbedBuilder()
    .setColor(0xFF3D2C)
    .setTitle("🎮 Staff • Partidas")
    .setDescription(shorten(list, 3900))
    .setFooter({
      text: "Exibindo até 10 partidas"
    })
    .setTimestamp();
}

function createPenaltiesEmbed() {
  const penalties = safeQuery(`
    SELECT
      discord_id,
      reason,
      expires_at
    FROM player_cooldowns
    WHERE expires_at > ?
    ORDER BY expires_at ASC
    LIMIT 10
  `, Date.now());

  const list = penalties.length
    ? penalties.map(penalty => {
        const minutes = Math.max(
          1,
          Math.ceil(
            (Number(penalty.expires_at) - Date.now()) / 60000
          )
        );

        return (
          `<@${penalty.discord_id}>\n` +
          `Motivo: ${penalty.reason || "Não informado"}\n` +
          `Restante: **${minutes} min**`
        );
      }).join("\n\n")
    : "Nenhuma punição ativa.";

  return new EmbedBuilder()
    .setColor(0xFF3D2C)
    .setTitle("⏱️ Staff • Punições")
    .setDescription(shorten(list, 3900))
    .setFooter({
      text: "Para remover uma punição, use /remover-timeout"
    })
    .setTimestamp();
}

function createSystemEmbed(client) {
  const session = queueState.getActiveSession();

  const totalPlayers = safeGet(`
    SELECT COUNT(*) AS total
    FROM players
  `);

  const totalMatches = safeGet(`
    SELECT COUNT(*) AS total
    FROM matches
  `);

  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  return new EmbedBuilder()
    .setColor(0xFF3D2C)
    .setTitle("⚙️ Staff • Sistema")
    .addFields(
      {
        name: "Discord",
        value: client.isReady()
          ? "Conectado"
          : "Desconectado",
        inline: true
      },
      {
        name: "Tempo de atividade",
        value: `${hours}h ${minutes}min`,
        inline: true
      },
      {
        name: "Banco de dados",
        value: "SQLite",
        inline: true
      },
      {
        name: "Jogadores cadastrados",
        value: String(totalPlayers?.total || 0),
        inline: true
      },
      {
        name: "Partidas registradas",
        value: String(totalMatches?.total || 0),
        inline: true
      },
      {
        name: "Sessão ativa",
        value: session
          ? `#${session.id} • ${session.stage}`
          : "Nenhuma",
        inline: false
      }
    )
    .setTimestamp();
}

// Premium Glass: converte as visualizações existentes sem alterar suas consultas ou permissões.
function createGlassPanel(view, client) {
  const embed = createPanel(view, client).toJSON();
  const parts = [
    "## INVI SIX PRO",
    "-# CENTRAL DA STAFF  /  " + String(embed.title || "VISÃO GERAL").replace(/^.*?Staff\s*[•·]\s*/i, "").toUpperCase()
  ];
  const container = new ContainerBuilder()
    .setAccentColor(0xFF3D2C)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.join("\n")))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
  if (embed.description) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(embed.description.slice(0, 3800)));
  }
  const fields = embed.fields || [];
  if (fields.length) {
    const lines = fields.map(field => "**" + field.name + "**\n" + field.value);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n\n").slice(0, 3800)));
  }
  if (embed.footer?.text) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# " + embed.footer.text));
  }
  return container;
}

function createPanel(view, client) {
  switch (view) {
    case "queue":
      return createQueueEmbed();

    case "matches":
      return createMatchesEmbed();

    case "penalties":
      return createPenaltiesEmbed();

    case "system":
      return createSystemEmbed(client);

    default:
      return createHomeEmbed();
  }
}

async function handleStaffPanel(interaction) {
  if (!(await isStaff(interaction))) {
    return interaction.reply({
      content: "Somente a Staff pode acessar este painel.",
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.reply({
    components: [createGlassPanel("home", interaction.client), ...createButtons()],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  });
}

async function handleStaffPanelButton(interaction) {
  if (!(await isStaff(interaction))) {
    return interaction.reply({
      content: "Você não possui permissão para usar este painel.",
      flags: MessageFlags.Ephemeral
    });
  }

  const view = interaction.customId.slice(PREFIX.length);

  const allowedViews = new Set([
    "home",
    "queue",
    "matches",
    "penalties",
    "system",
    "refresh"
  ]);

  if (!allowedViews.has(view)) {
    return interaction.reply({
      content: "Ação inválida.",
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.update({
    components: [createGlassPanel(view === "refresh" ? "home" : view, interaction.client), ...createButtons()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  });
}

module.exports = {
  handleStaffPanel,
  handleStaffPanelButton
};
