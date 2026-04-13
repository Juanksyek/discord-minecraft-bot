require('dotenv').config();

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const minecraftUtil = require('minecraft-server-util');

const execFileAsync = promisify(execFile);

const missingEnvVars = ['DISCORD_TOKEN', 'MINECRAFT_HOST', 'AUTHORIZED_ROLE'].filter(
  (name) => !process.env[name],
);

if (missingEnvVars.length > 0) {
  console.error(`Faltan variables de entorno: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const AUTHORIZED_ROLE = process.env.AUTHORIZED_ROLE.trim().toLowerCase();
const MINECRAFT_HOST = process.env.MINECRAFT_HOST;
const MINECRAFT_PORT = parseIntegerEnv('MINECRAFT_PORT', 25565);
const MINECRAFT_TIMEOUT_MS = parseIntegerEnv('MINECRAFT_TIMEOUT_MS', 5000);
const MINECRAFT_SERVICE_NAME = process.env.MINECRAFT_SERVICE_NAME || 'minecraft';
const SYSTEMCTL_BIN = process.env.SYSTEMCTL_BIN || 'systemctl';
const USE_SUDO = normalizeBoolean(process.env.USE_SUDO, false);
const slashCommands = buildSlashCommands();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  console.log(`Bot listo como ${client.user.tag}`);
  console.log(
    `Comandos slash activos para ${MINECRAFT_HOST}:${MINECRAFT_PORT}`,
  );

  try {
    await registerSlashCommands();
    console.log(
      DISCORD_GUILD_ID
        ? `Comandos slash registrados para el servidor ${DISCORD_GUILD_ID}`
        : 'Comandos slash registrados globalmente',
    );
  } catch (error) {
    console.error('No fue posible registrar los comandos slash:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) {
    return;
  }

  try {
    switch (interaction.commandName) {
      case 'help':
        await sendHelp(interaction);
        break;
      case 'status':
        await sendMinecraftStatus(interaction);
        break;
      case 'players':
        await sendMinecraftPlayers(interaction);
        break;
      case 'start':
        await handleServiceCommand(interaction, 'start', 'Servidor iniciado');
        break;
      case 'stop':
        await handleServiceCommand(interaction, 'stop', 'Servidor detenido');
        break;
      case 'restart':
        await handleServiceCommand(interaction, 'restart', 'Servidor reiniciado');
        break;
      default:
        break;
    }
  } catch (error) {
    console.error(`Error procesando el comando "${interaction.commandName}":`, error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Ocurrió un error al procesar el comando.');
      return;
    }

    await interaction.reply({
      content: 'Ocurrió un error al procesar el comando.',
      ephemeral: true,
    });
  }
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(process.env.DISCORD_TOKEN);

function buildSlashCommands() {
  return [
    new SlashCommandBuilder().setName('status').setDescription('Muestra el estado del servidor'),
    new SlashCommandBuilder()
      .setName('players')
      .setDescription('Muestra los jugadores conectados'),
    new SlashCommandBuilder()
      .setName('start')
      .setDescription('Inicia el servicio de Minecraft'),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Detiene el servicio de Minecraft'),
    new SlashCommandBuilder()
      .setName('restart')
      .setDescription('Reinicia el servicio de Minecraft'),
    new SlashCommandBuilder().setName('help').setDescription('Muestra la ayuda del bot'),
  ].map((command) => command.toJSON());
}

async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(client.application.id, DISCORD_GUILD_ID)
    : Routes.applicationCommands(client.application.id);

  await rest.put(route, { body: slashCommands });
}

async function sendHelp(interaction) {
  const lines = [
    'Comandos disponibles:',
    '/status  - Estado del servidor Minecraft',
    '/players - Jugadores conectados',
    '/start   - Iniciar servicio Minecraft (admin)',
    '/stop    - Detener servicio Minecraft (admin)',
    '/restart - Reiniciar servicio Minecraft (admin)',
    '/help    - Mostrar esta ayuda',
  ];

  await interaction.reply({
    content: lines.join('\n'),
    ephemeral: true,
  });
}

async function sendMinecraftStatus(interaction) {
  await interaction.deferReply();

  try {
    const response = await getMinecraftStatus();
    const version = response.version?.name || 'desconocida';
    const onlinePlayers = response.players?.online ?? 0;
    const maxPlayers = response.players?.max ?? 0;

    await interaction.editReply(
      `🟢 Servidor online\nVersión: ${version}\nJugadores: ${onlinePlayers}/${maxPlayers}`,
    );
  } catch (error) {
    console.error('No fue posible consultar el estado del servidor:', error.message);
    await interaction.editReply('🔴 Servidor offline o no responde');
  }
}

async function sendMinecraftPlayers(interaction) {
  await interaction.deferReply();

  try {
    const response = await getMinecraftStatus();
    const onlinePlayers = response.players?.online ?? 0;
    const samplePlayers = response.players?.sample ?? [];

    if (onlinePlayers === 0) {
      await interaction.editReply('No hay jugadores conectados en este momento.');
      return;
    }

    if (!Array.isArray(samplePlayers) || samplePlayers.length === 0) {
      await interaction.editReply(
        `Hay ${onlinePlayers} jugador(es) conectados, pero el servidor no expone la lista por ping.`,
      );
      return;
    }

    const names = samplePlayers.map((player) => player.name).join(', ');
    await interaction.editReply(`Jugadores conectados (${onlinePlayers}): ${names}`);
  } catch (error) {
    console.error('No fue posible consultar los jugadores conectados:', error.message);
    await interaction.editReply('🔴 No se pudo obtener la lista de jugadores');
  }
}

async function handleServiceCommand(interaction, action, successText) {
  if (!(await hasAuthorizedRole(interaction))) {
    await interaction.reply({
      content: '⛔ No autorizado',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    await runServiceAction(action);
    await interaction.editReply(`✅ ${successText}`);
  } catch (error) {
    console.error(`No fue posible ejecutar "${action}" sobre ${MINECRAFT_SERVICE_NAME}:`, error);
    await interaction.editReply(
      `❌ No se pudo ejecutar "${action}" sobre el servicio Minecraft`,
    );
  }
}

async function hasAuthorizedRole(interaction) {
  const memberRoles = interaction.member?.roles;

  if (memberRoles?.cache) {
    return memberRoles.cache.some((role) => role.name.trim().toLowerCase() === AUTHORIZED_ROLE);
  }

  if (Array.isArray(memberRoles)) {
    await interaction.guild.roles.fetch();
    return memberRoles.some(
      (roleId) =>
        interaction.guild.roles.cache.get(roleId)?.name?.trim().toLowerCase() === AUTHORIZED_ROLE,
    );
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.roles.cache.some((role) => role.name.trim().toLowerCase() === AUTHORIZED_ROLE);
}

async function getMinecraftStatus() {
  const options = {
    port: MINECRAFT_PORT,
    timeout: MINECRAFT_TIMEOUT_MS,
  };

  try {
    return await minecraftUtil.status(MINECRAFT_HOST, options);
  } catch (error) {
    if (!looksLikeLegacySignatureIssue(error)) {
      throw error;
    }
  }

  return minecraftUtil.status(MINECRAFT_HOST, MINECRAFT_PORT, {
    timeout: MINECRAFT_TIMEOUT_MS,
  });
}

function looksLikeLegacySignatureIssue(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /port|number|options/i.test(error.message);
}

async function runServiceAction(action) {
  if (process.platform !== 'linux') {
    throw new Error('El control del servicio Minecraft solo está soportado en Linux.');
  }

  const command = USE_SUDO ? 'sudo' : SYSTEMCTL_BIN;
  const args = USE_SUDO
    ? ['-n', SYSTEMCTL_BIN, action, MINECRAFT_SERVICE_NAME]
    : [action, MINECRAFT_SERVICE_NAME];

  await execFileAsync(command, args, { timeout: 15000 });
}

function parseIntegerEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue)) {
    console.error(`La variable ${name} debe ser un número entero.`);
    process.exit(1);
  }

  return parsedValue;
}

function normalizeBoolean(value, defaultValue) {
  if (value == null || value.trim() === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function shutdown() {
  console.log('Apagando bot de Discord...');
  client.destroy();
  process.exit(0);
}
