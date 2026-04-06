#!/usr/bin/env node
import { runLibrettoCLI } from "./cli.js";

export { runClose } from "./commands/browser.js";
export { runLibrettoCLI };

void runLibrettoCLI();
