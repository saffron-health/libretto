import { createFileRoute } from "@tanstack/react-router";
import { DevicePage } from "../DevicePage";

export const Route = createFileRoute("/device")({
  component: DevicePage,
});
