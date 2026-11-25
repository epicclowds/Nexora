# Nexora {{VERSION}} – Minecraft plugins

| File | Install on |
| --- | --- |
| `Nexora-Velocity-{{VERSION}}.jar` | Your Velocity proxy (`plugins/`) |
| `Nexora-Paper-{{VERSION}}.jar` | Every Paper server behind the proxy (`plugins/`) |

Requires Java {{JAVA}}. Tested with Velocity {{VELOCITY}} and Paper {{PAPER}}.

1. Copy the jar into the server's `plugins/` folder.
2. In the Nexora dashboard open **Settings → Minecraft integration → Add a server**,
   create a token and download the generated `config.properties`.
3. Put it into `plugins/networkmanager/` (Velocity) or `plugins/Nexora/` (Paper; existing `plugins/NetworkManager/` folders are moved automatically)
   and start the server. The dashboard shows when the server has registered.

`examples/` contains the default configuration files with every option explained.
Guide: https://github.com/epicclowds/Nexora/blob/v{{VERSION}}/docs/installation/minecraft-plugins.md
