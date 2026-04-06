#!/usr/bin/env node
import { runLibrettoCLI } from "./cli.js";
import {
  maybeConfigureModelFactoryFromEnv,
  setModelFactory,
  setLLMClientFactory,
} from "./core/context.js";

export { setModelFactory, setLLMClientFactory };
export { runClose } from "./commands/browser.js";
export { runLibrettoCLI };

maybeConfigureModelFactoryFromEnv();
void runLibrettoCLI();
