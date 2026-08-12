import { z } from "zod";
import { SimpleCLI } from "affordance";
import { orpcCall } from "../core/auth-fetch.js";
import { withCloudApiKey } from "./shared.js";

type SmsNumber = {
  id: string;
  phone_number: string;
  agentphone_number_id: string;
  label: string | null;
  status: "active" | "released";
  created_at: string;
  updated_at: string;
};

export const provisionSmsNumberCommand = SimpleCLI.command({
  description: "Provision an AgentPhone inbox number into your tenant pool",
})
  .input(
    SimpleCLI.input({
      positionals: [],
      named: {
        label: SimpleCLI.option(z.string().optional(), {
          help: "Optional label (e.g. uhc). Prefer one number per portal.",
        }),
        country: SimpleCLI.option(z.string().optional(), {
          help: "Two-letter country code (default US)",
        }),
        areaCode: SimpleCLI.option(z.string().optional(), {
          name: "area-code",
          help: "Preferred area code (best-effort)",
        }),
      },
    }),
  )
  .use(withCloudApiKey("manage SMS inbox numbers"))
  .handle(async ({ input, ctx }) => {
    const response = await orpcCall<{
      success: true;
      number: SmsNumber;
      message: string;
    }>({
      apiUrl: ctx.apiUrl,
      path: "/v1/sms-numbers/provision",
      input: {
        label: input.label,
        country: input.country,
        area_code: input.areaCode,
      },
      credential: ctx.credential,
    });
    console.log(response.message);
    console.log(`id:    ${response.number.id}`);
    console.log(`phone: ${response.number.phone_number}`);
    if (response.number.label) {
      console.log(`label: ${response.number.label}`);
    }
    console.log(
      "Register this phone number as the MFA phone on the portal account before using waitForSmsOtp.",
    );
  });

export const listSmsNumbersCommand = SimpleCLI.command({
  description: "List SMS inbox numbers in your tenant pool",
})
  .input(
    SimpleCLI.input({
      positionals: [],
      named: {
        includeReleased: SimpleCLI.flag({
          name: "include-released",
          help: "Include released numbers",
        }),
      },
    }),
  )
  .use(withCloudApiKey("list SMS inbox numbers"))
  .handle(async ({ input, ctx }) => {
    const response = await orpcCall<{ numbers: SmsNumber[] }>({
      apiUrl: ctx.apiUrl,
      path: "/v1/sms-numbers/list",
      input: { include_released: input.includeReleased || undefined },
      credential: ctx.credential,
    });
    if (response.numbers.length === 0) {
      console.log(
        "No SMS numbers in the pool. Provision one with `libretto cloud sms-numbers provision --label <portal>`.",
      );
      return;
    }
    for (const number of response.numbers) {
      const label = number.label ? ` label=${number.label}` : "";
      console.log(
        `${number.phone_number}  id=${number.id}  status=${number.status}${label}`,
      );
    }
  });

export const updateSmsNumberCommand = SimpleCLI.command({
  description: "Update the label on an SMS inbox number",
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("id", z.string(), {
          help: "SMS number id from list/provision",
        }),
      ],
      named: {
        label: SimpleCLI.option(z.string().optional(), {
          help: "New label. Pass an empty string to clear.",
        }),
        clearLabel: SimpleCLI.flag({
          name: "clear-label",
          help: "Clear the label on this number",
        }),
      },
    }),
  )
  .use(withCloudApiKey("update SMS inbox numbers"))
  .handle(async ({ input, ctx }) => {
    if (input.label === undefined && !input.clearLabel) {
      throw new Error("Pass --label <name> or --clear-label.");
    }
    const response = await orpcCall<{ success: true; number: SmsNumber }>({
      apiUrl: ctx.apiUrl,
      path: "/v1/sms-numbers/update",
      input: {
        id: input.id,
        label: input.clearLabel ? null : input.label === "" ? null : input.label,
      },
      credential: ctx.credential,
    });
    console.log(
      `Updated ${response.number.phone_number} label=${response.number.label ?? "(none)"}`,
    );
  });

export const releaseSmsNumberCommand = SimpleCLI.command({
  description: "Release an SMS inbox number (irreversible)",
})
  .input(
    SimpleCLI.input({
      positionals: [
        SimpleCLI.positional("id", z.string(), {
          help: "SMS number id from list/provision",
        }),
      ],
      named: {},
    }),
  )
  .use(withCloudApiKey("release SMS inbox numbers"))
  .handle(async ({ input, ctx }) => {
    const response = await orpcCall<{ success: true; message: string }>({
      apiUrl: ctx.apiUrl,
      path: "/v1/sms-numbers/release",
      input: { id: input.id },
      credential: ctx.credential,
    });
    console.log(response.message);
  });

export const cloudSmsNumberCommands = SimpleCLI.group({
  description: "Manage SMS inbox numbers for portal OTP",
  routes: {
    provision: provisionSmsNumberCommand,
    list: listSmsNumbersCommand,
    update: updateSmsNumberCommand,
    release: releaseSmsNumberCommand,
  },
});
