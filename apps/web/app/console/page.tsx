import type { Metadata } from "next";

import { Console } from "@/components/console/console";

export const metadata: Metadata = {
  title: "Console · Looms",
  description:
    "Turn plain-English intent into an editable segment, message draft, and a launch you control.",
};

export default function ConsolePage() {
  return <Console />;
}
