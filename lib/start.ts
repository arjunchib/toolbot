import { serve, validateRequest, json } from "sift";
import { verifySignature, digestMessage } from "./util.ts";
import { onInteraction } from "./handlers/interaction.ts";
import {
  APIInteractionResponseCallbackData,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord_api_types";

interface Command {
  handler(
    props: any,
    state: any,
    listeners: any
  ): APIInteractionResponseCallbackData;
  options: {
    name: string;
    description: string;
    options: Record<string, any>;
    state: Record<string, any>;
    listeners: Record<string, any>;
  };
}

export interface Options {
  commands: Command[];
  application_id: string;
  bot_token: string;
  guild_id?: string;
}

export function start(options: Options) {
  registerCommands(options);
  serve({ "/": onRequest });
}

async function onRequest(request: Request): Promise<Response> {
  // validateRequest() ensures that a request is of POST method and
  // has the following headers.
  const { error } = await validateRequest(request, {
    POST: { headers: ["X-Signature-Ed25519", "X-Signature-Timestamp"] },
  });
  if (error) {
    return json({ error: error.message }, { status: error.status });
  }

  // verifySignature() verifies if the request is coming from Discord.
  // When the request's signature is not valid, we return a 401 and this is
  // important as Discord sends invalid requests to test our verification.
  const { valid, body } = await verifySignature(request);
  if (!valid) {
    return json({ error: "Invalid request" }, { status: 401 });
  }

  // Handle interaction if request is a discord interaction event
  try {
    const res = onInteraction(JSON.parse(body));
    console.log(res);
    return json(res);
  } catch (e) {
    console.error(e);
    // We will return a bad request error as a valid Discord request
    // shouldn't reach here.
    return json({ error: "bad request" }, { status: 400 });
  }
}

async function registerCommands(options: Options) {
  const { application_id, guild_id, bot_token, commands } = options;
  const body = commands.map((c) => {
    const { name, description, options } = c.options;
    const command: Record<string, any> = { name, description };
    command.options = Object.entries(options!).map(([k, v]: [any, any]) => {
      v.name = k;
      switch (v.type) {
        case "string":
          v.type = 3;
          break;
        default:
          v.type = 4;
      }
      return v;
    });
    return command;
  });
  if (await tryCache("commandHash", [body, options])) {
    console.log("Skipped updating commands");
    return;
  }
  const res = await fetch(
    `https://discord.com/api/v9/applications/${application_id}/guilds/${guild_id}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${bot_token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    }
  );
}

async function tryCache(key: string, data: any) {
  try {
    // Call localStorage early to bail if it does not exist
    const storedHash = localStorage.getItem(key);
    const hash = await digestMessage(JSON.stringify(data));
    if (storedHash === hash) {
      return true;
    }
    localStorage.setItem(key, hash);
    return false;
  } catch (e) {
    if (e instanceof ReferenceError) {
      return false;
    } else {
      throw e;
    }
  }
}