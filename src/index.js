require('dotenv').config();

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  Client,
  Colors,
  EmbedBuilder,
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
const PUBLIC_SERVER_ADDRESS = process.env.PUBLIC_SERVER_ADDRESS || 'submit-beef.gl.joinmc.link';
const PUBLIC_SERVER_PORT = parseIntegerEnv('PUBLIC_SERVER_PORT', 25565);
const MINECRAFT_SERVICE_NAME = process.env.MINECRAFT_SERVICE_NAME || 'minecraft';
const SYSTEMCTL_BIN = process.env.SYSTEMCTL_BIN || 'systemctl';
const USE_SUDO = normalizeBoolean(process.env.USE_SUDO, false);
const slashCommands = buildSlashCommands();
const BOT_STARTED_AT = Date.now();
const COMMAND_LABELS = {
  start: 'Iniciar',
  stop: 'Detener',
  restart: 'Reiniciar',
};

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
      case 'conectarme':
        await sendConnectionInfo(interaction);
        break;
      case 'players':
        await sendMinecraftPlayers(interaction);
        break;
      case 'info':
        await sendServerInfo(interaction);
        break;
      case 'ping':
        await sendBotPing(interaction);
        break;
      case 'servicio':
        await sendServiceStatus(interaction);
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
    const errorReply = {
      embeds: [
        createEmbed(interaction, {
          color: Colors.Red,
          title: 'Error al procesar el comando',
          description: 'Ocurrió un problema inesperado mientras el bot atendía tu solicitud.',
          fields: [{ name: 'Comando', value: `/${interaction.commandName}`, inline: true }],
        }),
      ],
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorReply);
      return;
    }

    await interaction.reply({
      ...errorReply,
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
      .setName('conectarme')
      .setDescription('Muestra la direccion publica para entrar al servidor'),
    new SlashCommandBuilder()
      .setName('players')
      .setDescription('Muestra los jugadores conectados'),
    new SlashCommandBuilder()
      .setName('info')
      .setDescription('Muestra un resumen del servidor y su acceso publico'),
    new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Muestra la latencia del bot y su tiempo activo'),
    new SlashCommandBuilder()
      .setName('servicio')
      .setDescription('Muestra el estado del servicio systemd de Minecraft'),
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
  await interaction.reply({
    embeds: [
      createEmbed(interaction, {
        color: Colors.Blurple,
        title: 'Panel del bot de Minecraft',
        description: 'Comandos disponibles para consultar y administrar el servidor desde Discord.',
        fields: [
          {
            name: 'Consultas',
            value: [
              '`/status` Ver estado del servidor',
              '`/conectarme` Obtener la direccion publica',
              '`/players` Ver jugadores conectados',
              '`/info` Resumen general del servidor',
              '`/ping` Latencia y uptime del bot',
              '`/help` Mostrar esta ayuda',
            ].join('\n'),
          },
          {
            name: 'Administración',
            value: [
              '`/servicio` Ver estado del servicio',
              '`/start` Iniciar servicio',
              '`/stop` Detener servicio',
              '`/restart` Reiniciar servicio',
            ].join('\n'),
          },
          {
            name: 'Permiso requerido',
            value: `Rol autorizado: \`${process.env.AUTHORIZED_ROLE}\``,
          },
          {
            name: 'Servidor objetivo',
            value: `\`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``,
          },
          {
            name: 'Acceso publico',
            value: `\`${formatPublicServerAddress()}\``,
          },
        ],
      }),
    ],
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
    const motd = formatMotd(response);

    await interaction.editReply({
      embeds: [
        createEmbed(interaction, {
          color: Colors.Green,
          title: 'Servidor online',
          description: motd || 'El servidor responde correctamente.',
          fields: [
            { name: 'Estado', value: '🟢 En línea', inline: true },
            { name: 'Jugadores', value: `${onlinePlayers}/${maxPlayers}`, inline: true },
            { name: 'Versión', value: version, inline: true },
            { name: 'Endpoint', value: `\`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``, inline: false },
          ],
        }),
      ],
    });
  } catch (error) {
    console.error('No fue posible consultar el estado del servidor:', error.message);
    await interaction.editReply({
      embeds: [
        createEmbed(interaction, {
          color: Colors.Red,
          title: 'Servidor offline',
          description: 'No se pudo establecer conexión con el servidor Minecraft.',
          fields: [
            { name: 'Estado', value: '🔴 Sin respuesta', inline: true },
            { name: 'Endpoint', value: `\`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``, inline: true },
          ],
        }),
      ],
    });
  }
}

async function sendConnectionInfo(interaction) {
  await interaction.deferReply();

  let statusText = 'No disponible';
  let playersText = 'No disponible';
  let color = Colors.Blurple;

  try {
    const response = await getMinecraftStatus();
    statusText = '🟢 Online';
    playersText = `${response.players?.online ?? 0}/${response.players?.max ?? 0}`;
    color = Colors.Green;
  } catch (error) {
    statusText = '🔴 Offline o sin respuesta';
    color = Colors.Orange;
  }

  await interaction.editReply({
    embeds: [
      createEmbed(interaction, {
        color,
        title: 'Conectate al servidor',
        description:
          'Abre Minecraft Java, entra a **Multijugador** y pega esta direccion para unirte.',
        fields: [
          { name: 'Direccion publica', value: `\`${formatPublicServerAddress()}\``, inline: false },
          { name: 'Estado actual', value: statusText, inline: true },
          { name: 'Jugadores', value: playersText, inline: true },
          { name: 'Tipo', value: 'Minecraft Java Edition', inline: true },
          {
            name: 'Paso rapido',
            value: 'Multijugador -> Agregar servidor -> Pegar direccion -> Unirse',
            inline: false,
          },
        ],
      }),
    ],
  });
}

async function sendMinecraftPlayers(interaction) {
  await interaction.deferReply();

  try {
    const response = await getMinecraftStatus();
    const onlinePlayers = response.players?.online ?? 0;
    const samplePlayers = response.players?.sample ?? [];

    if (onlinePlayers === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed(interaction, {
            color: Colors.Yellow,
            title: 'Sin jugadores conectados',
            description: 'El servidor está online, pero no hay jugadores dentro en este momento.',
            fields: [
              { name: 'Jugadores', value: '0', inline: true },
              { name: 'Endpoint', value: `\`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``, inline: true },
            ],
          }),
        ],
      });
      return;
    }

    if (!Array.isArray(samplePlayers) || samplePlayers.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed(interaction, {
            color: Colors.Orange,
            title: 'Jugadores conectados',
            description: 'Hay actividad en el servidor, pero Paper no expone la lista completa por ping.',
            fields: [
              { name: 'Jugadores detectados', value: `${onlinePlayers}`, inline: true },
              { name: 'Endpoint', value: `\`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``, inline: true },
            ],
          }),
        ],
      });
      return;
    }

    const names = formatPlayerList(samplePlayers);
    await interaction.editReply({
      embeds: [
        createEmbed(interaction, {
          color: Colors.Aqua,
          title: 'Jugadores conectados',
          description: names,
          fields: [
            { name: 'Total', value: `${onlinePlayers}`, inline: true },
            { name: 'Endpoint', value: `\`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``, inline: true },
          ],
        }),
      ],
    });
  } catch (error) {
    console.error('No fue posible consultar los jugadores conectados:', error.message);
    await interaction.editReply({
      embeds: [
        createEmbed(interaction, {
          color: Colors.Red,
          title: 'No se pudo obtener la lista',
          description: 'Falló la consulta de jugadores del servidor Minecraft.',
          fields: [{ name: 'Endpoint', value: `\`${MINECRAFT_HOST}:${MINECRAFT_PORT}\`` }],
        }),
      ],
    });
  }
}

async function sendServerInfo(interaction) {
  await interaction.deferReply();

  let statusLabel = '🔴 Offline';
  let version = 'No disponible';
  let players = 'No disponible';
  let motd = 'No disponible';
  let color = Colors.Blurple;

  try {
    const response = await getMinecraftStatus();
    statusLabel = '🟢 Online';
    version = response.version?.name || 'Desconocida';
    players = `${response.players?.online ?? 0}/${response.players?.max ?? 0}`;
    motd = formatMotd(response) || 'Sin MOTD visible';
    color = Colors.Green;
  } catch (error) {
    color = Colors.Orange;
  }

  await interaction.editReply({
    embeds: [
      createEmbed(interaction, {
        color,
        title: 'Informacion del servidor',
        description: 'Resumen rapido del bot, el acceso publico y la instancia de Minecraft.',
        fields: [
          { name: 'Acceso publico', value: `\`${formatPublicServerAddress()}\``, inline: false },
          { name: 'Endpoint local', value: `\`${MINECRAFT_HOST}:${MINECRAFT_PORT}\``, inline: false },
          { name: 'Estado', value: statusLabel, inline: true },
          { name: 'Jugadores', value: players, inline: true },
          { name: 'Version', value: version, inline: true },
          { name: 'Servicio', value: `\`${MINECRAFT_SERVICE_NAME}\``, inline: true },
          { name: 'Rol admin', value: `\`${process.env.AUTHORIZED_ROLE}\``, inline: true },
          { name: 'MOTD', value: motd, inline: false },
        ],
      }),
    ],
  });
}

async function sendBotPing(interaction) {
  const responseLatency = Date.now() - interaction.createdTimestamp;
  const apiLatency = Math.max(client.ws.ping, 0);
  const uptime = formatDuration(Date.now() - BOT_STARTED_AT);

  await interaction.reply({
    embeds: [
      createEmbed(interaction, {
        color: Colors.Blurple,
        title: 'Estado del bot',
        description: 'Metricas rapidas para validar que el bot responde correctamente.',
        fields: [
          { name: 'Latencia del comando', value: `${responseLatency} ms`, inline: true },
          { name: 'Latencia API Discord', value: `${apiLatency} ms`, inline: true },
          { name: 'Uptime del bot', value: uptime, inline: true },
        ],
      }),
    ],
    ephemeral: true,
  });
}

async function sendServiceStatus(interaction) {
  if (!(await hasAuthorizedRole(interaction))) {
    await replyUnauthorized(interaction, 'servicio');
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const serviceDetails = await getServiceDetails();
    await interaction.editReply({
      embeds: [
        createEmbed(interaction, {
          color: getServiceStatusColor(serviceDetails.ActiveState),
          title: 'Estado del servicio Minecraft',
          description: `Diagnostico de \`${MINECRAFT_SERVICE_NAME}\` via systemd.`,
          fields: [
            {
              name: 'Estado',
              value: formatServiceState(serviceDetails.ActiveState, serviceDetails.SubState),
              inline: true,
            },
            {
              name: 'Habilitado',
              value: serviceDetails.UnitFileState || 'No disponible',
              inline: true,
            },
            {
              name: 'PID',
              value: serviceDetails.MainPID && serviceDetails.MainPID !== '0'
                ? serviceDetails.MainPID
                : 'No ejecutandose',
              inline: true,
            },
            {
              name: 'Inicio principal',
              value: serviceDetails.ExecMainStartTimestamp || 'No disponible',
              inline: false,
            },
          ],
        }),
      ],
    });
  } catch (error) {
    await interaction.editReply({
      embeds: [
        createEmbed(interaction, {
          color: Colors.Red,
          title: 'No se pudo consultar el servicio',
          description: `Falló la consulta del servicio \`${MINECRAFT_SERVICE_NAME}\`.`,
          fields: [{ name: 'Motivo', value: formatError(error), inline: false }],
        }),
      ],
    });
  }
}

async function handleServiceCommand(interaction, action, successText) {
  if (!(await hasAuthorizedRole(interaction))) {
    await replyUnauthorized(interaction, action);
    return;
  }

  await interaction.deferReply();

  try {
    await runServiceAction(action);
    await interaction.editReply({
      embeds: [
        createEmbed(interaction, {
          color: Colors.Green,
          title: 'Acción completada',
          description: successText,
          fields: [
            { name: 'Acción', value: COMMAND_LABELS[action] || action, inline: true },
            { name: 'Servicio', value: `\`${MINECRAFT_SERVICE_NAME}\``, inline: true },
            { name: 'Ejecutado por', value: interaction.user.tag, inline: true },
          ],
        }),
      ],
    });
  } catch (error) {
    console.error(`No fue posible ejecutar "${action}" sobre ${MINECRAFT_SERVICE_NAME}:`, error);
    await interaction.editReply({
      embeds: [
        createEmbed(interaction, {
          color: Colors.Red,
          title: 'Acción fallida',
          description: `No se pudo ejecutar "${action}" sobre el servicio Minecraft.`,
          fields: [
            { name: 'Acción', value: COMMAND_LABELS[action] || action, inline: true },
            { name: 'Servicio', value: `\`${MINECRAFT_SERVICE_NAME}\``, inline: true },
            { name: 'Motivo', value: formatError(error), inline: false },
          ],
        }),
      ],
    });
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

async function getServiceDetails() {
  if (process.platform !== 'linux') {
    throw new Error('La consulta del servicio solo esta soportada en Linux.');
  }

  const { stdout } = await runSystemctl(
    [
      'show',
      MINECRAFT_SERVICE_NAME,
      '--no-page',
      '--property=ActiveState',
      '--property=SubState',
      '--property=UnitFileState',
      '--property=MainPID',
      '--property=ExecMainStartTimestamp',
    ],
    15000,
  );

  return parseSystemctlProperties(stdout);
}

function createEmbed(interaction, { color, title, description, fields = [] }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: `Solicitado por ${interaction.user.tag}`,
      iconURL: interaction.user.displayAvatarURL(),
    })
    .setTimestamp();

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  return embed;
}

async function replyUnauthorized(interaction, commandName) {
  await interaction.reply({
    embeds: [
      createEmbed(interaction, {
        color: Colors.Red,
        title: 'Acceso denegado',
        description: 'No tienes permiso para ejecutar acciones administrativas sobre el servidor.',
        fields: [
          { name: 'Comando', value: `/${commandName}`, inline: true },
          { name: 'Rol requerido', value: `\`${process.env.AUTHORIZED_ROLE}\``, inline: true },
        ],
      }),
    ],
    ephemeral: true,
  });
}

function formatMotd(response) {
  const cleanMotd = response.motd?.clean;

  if (Array.isArray(cleanMotd)) {
    const value = cleanMotd.join(' ').trim();
    return value || null;
  }

  if (typeof cleanMotd === 'string') {
    return cleanMotd.trim() || null;
  }

  return null;
}

function formatPublicServerAddress() {
  return PUBLIC_SERVER_PORT === 25565
    ? PUBLIC_SERVER_ADDRESS
    : `${PUBLIC_SERVER_ADDRESS}:${PUBLIC_SERVER_PORT}`;
}

function formatPlayerList(players) {
  const visiblePlayers = players.slice(0, 20);
  const remainingPlayers = players.length - visiblePlayers.length;
  const lines = visiblePlayers.map((player) => `• \`${player.name}\``);

  if (remainingPlayers > 0) {
    lines.push(`• y ${remainingPlayers} mas...`);
  }

  return lines.join('\n');
}

function formatDuration(durationMs) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || hours > 0 || days > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function parseSystemctlProperties(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .reduce((result, line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        return result;
      }

      const key = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1).trim();
      result[key] = value;
      return result;
    }, {});
}

