import { Mail, MessageSquare, Phone, Radio, Smartphone } from "lucide-react";
import type { Channel } from "@xeno/shared";

/** Shared channel presentation (icon + label) for the console cards. */
export const CHANNEL_META: Record<
  Channel,
  { icon: typeof Mail; label: string }
> = {
  EMAIL: { icon: Mail, label: "Email" },
  SMS: { icon: Phone, label: "SMS" },
  WHATSAPP: { icon: MessageSquare, label: "WhatsApp" },
  RCS: { icon: Smartphone, label: "RCS" },
};

export function channelMeta(channel: Channel) {
  return CHANNEL_META[channel] ?? { icon: Radio, label: channel };
}
