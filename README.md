# Discord Bot + Minecraft Server (Raspberry Pi)

Repositorio base para administrar un servidor Paper desde Discord en una Raspberry Pi. El bot consulta el estado del servidor, muestra jugadores conectados y puede iniciar, detener o reiniciar el servicio de Minecraft usando `systemd`.

## Funcionalidades

- Consultar si el servidor está online.
- Compartir la dirección pública para entrar al servidor.
- Ver jugadores conectados.
- Mostrar resumen del servidor y del bot.
- Consultar el estado del servicio `systemd`.
- Bajar cambios del bot desde `main` y reiniciarlo desde Discord.
- Reiniciar, iniciar y detener el servicio `minecraft`.
- Restringir acciones administrativas por rol de Discord.
- Preparar despliegue con `systemd`, `Playit` y backups automáticos.

## Estructura

```text
.
├── deploy/
│   ├── backup.sh
│   ├── sudoers/
│   │   └── discord-bot-minecraft
│   └── systemd/
│       └── discord-bot.service
├── src/
│   └── index.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Requisitos

- Node.js 18.17 o superior
- Un bot de Discord invitado con los scopes `bot` y `applications.commands`
- Un servidor Paper corriendo como servicio `systemd`
- Raspberry Pi OS 64-bit para el despliegue final
- Playit para exponer el puerto de Minecraft a internet

## Variables de entorno

Copia `.env.example` a `.env` y ajusta los valores:

```env
DISCORD_TOKEN=tu_token
DISCORD_GUILD_ID=123456789012345678
AUTHORIZED_ROLE=Admin
MINECRAFT_HOST=127.0.0.1
MINECRAFT_PORT=25565
MINECRAFT_TIMEOUT_MS=5000
PUBLIC_SERVER_ADDRESS=submit-beef.gl.joinmc.link
PUBLIC_SERVER_PORT=25565
MINECRAFT_SERVICE_NAME=minecraft
BOT_SERVICE_NAME=discord-bot
BOT_REPO_DIR=/home/pi/discord-minecraft-bot
GIT_REMOTE_NAME=origin
GIT_BRANCH_NAME=main
USE_SUDO=true
SYSTEMCTL_BIN=systemctl
```

### Notas

- `DISCORD_GUILD_ID` es opcional, pero recomendado en desarrollo para registrar comandos slash al instante en un solo servidor.
- `AUTHORIZED_ROLE` debe coincidir con el nombre del rol de Discord.
- `MINECRAFT_HOST` normalmente será `127.0.0.1` si el bot corre en la misma Raspberry Pi.
- `PUBLIC_SERVER_ADDRESS` es la dirección pública que compartirás con `/conectarme`.
- `PUBLIC_SERVER_PORT` puede omitirse visualmente si usas `25565`, pero queda configurable por si el túnel usa otro puerto.
- `BOT_SERVICE_NAME` es el nombre del servicio `systemd` del bot, usado por `/actualizar`.
- `BOT_REPO_DIR` debe apuntar a la carpeta del repo en la Raspberry Pi.
- `GIT_REMOTE_NAME` y `GIT_BRANCH_NAME` controlan desde dónde baja cambios `/actualizar`.
- `USE_SUDO=true` asume que el usuario del bot tendrá permisos `sudo` sin contraseña para `systemctl`.
- Si tu servicio de Minecraft no se llama `minecraft`, cambia `MINECRAFT_SERVICE_NAME`.
- Si omites `DISCORD_GUILD_ID`, el bot registrará comandos globales y Discord puede tardar un rato en mostrarlos.

## Instalación en desarrollo

```bash
npm install
cp .env.example .env
```

Edita `.env` y luego arranca el bot:

```bash
npm start
```

Validación rápida de sintaxis:

```bash
npm run check
```

## Comandos del bot

| Comando | Descripción | Requiere rol |
| --- | --- | --- |
| `/status` | Muestra si el servidor responde y cuántos jugadores hay | No |
| `/conectarme` | Comparte la dirección pública para unirse al servidor | No |
| `/players` | Intenta listar jugadores conectados | No |
| `/info` | Muestra resumen del servidor, acceso público y configuración principal | No |
| `/ping` | Muestra latencia del bot y uptime | No |
| `/servicio` | Muestra el estado del servicio `systemd` de Minecraft | Sí |
| `/actualizar` | Ejecuta `git pull` sobre `main` y reinicia el servicio del bot | Sí |
| `/start` | Inicia el servicio de Minecraft | Sí |
| `/stop` | Detiene el servicio de Minecraft | Sí |
| `/restart` | Reinicia el servicio de Minecraft | Sí |
| `/help` | Muestra ayuda | No |

## Deploy en Raspberry Pi

### 1. Clonar e instalar

```bash
cd /home/pi
git clone TU_REPO discord-minecraft-bot
cd discord-minecraft-bot
npm install
cp .env.example .env
nano .env
```

### 2. Configurar permisos para administrar Minecraft

El bot usa `systemctl` para controlar el servicio. Si corre con un usuario sin privilegios, agrega una regla `sudoers` basada en `deploy/sudoers/discord-bot-minecraft`.

Ejemplo:

```bash
sudo cp deploy/sudoers/discord-bot-minecraft /etc/sudoers.d/discord-bot-minecraft
sudo visudo -cf /etc/sudoers.d/discord-bot-minecraft
```

Debes reemplazar `discordbot` por el usuario real y validar que la ruta de `systemctl` sea correcta en tu Raspberry Pi.
Si vas a usar `/actualizar`, también debes permitir reiniciar el servicio del bot (`discord-bot` o el nombre que uses en `BOT_SERVICE_NAME`).

### 2.1. Registrar y usar slash commands

Si defines `DISCORD_GUILD_ID`, los comandos slash se registran al arrancar el bot y aparecen casi de inmediato en ese servidor. Si no lo defines, se registran globalmente.

Si los comandos no aparecen en Discord, revisa que el bot haya sido invitado con el scope `applications.commands`.

### 3. Instalar servicio del bot

Toma `deploy/systemd/discord-bot.service`, ajusta `User`, `WorkingDirectory` y `ExecStart`, y luego:

```bash
sudo cp deploy/systemd/discord-bot.service /etc/systemd/system/discord-bot.service
sudo systemctl daemon-reload
sudo systemctl enable discord-bot
sudo systemctl start discord-bot
sudo systemctl status discord-bot
```

### 4. Configurar backups automáticos

Haz ejecutable el script y programa un cron:

```bash
chmod +x deploy/backup.sh
crontab -e
```

Ejemplo cada 6 horas:

```cron
0 */6 * * * /home/pi/discord-minecraft-bot/deploy/backup.sh /opt/minecraft /opt/backups
```

El script elimina respaldos de más de 7 días. Ajusta esa política si necesitas mayor retención.

### 5. Exponer el servidor con Playit

```bash
playit setup
```

Selecciona:

- Minecraft Java
- Puerto `25565`

El dominio resultante será algo como `xxxxx.playit.gg`.

## Seguridad

- `.env` está excluido del repositorio.
- Los comandos sensibles se limitan a un rol específico.
- Las acciones administrativas usan `execFile` para evitar inyección por shell.
- La exposición pública de Minecraft debe hacerse solo a través del puerto necesario.

## Flujo recomendado de operación

1. Arranca Paper como servicio `minecraft`.
2. Verifica `/status` y `/players` desde Discord.
3. Verifica `/conectarme` para compartir la dirección pública correcta.
4. Prueba `/restart`, `/servicio` y `/actualizar` con una cuenta que tenga el rol autorizado.
5. Reinicia la Raspberry Pi y valida que `discord-bot` y `minecraft` vuelvan a levantar.
6. Comprueba acceso externo mediante el dominio de Playit.

## Mejoras futuras

- Alertas automáticas cuando el servidor caiga.
- Integración por RCON para comandos administrativos dentro del juego.
- Dashboard web.
- Logs persistentes y rotación de archivos.
- Rate limiting y allowlist de canales.
