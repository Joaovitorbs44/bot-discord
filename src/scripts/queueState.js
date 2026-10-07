const queue =
  new Map();

const cooldowns =
  new Map();

let queueMessage =
  null;

let queueLocked =
  false;

/*
 * Adiciona um jogador
 * à fila.
 */
function addPlayer(
  player
) {
  if (
    !player ||
    !player.discordId
  ) {
    return false;
  }

  if (
    queue.has(
      player.discordId
    )
  ) {
    return false;
  }

  queue.set(
    player.discordId,
    player
  );

  return true;
}

/*
 * Remove um jogador.
 */
function removePlayer(
  discordId
) {
  return queue.delete(
    discordId
  );
}

/*
 * Remove vários jogadores.
 */
function removePlayers(
  discordIds
) {
  if (
    !Array.isArray(
      discordIds
    )
  ) {
    return 0;
  }

  let removed =
    0;

  for (
    const discordId
    of discordIds
  ) {
    const deleted =
      queue.delete(
        discordId
      );

    if (deleted) {
      removed++;
    }
  }

  return removed;
}

/*
 * Limpa completamente
 * a fila.
 *
 * Retorna quantos jogadores
 * foram removidos.
 */
function clearQueue() {
  const removedPlayers =
    queue.size;

  queue.clear();

  cooldowns.clear();

  return removedPlayers;
}

/*
 * Verifica se determinado
 * jogador está na fila.
 */
function hasPlayer(
  discordId
) {
  return queue.has(
    discordId
  );
}

/*
 * Retorna os jogadores
 * atuais da fila.
 */
function getPlayers() {
  return Array.from(
    queue.values()
  );
}

/*
 * Retorna a quantidade
 * de jogadores.
 */
function getSize() {
  return queue.size;
}

/*
 * Salva a mensagem principal
 * do painel da fila.
 */
function setQueueMessage(
  message
) {
  queueMessage =
    message;
}

/*
 * Retorna a mensagem
 * principal da fila.
 */
function getQueueMessage() {
  return queueMessage;
}

/*
 * Bloqueia a fila.
 */
function lockQueue() {
  queueLocked =
    true;
}

/*
 * Libera a fila.
 */
function unlockQueue() {
  queueLocked =
    false;
}

/*
 * Verifica se a fila
 * está bloqueada.
 */
function isQueueLocked() {
  return queueLocked;
}

/*
 * Define cooldown para
 * determinado jogador.
 */
function setCooldown(
  discordId
) {
  cooldowns.set(
    discordId,
    Date.now()
  );
}

/*
 * Retorna quantos milissegundos
 * ainda faltam para o jogador
 * poder usar a fila novamente.
 */
function getCooldownRemaining(
  discordId,
  cooldownSeconds
) {
  const lastAction =
    cooldowns.get(
      discordId
    );

  if (!lastAction) {
    return 0;
  }

  const cooldownMs =
    cooldownSeconds *
    1000;

  const elapsed =
    Date.now() -
    lastAction;

  const remaining =
    cooldownMs -
    elapsed;

  if (
    remaining <= 0
  ) {
    cooldowns.delete(
      discordId
    );

    return 0;
  }

  return remaining;
}

/*
 * Remove o cooldown
 * de um jogador.
 */
function clearCooldown(
  discordId
) {
  cooldowns.delete(
    discordId
  );
}

/*
 * Limpa todos os cooldowns.
 */
function clearCooldowns() {
  cooldowns.clear();
}

module.exports = {
  addPlayer,
  removePlayer,
  removePlayers,
  clearQueue,

  hasPlayer,
  getPlayers,
  getSize,

  setQueueMessage,
  getQueueMessage,

  lockQueue,
  unlockQueue,
  isQueueLocked,

  setCooldown,
  getCooldownRemaining,
  clearCooldown,
  clearCooldowns
};
