const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require("discord.js");

const config = require(
  "../config/config"
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

client.once(
  Events.ClientReady,
  async () => {
    try {
      const channel =
        await client.channels.fetch(
          config.discord.accessChannelId
        );

      if (!channel) {
        throw new Error(
          "Canal de solicitação não encontrado."
        );
      }

      if (!channel.isTextBased()) {
        throw new Error(
          "O canal configurado não é um canal de texto."
        );
      }

      const embed =
        new EmbedBuilder()
          .setTitle(
            "Matchmaking R6"
          )
          .setDescription(
            "Solicite acesso para participar do matchmaking competitivo.\n\n" +
            "Após enviar sua solicitação, a **Staff** irá analisar seus dados.\n\n" +
            "Se aprovado, você receberá acesso ao sistema de matchmaking."
          )
          .addFields({
            name: "Como funciona?",
            value:
              "1. Clique em **Solicitar acesso**.\n" +
              "2. Preencha seus dados.\n" +
              "3. Aguarde a análise da Staff.\n" +
              "4. Se aprovado, seu perfil será criado."
          })
          .setFooter({
            text:
              "Rainbow Six Siege • Matchmaking"
          });

      const buttons =
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(
                "access_request"
              )
              .setLabel(
                "Solicitar acesso"
              )
              .setStyle(
                ButtonStyle.Primary
              )
          );

      await channel.send({
        embeds: [
          embed
        ],
        components: [
          buttons
        ]
      });

      console.log(
        "Painel de acesso criado."
      );
    } catch (error) {
      console.error(
        "Erro ao criar painel de acesso:",
        error
      );
    } finally {
      client.destroy();
    }
  }
);

client.login(
  config.discord.token
);