function getServiceStatusColor(activeState) {
  switch ((activeState || '').toLowerCase()) {
    case 'active':
      return Colors.Green;
    case 'activating':
      return Colors.Blue;
    case 'inactive':
      return Colors.Orange;
    case 'failed':
      return Colors.Red;
    default:
      return Colors.Grey;
  }
}

function formatServiceState(activeState, subState) {
  const normalizedActiveState = activeState || 'unknown';
  const normalizedSubState = subState || 'unknown';
  return `${normalizedActiveState} (${normalizedSubState})`;
}

function formatError(error) {
  if (!(error instanceof Error)) {
    return 'Sin detalles adicionales';
  }

  return error.message || 'Sin detalles adicionales';
}

async function runServiceAction(action) {
  if (process.platform !== 'linux') {
    throw new Error('El control del servicio Minecraft solo está soportado en Linux.');
  }

  await runSystemctl([action, MINECRAFT_SERVICE_NAME], 15000);
}

async function runSystemctl(systemctlArgs, timeoutMs) {
  const command = USE_SUDO ? 'sudo' : SYSTEMCTL_BIN;
  const args = USE_SUDO ? ['-n', SYSTEMCTL_BIN, ...systemctlArgs] : systemctlArgs;
  return execFileAsync(command, args, { timeout: timeoutMs });
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
