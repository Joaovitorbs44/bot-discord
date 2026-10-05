const {
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const config = require(
  "../config/config"
);

const commands = [
  new SlashCommandBuilder()
    .setName("perfil")
    .setDescription(
      "Mostra o perfil de um jogador."
    )
    .addUserOption(
      (option) =>
        option
          .setName("jogador")
          .setDescription(
            "Jogador que deseja consultar."
          )
          .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("ranking")
    .setDescription(
      "Mostra o ranking da temporada atual."
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("historico")
    .setDescription(
      "Mostra as últimas partidas de um jogador."
    )
    .addUserOption(
      (option) =>
        option
          .setName("jogador")
          .setDescription(
            "Jogador que deseja consultar."
          )
          .setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("partida")
    .setDescription(
      "Consulta uma partida pelo código."
    )
    .addStringOption(
      (option) =>
        option
          .setName("codigo")
          .setDescription(
            "Código da partida. Ex: 583241"
          )
          .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("temporada")
    .setDescription(
      "Consulta a temporada atual ou uma temporada anterior."
    )
    .addIntegerOption(
      (option) =>
        option
          .setName("numero")
          .setDescription(
            "Número da temporada."
          )
          .setRequired(false)
          .setMinValue(1)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("temporadas")
    .setDescription(
      "Mostra o histórico de temporadas."
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("remover-acesso")
    .setDescription(
      "Remove o acesso de um jogador ao matchmaking."
    )
    .addUserOption(
      (option) =>
        option
          .setName("jogador")
          .setDescription(
            "Jogador que perderá o acesso ao matchmaking."
          )
          .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("solicitacoes")
    .setDescription(
      "Mostra novamente as solicitações de acesso pendentes."
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("limpar-fila")
    .setDescription(
      "Limpa a fila atual do matchmaking."
    )
    .toJSON()
];

const rest =
  new REST({
    version: "10"
  }).setToken(
    config.discord.token
  );

async function registerCommands() {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        config.discord.clientId,
        config.discord.guildId
      ),
      {
        body: commands
      }
    );

    console.log(
      "Comandos registrados."
    );
  } catch (error) {
    console.error(
      "Erro ao registrar comandos:",
      error
    );
  }
}

registerCommands();
