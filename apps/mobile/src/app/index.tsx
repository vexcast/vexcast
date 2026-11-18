import { Redirect } from "expo-router";

import { Splash } from "@/components/Splash";
import { useRemote } from "@/state/remote";

export default function Index() {
  const { phase, session } = useRemote();
  if (session) return <Redirect href="/dashboard" />;
  if (phase === "restoring") return <Splash />;
  return <Redirect href="/connect" />;
}
