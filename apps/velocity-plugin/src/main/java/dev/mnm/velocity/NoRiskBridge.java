package dev.mnm.velocity;

import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.proxy.ProxyServer;
import java.lang.reflect.Method;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;

/**
 * Optional NoRisk Client detection through the official NoRisk Client server
 * API (https://docs.norisk.gg/), a separate Velocity plugin that performs the
 * client handshake. Nexora does not bundle or require it: the API is looked up
 * at runtime through the installed plugin's class loader, and any mismatch
 * disables the integration with one log line instead of failing.
 *
 * <p>Documented API: {@code gg.norisk.velocity.Velocity.getCoreApi()} returning
 * {@code gg.norisk.core.common.CoreAPI} with {@code isNrcPlayer(UUID)}. Players
 * are registered after their handshake, so the check runs a few seconds after
 * login. The handshake is the client's own claim; it is reported as the
 * detection source "integration", not as a verified identity.
 */
final class NoRiskBridge {
    /** Plugin ids used by the NoRisk Client server API (the documentation lists both). */
    static final String[] PLUGIN_IDS = {"nrc-server-api", "noriskclient-server-api"};

    private final Method getCoreApi;
    private final Method isNrcPlayer;
    private final Logger logger;
    private volatile boolean failed;

    private NoRiskBridge(Method getCoreApi, Method isNrcPlayer, Logger logger) {
        this.getCoreApi = getCoreApi;
        this.isNrcPlayer = isNrcPlayer;
        this.logger = logger;
    }

    /** The bridge when the NoRisk server API plugin is installed and matches the documented API, else null. */
    static NoRiskBridge detect(ProxyServer proxy, Logger logger) {
        for (String id : PLUGIN_IDS) {
            Optional<PluginContainer> plugin = proxy.getPluginManager().getPlugin(id);
            if (plugin.isEmpty()) continue;
            Optional<?> instance = plugin.get().getInstance();
            if (instance.isEmpty()) continue;
            ClassLoader loader = instance.get().getClass().getClassLoader();
            try {
                Method getCoreApi = Class.forName("gg.norisk.velocity.Velocity", true, loader).getMethod("getCoreApi");
                Method isNrcPlayer = Class.forName("gg.norisk.core.common.CoreAPI", true, loader).getMethod("isNrcPlayer", UUID.class);
                logger.info("NoRisk Client server API found ({}): NoRisk Client players can be identified", id);
                return new NoRiskBridge(getCoreApi, isNrcPlayer, logger);
            } catch (ReflectiveOperationException | LinkageError e) {
                logger.warn("NoRisk Client server API plugin '{}' found, but its API does not match the documented one ({}); NoRisk detection disabled", id, e.toString());
                return null;
            }
        }
        return null;
    }

    /** True/false from the NoRisk API; empty when it cannot answer (not ready, API error). */
    Optional<Boolean> isNoRiskPlayer(UUID player) {
        if (failed) return Optional.empty();
        try {
            Object api = getCoreApi.invoke(null);
            if (api == null) return Optional.empty();
            Object result = isNrcPlayer.invoke(api, player);
            return result instanceof Boolean b ? Optional.of(b) : Optional.empty();
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            failed = true;
            logger.warn("NoRisk Client server API call failed ({}); NoRisk detection disabled until restart", e.toString());
            return Optional.empty();
        }
    }
}
