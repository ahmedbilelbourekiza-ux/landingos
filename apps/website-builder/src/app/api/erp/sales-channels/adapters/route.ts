import { tenantRoute, apiOk } from "@/lib/api/route";
import { listChannelPlatforms } from "@/lib/erp/channel-adapters";

export const dynamic = "force-dynamic";

/**
 * Which storefront platforms this deployment offers — LP.15, restoring R8.
 *
 * The legacy's `GET /api/platforms`. The console needs it to render a platform
 * dropdown at all; without it the field was free text, and a typo produced a
 * channel whose signature header lookup silently fell through to LightFunnels'.
 *
 * EVERY ENTRY SAYS WHETHER IT IS REAL. `registered: false` means inbound
 * webhooks are parsed generically and a connection test is structural — the
 * platform still works, and the screen must be able to say that rather than
 * implying a live integration. That is the same honesty LP.14 gave the carrier
 * test and D-LP.2 gave the carrier adapter.
 *
 * `erp:settings:write`, matching the rest of the channel surface: configuring a
 * storefront connection is a settings action, and the list exists to serve the
 * form.
 */
export const GET = tenantRoute("erp:settings:write", async () =>
  apiOk({ items: listChannelPlatforms() }),
);
