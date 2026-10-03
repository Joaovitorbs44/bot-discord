const config = require("../config/config");
const db = require("../database/database");

async function handleReject(interaction) {
  // ==========================================
  // VERIFICAR STAFF
  // ==========================================

  if (
    !interaction.member.roles.cache.has(
      config.discord.staffRoleId
    )
  ) {
    return interaction.reply({
      content:
        "Você não possui permissão para rejeitar solicitações.",
      ephemeral: true
    });
  }

  // ==========================================
  // IDENTIFICAR SOLICITAÇÃO
  // ==========================================

  const requestId =
    interaction.customId.split(":")[1];

  if (!requestId) {
    return interaction.reply({
      content:
        "Não foi possível identificar essa solicitação.",
      ephemeral: true
    });
  }

  // ==========================================
  // BUSCAR SOLICITAÇÃO
  // ==========================================

  const request = db
    .prepare(`
      SELECT *
      FROM access_requests
      WHERE id = ?
    `)
    .get(requestId);

  if (!request) {
    return interaction.reply({
      content:
        "Essa solicitação não existe.",
      ephemeral: true
    });
  }

  // ==========================================
  // VERIFICAR STATUS
  // ==========================================

  if (request.status !== "pending") {
    return interaction.reply({
      content:
        "Essa solicitação já foi analisada.",
      ephemeral: true
    });
  }

  // ==========================================
  // ATUALIZAR BANCO
  // ==========================================

  const result = db
    .prepare(`
      UPDATE access_requests
      SET
        status = 'rejected',
        reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'pending'
    `)
    .run(
      interaction.user.id,
      requestId
    );

  if (result.changes === 0) {
    return interaction.reply({
      content:
        "Não foi possível rejeitar essa solicitação. Ela pode já ter sido analisada.",
      ephemeral: true
    });
  }

  // ==========================================
  // ATUALIZAR MENSAGEM DA STAFF
  // ==========================================

  await interaction.update({
    content:
      `❌ Solicitação rejeitada por ${interaction.user}.\n` +
      `Usuário: <@${request.discord_id}>`,
    embeds: [],
    components: []
  });
}

module.exports = handleReject;