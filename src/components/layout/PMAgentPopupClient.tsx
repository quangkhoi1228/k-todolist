"use client";

import dynamic from "next/dynamic";

const PMAgentPopup = dynamic(
  () => import("../../../agents/pm/components/PMAgentPopup").then((m) => ({ default: m.PMAgentPopup })),
  { ssr: false }
);

export function PMAgentPopupClient() {
  return <PMAgentPopup />;
}
