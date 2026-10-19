# Reserva, salas de voz e cancelamento

## Jogadores

- `/reserva acao:Entrar na reserva`: voluntário, somente com acesso ativo, sem penalidade e sem fila/partida ativa. A ordem é persistida por entrada e ID. Entrar na fila principal remove a inscrição na reserva. `/reserva acao:Sair da reserva` e `Consultar minha posição` gerenciam a inscrição. `/situacao` também mostra a posição.
- Ao expirar uma confirmação de presença com 10 jogadores, havendo reservas elegíveis suficientes para todas as vagas, troca somente quem não confirmou. Mantém as confirmações existentes, chama as reservas num novo painel e abre o prazo configurado de confirmação. Nenhum reserva é confirmado automaticamente. Revalida acesso, banimento, cooldown e ocupação no momento da chamada. Preserva as penalidades do fluxo original. Sem reservas suficientes, mantém o tratamento de timeout anterior. A troca e seu registro são atômicos.
- `/voz`: depois do draft, disponibiliza as duas salas e tenta mover apenas participantes conectados. Quem está desconectado entra manualmente. Se houver falha de permissões, o veto e a partida continuam e o comando permite tentar novamente.
- `/cancelar codigo:... motivo:...`: participante pede cancelamento de uma partida em andamento/aguardando resultado/em disputa. A partida continua ativa até decisão. Não cancela partidas finalizadas nem reverte pontos já confirmados.

## Staff

`/painel-staff` → Pedidos de cancelamento → selecionar protocolo → Aprovar cancelamento ou Recusar pedido → justificar a decisão. Também pode consultar `/cancelamentos protocolo:...` em privado. Registra solicitante, motivo, decisão, responsável e data. Apenas um pedido pendente por partida; decisões repetidas e aprovação após mudança do resultado são recusadas. A aprovação cancela a partida/sessão sem alterar pontos. Avisos ao painel contêm só protocolo, com detalhes em privado.

## Voz

Usa exclusivamente as salas permanentes fornecidas pelo administrador: Time Azul (`1555960315835842600`) para o time A e Time Laranja (`1555960732234027170`) para o time B. Mantém nomes e permissões das salas. Não cria, renomeia ou apaga canais. O bot precisa de Ver canal, Conectar e Mover membros nas salas de origem/destino; não precisa de Gerenciar canais. Usa GuildVoiceStates, sem novo intent privilegiado. A vinculação ao lobby é persistida; outro lobby não pode usar o mesmo par enquanto a primeira partida estiver ativa. Após encerramento só libera a vinculação. Recuperação após reinício não move ninguém automaticamente.

As tabelas são aditivas (`lobby_reserves`, `match_cancel_requests`, `lobby_voice_channels`). Backups SQLite existentes incluem os novos registros.
