# Placares e K/D

## Envio pelo capitão

No canal resultados (1555941357061804145):

- `/placar codigo:<código do bot> imagem:<print>` envia a imagem de forma privada.
- Se o print já estiver numa mensagem pública, use `/placar codigo:<código> mensagem:<ID da mensagem>` no mesmo canal. A mensagem precisa ter exatamente uma imagem. Ela será apagada somente depois da aprovação e do arquivamento persistente.
- Uma partida aceita apenas um placar pendente ou aprovado. Um placar rejeitado pode ser reenviado.
- Os capitães da partida e a staff podem enviar. O print precisa ser vinculado ao código correto; o OCR não determina sozinho qual partida representa.

## Revisão pela staff

No painel-staff (1557714957007593472):

- `/partidas` lista os últimos 10 envios.
- `/partidas codigo:<código>` abre uma consulta efêmera com imagem, jogadores e estatísticas sugeridas.
- Corrija kills e mortes no seletor de jogadores. Dados ilegíveis ficam pendentes.
- Compare os 10 jogadores com o print e clique em Aprovar.
- O resultado oficial precisa estar confirmado antes da aprovação do K/D.
- Ao aprovar, a imagem desaparece da mensagem de revisão e o envio público vinculado é apagado. O arquivo continua no volume persistente, acessível somente por consulta da staff. Se a exclusão falhar por falta de permissão, o bot informa; reabrir `/partidas` tenta novamente.
- O bot precisa de Ver canal, Ler histórico e Gerenciar mensagens em resultados para apagar mensagens dos capitães.

## Estatísticas

Ranking e perfil mostram kills, mortes, K/D e quantidade de placares aprovados na temporada. O K/D usa total de kills dividido pelo total de mortes, não a média dos K/Ds. Sem placares aprovados: —. Com kills e zero mortes: ∞. K/D não muda pontos, vitórias ou derrotas.

A leitura usa Tesseract local e dados de idioma instalados junto com o bot; não exige chave de API. O recorte foi calibrado para os três exemplos fornecidos. Outros recortes, resoluções ou nicks pouco legíveis podem exigir preenchimento manual. Mesmo quando a leitura preenche todos os campos, a aprovação da staff é obrigatória.

As tabelas novas não alteram resultados existentes. Prints históricos não são importados automaticamente. Arquivos PNG são guardados em `scoreboards/`, junto do SQLite no volume persistente, sem endereço público. O backup SQLite atual protege o banco; uma cópia completa do histórico de evidências também precisa incluir essa pasta.
