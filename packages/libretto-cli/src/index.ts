import { runLibrettoCLI } from "./cli";
import {
  maybeConfigureLLMClientFactoryFromEnv,
  setLLMClientFactory,
} from "./core/context";

export { setLLMClientFactory };
export { runClose } from "./commands/browser";
export { runLibrettoCLI };

maybeConfigureLLMClientFactoryFromEnv();
void runLibrettoCLI();
