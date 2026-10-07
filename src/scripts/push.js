const {
  Client,
  GatewayIntentBits
} = require("discord.js");

const config =
  require("../config/config");

const queueState =
  require("./queueState");

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

      if (
        !channel.isTextBased() ||
        !channel.messages
      ) {
        throw new Error(
          "QUEUE_CHANNEL_ID não pertence a um canal de texto."
        );
      }

      /*
       * O push representa uma
       * criação/reinicialização
       * manual do painel.
       */
      queueState.clearQueue();
      queueState.unlockQueue();

      const messages =
        await channel.messages.fetch({
          limit: 100
        });

      const existingPanel =
        messages.find(
          (message) =>
            message.author &&
            message.author.id ===
              client.user.id &&
            hasQueueButtons(
              message
            )
        );

      if (existingPanel) {
        queueState.setQueueMessage(
          existingPanel
        );

        await existingPanel.edit(
          createQueuePanel()
        );

        console.log(
          "Painel de matchmaking existente atualizado."
        );

        return;
      }

      const message =
        await channel.send(
          createQueuePanel()
        );

      queueState.setQueueMessage(
        message
      );

      console.log(
        "Painel de matchmaking criado em #puxar-partida."
      );
    } catch (error) {
      console.error(
        "Erro ao criar/atualizar painel de matchmaking:",
        error
      );
    } finally {
      client.destroy();
    }
  }
);

/*
 * Identifica o painel da fila
 * pelos Custom IDs.
 */
function hasQueueButtons(
  message
) {
  if (
    !message ||
    !Array.isArray(
      message.components
    )
  ) {
    return false;
  }

  let hasJoin = false;
  let hasLeave = false;

  for (
    const row
    of message.components
  ) {
    if (
      !row ||
      !Array.isArray(
        row.components
      )
    ) {
      continue;
    }

    for (
      const component
      of row.components
    ) {
      if (
        component.customId ===
        "queue_join"
      ) {
        hasJoin = true;
      }

      if (
        component.customId ===
        "queue_leave"
      ) {
        hasLeave = true;
      }
    }
  }

  return (
    hasJoin &&
    hasLeave
  );
}

client.login(
  config.discord.token
);
