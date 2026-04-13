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
const MINECRAFT_SERVICE_NAME = process.env.MINECRAFT_SERVICE_NAME || 'minecraft';
const SYSTEMCTL_BIN = process.env.SYSTEMCTL_BIN || 'systemctl';
const USE_SUDO = normalizeBoolean(process.env.USE_SUDO, false);
const slashCommands = buildSlashCommands();
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
              '`/players` Ver jugadores conectados',
              '`/help` Mostrar esta ayuda',
            ].join('\n'),
          },
          {
            name: 'Administración',
            value: [
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

    const names = samplePlayers.map((player) => `• \`${player.name}\``).join('\n');
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

async function handleServiceCommand(interaction, action, successText) {
  if (!(await hasAuthorizedRole(interaction))) {
    await interaction.reply({
      embeds: [
        createEmbed(interaction, {
          color: Colors.Red,
          title: 'Acceso denegado',
          description: 'No tienes permiso para ejecutar acciones administrativas sobre el servidor.',
          fields: [
            { name: 'Comando', value: `/${action}`, inline: true },
            { name: 'Rol requerido', value: `\`${process.env.AUTHORIZED_ROLE}\``, inline: true },
          ],
        }),
      ],
      ephemeral: true,
    });
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

function createEmbed(interaction, { color, title, description, fields = [] }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setFooter({
      text: `Solicitado por ${interaction.user.tag}`,
      iconURL: interaction.user.displayAvatarURL(),
    })
    .setTimestamp();
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
