import { runLibrettoCLI } from "./cli.js";
import {
  maybeConfigureLLMClientFactoryFromEnv,
  setLLMClientFactory,
} from "./core/context.js";

export { setLLMClientFactory };
export { runClose } from "./commands/browser.js";
export { runLibrettoCLI };

maybeConfigureLLMClientFactoryFromEnv();
void runLibrettoCLI();
