import { channelWebhook } from "@/lib/erp/webhook-route";

export const dynamic = "force-dynamic";

/** A contact-form submission. Same treatment as an abandoned checkout. */
export const POST = channelWebhook("contact");
