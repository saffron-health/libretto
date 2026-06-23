import { createFileRoute } from "@tanstack/react-router";
import { IcosahedronDebug } from "../IcosahedronDebug";

export const Route = createFileRoute("/icosahedron")({
  component: IcosahedronDebug,
});
