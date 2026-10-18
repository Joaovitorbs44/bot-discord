const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let running = false;
const command = new SlashCommandBuilder()
  .setName("homologacao")
  .setDescription("Executa testes simulados isolados, sem alterar a fila ou o ranking.")
  .setDMPermission(false);

function authorized(interaction, config) {
  return interaction.inGuild() &&
    interaction.guildId === config.discord.guildId &&
    (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.member?.roles?.cache?.has(config.discord.staffRoleId));
}

async function runSuite() {
  const root = path.resolve(__dirname, "../..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "invi-homologation-"));
  try {
    const tests = fs.readdirSync(path.join(root, "test"))
      .filter(name => name.endsWith(".test.js")).sort()
      .map(name => path.join(root, "test", name));
    if (!tests.length) throw new Error("Nenhum teste disponível.");
    // Deliberately exclude the production token, database and Railway variables.
    const env = {
      PATH: process.env.PATH || "", NODE_ENV: "test",
      TMPDIR: temporary, TMP: temporary, TEMP: temporary,
      DATABASE_PATH: path.join(temporary, "homologation.sqlite")
    };
    return await new Promise(resolve => {
      execFile(process.execPath, ["--test", "--test-reporter=tap", ...tests], {
        cwd: root, env, timeout: 90000, maxBuffer: 2 * 1024 * 1024
      }, (error, stdout) => {
        const count = key => Number(stdout.match(new RegExp(`^# ${key} (\\d+)$`, "m"))?.[1] || 0);
        resolve({ ok: !error && count("tests") > 0 && count("fail") === 0,
          tests: count("tests"), pass: count("pass"), fail: count("fail"),
          skipped: count("skipped"), timedOut: Boolean(error?.killed) });
      });
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function execute(interaction) {
  const config = require("../config/config");
  if (!authorized(interaction, config)) {
    return interaction.reply({ content: "Comando exclusivo da staff no servidor autorizado.", flags: MessageFlags.Ephemeral });
  }
  if (running) return interaction.reply({ content: "Já existe uma homologação em andamento.", flags: MessageFlags.Ephemeral });
  running = true;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await runSuite();
    await interaction.editReply({ content: [
      `**Homologação automatizada: ${result.ok ? "APROVADA" : "REPROVADA"}**`,
      `Testes: ${result.tests} | Aprovados: ${result.pass} | Falhas: ${result.fail} | Ignorados: ${result.skipped}`,
      result.timedOut ? "Tempo limite excedido." : "",
      "Simulações com banco isolado e sem conexão adicional ao Discord.",
      "Fila, pontos e ranking reais preservados. Dados temporários removidos.",
      "Este resultado não substitui o teste manual dos botões e permissões reais do Discord."
    ].filter(Boolean).join("\n") });
  } catch (error) {
    console.error("[homologacao]", error.message);
    if (interaction.deferred) await interaction.editReply({ content: "Não foi possível concluir a homologação automatizada. Confira os logs do bot." });
    else throw error;
  } finally { running = false; }
}

module.exports = { command, execute, authorized, runSuite };
