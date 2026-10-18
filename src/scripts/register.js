
const {
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const config = require("../config/config");

const {
  command: previewCommand
} = require("./preview");

const { command: homologationCommand } = require("./homologation");

const { commands: scoreboardCommands } = require("./scoreboards");

const commands = [
  ...scoreboardCommands,
  homologationCommand,
  new SlashCommandBuilder()
    .setName("perfil")
    .setDescription("Mostra o perfil de um jogador.")
    .addUserOption(option =>
      option
        .setName("jogador")
        .setDescription("Jogador que deseja consultar.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ranking")
    .setDescription("Mostra o ranking da temporada atual."),

  new SlashCommandBuilder()
    .setName("historico")
    .setDescription("Mostra as últimas partidas de um jogador.")
    .addUserOption(option =>
      option
        .setName("jogador")
        .setDescription("Jogador que deseja consultar.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("partida")
    .setDescription("Consulta uma partida pelo código.")
    .addStringOption(option =>
      option
        .setName("codigo")
        .setDescription("Código da partida. Ex: 583241")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("temporada")
    .setDescription("Consulta a temporada atual ou uma temporada anterior.")
    .addIntegerOption(option =>
      option
        .setName("numero")
        .setDescription("Número da temporada.")
        .setRequired(false)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("temporadas")
    .setDescription("Mostra o histórico de temporadas."),

  new SlashCommandBuilder()
    .setName("remover-acesso")
    .setDescription("Remove o acesso de um jogador ao matchmaking.")
    .addUserOption(option =>
      option
        .setName("jogador")
        .setDescription("Jogador que perderá o acesso ao matchmaking.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("solicitacoes")
    .setDescription("Mostra novamente as solicitações de acesso pendentes."),

  new SlashCommandBuilder()
    .setName("remover-fila")
    .setDescription("Remove manualmente um jogador da fila.")
    .addUserOption(option =>
      option
        .setName("jogador")
        .setDescription("Jogador que será removido da fila.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("limpar-fila")
    .setDescription("Limpa completamente a fila do matchmaking."),

  new SlashCommandBuilder()
    .setName("remover-timeout")
    .setDescription("Remove a penalidade de Ready Check de um jogador.")
    .addUserOption(option =>
      option
        .setName("jogador")
        .setDescription("Jogador que terá o timeout removido.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("painel-staff")
    .setDescription("Abre o painel administrativo do matchmaking."),

  // ========================================
  // COMANDOS DE PONTUAÇÃO
  // ========================================

  new SlashCommandBuilder()
    .setName("pontos")
    .setDescription("Consulta e gerencia os pontos dos jogadores.")

    .addSubcommand(subcommand =>
      subcommand
        .setName("adicionar")
        .setDescription("Adiciona pontos (Staff).")
        .addUserOption(option =>
          option
            .setName("jogador")
            .setDescription("Jogador")
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName("quantidade")
            .setDescription("Pontos a adicionar")
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption(option =>
          option
            .setName("motivo")
            .setDescription("Motivo")
            .setRequired(false)
        )
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName("remover")
        .setDescription("Remove pontos (Staff).")
        .addUserOption(option =>
          option
            .setName("jogador")
            .setDescription("Jogador")
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName("quantidade")
            .setDescription("Pontos a remover")
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption(option =>
          option
            .setName("motivo")
            .setDescription("Motivo")
            .setRequired(false)
        )
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName("definir")
        .setDescription("Define a pontuação exata (Staff).")
        .addUserOption(option =>
          option
            .setName("jogador")
            .setDescription("Jogador")
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName("quantidade")
            .setDescription("Nova pontuação")
            .setRequired(true)
            .setMinValue(0)
        )
        .addStringOption(option =>
          option
            .setName("motivo")
            .setDescription("Motivo")
            .setRequired(false)
        )
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName("consultar")
        .setDescription("Consulta os pontos de um jogador.")
        .addUserOption(option =>
          option
            .setName("jogador")
            .setDescription("Jogador")
            .setRequired(false)
        )
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName("historico")
        .setDescription("Consulta ajustes manuais (Staff).")
        .addUserOption(option =>
          option
            .setName("jogador")
            .setDescription("Jogador")
            .setRequired(true)
        )
    ),

  previewCommand
].map(command => command.toJSON());

// ==========================================
// API DO DISCORD
// ==========================================

const rest = new REST({
  version: "10"
}).setToken(config.discord.token);

async function registerCommands() {
  try {
    const registered = await rest.put(
      Routes.applicationGuildCommands(
        config.discord.clientId,
        config.discord.guildId
      ),
      {
        body: commands
      }
    );

    console.log(
      `${registered.length} comandos registrados com sucesso.`
    );
  } catch (error) {
    console.error(
      "Erro ao registrar comandos:",
      error
    );

    process.exitCode = 1;
  }
}

registerCommands();

