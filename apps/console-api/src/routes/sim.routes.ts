import type { FastifyInstance } from "fastify";
import {
  authenticate,
  requireSimKernelSecret,
  requireTier,
} from "../middleware/auth.middleware";
import { registerSimRunRoutes } from "./sim-run.routes";
import { registerSimSwarmRoutes } from "./sim-swarm.routes";
import { registerSimLauncherRoutes } from "./sim-launcher.routes";
import { registerSimControlRoutes } from "./sim-control.routes";
import { registerSimKernelRoutes } from "./sim-kernel.routes";
export type { SimRouteServices } from "./sim-route-services";
import type { SimRouteServices } from "./sim-route-services";

type SimRouteConfig = {
  simKernelSharedSecret?: string;
};

export function registerSimRoutes(
  app: FastifyInstance,
  s: SimRouteServices,
  config: SimRouteConfig = {},
): void {
  app.register((simApp, _opts, done) => {
    simApp.addHook("preHandler", authenticate);
    simApp.addHook("preHandler", requireTier("investment", "franchise"));

    registerSimRunRoutes(simApp, s);
    registerSimSwarmRoutes(simApp, s);
    registerSimLauncherRoutes(simApp, s);
    registerSimControlRoutes(simApp, s);
    done();
  });

  app.register((queueApp, _opts, done) => {
    queueApp.addHook(
      "preHandler",
      requireSimKernelSecret(config.simKernelSharedSecret),
    );
    registerSimKernelRoutes(queueApp, s);
    done();
  });
}
