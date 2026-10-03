const {
  Client,
  GatewayIntentBits
} = require("discord.js");

const config =
  require("../config/config");

const {
  createQueuePanel
} = require("./queue");

const client =
  new Client({
    intents: [
      GatewayIntentBits.Guilds
    ]
  });

client.once(
  "clientReady",
  async () => {
    try {
      const channel =
        await client.channels.fetch(
          config.discord.queueChannelId
        );

      if (!channel) {
        throw new Error(
          "O canal #puxar-partida não foi encontrado."
        );
      }

      if (!channel.isTextBased()) {
        throw new Error(
          "QUEUE_CHANNEL_ID não pertence a um canal de texto."
        );
      }

      await channel.send(
        createQueuePanel()
      );

      console.log(
        "Painel de matchmaking criado em #puxar-partida."
      );
    } catch (error) {
      console.error(
        "Erro ao criar painel de matchmaking:",
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