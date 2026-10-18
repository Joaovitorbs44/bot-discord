// Delete only the bot's known stage messages, after the next panel exists.
async function removeMessage(client, message) {
  if (!message || !client?.user?.id || message.author?.id !== client.user.id) return false;
  try {
    await message.delete();
    return true;
  } catch (error) {
    if (error.code === 10008) return true;
    console.warn("[PANELS] Não foi possível excluir painel concluído:", message.id, error.message);
    return false;
  }
}

async function cleanup(client, state, keys) {
  for (const key of keys) {
    const saved = state?.[key];
    if (!saved?.channelId || !saved?.messageId) continue;
    try {
      const channel = await client.channels.fetch(saved.channelId);
      const message = await channel.messages.fetch(saved.messageId);
      await removeMessage(client, message);
    } catch (error) {
      if (error.code !== 10008) console.warn("[PANELS] Falha na limpeza:", key, error.message);
    }
  }
}

module.exports = { removeMessage, cleanup };
