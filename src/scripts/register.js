
const {
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const config = require("../config/config");

const commands = [
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
    .setDescription(
      "Consulta a temporada atual ou uma temporada anterior."
    )
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
    .setDescription(
      "Remove o acesso de um jogador ao matchmaking."
    )
    .addUserOption(option =>
      option
        .setName("jogador")
        .setDescription(
          "Jogador que perderá o acesso ao matchmaking."
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("solicitacoes")
    .setDescription(
      "Mostra novamente as solicitações de acesso pendentes."
    ),

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
    .setDescription(
      "Limpa completamente a fila do matchmaking."
    ),

  new SlashCommandBuilder()
    .setName("remover-timeout")
    .setDescription(
      "Remove a penalidade de Ready Check de um jogador."
    )
    .addUserOption(option =>
      option
        .setName("jogador")
        .setDescription(
          "Jogador que terá o timeout removido."
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("painel-staff")
    .setDescription(
      "Abre o painel administrativo do matchmaking."
    )
].map(command => command.toJSON());

const rest = new REST({
  version: "10"
}).setToken(config.discord.token);

async function registerCommands() {
  try {
    const registeredCommands = await rest.put(
      Routes.applicationGuildCommands(
        config.discord.clientId,
        config.discord.guildId
      ),
      {
        body: commands
      }
    );

    console.log(
      `${registeredCommands.length} comandos registrados com sucesso.`
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
