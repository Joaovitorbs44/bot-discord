const queue = new Map();

let queueMessage = null;
let queueLocked = false;

/*
 * Adiciona um jogador à fila.
 */
function addPlayer(player) {
  if (
    !player ||
    !player.discordId
  ) {
    return false;
  }

  if (
    queue.has(player.discordId)
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
function removePlayer(discordId) {
  return queue.delete(
    discordId
  );
}

/*
 * Remove vários jogadores.
 */
function removePlayers(discordIds) {
  if (!Array.isArray(discordIds)) {
    return;
  }

  for (
    const discordId
    of discordIds
  ) {
    queue.delete(
      discordId
    );
  }
}

/*
 * Verifica se o jogador
 * está na fila.
 */
function hasPlayer(discordId) {
  return queue.has(
    discordId
  );
}

/*
 * Retorna uma cópia dos
 * jogadores da fila.
 */
function getPlayers() {
  return Array.from(
    queue.values()
  );
}

/*
 * Quantidade de jogadores.
 */
function getSize() {
  return queue.size;
}

/*
 * Salva a mensagem principal
 * do painel da fila.
 */
function setQueueMessage(message) {
  queueMessage =
    message;
}

/*
 * Retorna a mensagem principal.
 */
function getQueueMessage() {
  return queueMessage;
}

/*
 * Bloqueia a fila.
 *
 * O bloqueio começa quando
 * a fila fica completa e termina
 * somente quando:
 *
 * - Ready Check falha;
 * - formação da partida falha;
 * - partida é criada.
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
 * Verifica se está bloqueada.
 */
function isQueueLocked() {
  return queueLocked;
}

module.exports = {
  addPlayer,
  removePlayer,
  removePlayers,

  hasPlayer,
  getPlayers,
  getSize,

  setQueueMessage,
  getQueueMessage,

  lockQueue,
  unlockQueue,
  isQueueLocked
};
