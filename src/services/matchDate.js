const formatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function matchDate(value) {
  if (!value) return 'Data não registrada';
  // SQLite CURRENT_TIMESTAMP is UTC but has no suffix.
  let iso = String(value).trim().replace(' ', 'T');
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso)) iso += 'Z';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Data não registrada';
  return formatter.format(date).replace(', ', ' às ') + ' (Brasília)';
}
module.exports = { matchDate };
