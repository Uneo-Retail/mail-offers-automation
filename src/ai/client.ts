/**
 * Wrapper Anthropic : un seul client partagé, et un helper « tool use forcé »
 * qui renvoie directement les arguments de l'outil appelé.
 */
import Anthropic from "@anthropic-ai/sdk";
import { anthropicConfig } from "../config.js";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: anthropicConfig().apiKey });
  return client;
}

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/**
 * Appelle le modèle en forçant l'utilisation d'un outil unique, et retourne
 * l'objet d'arguments produit (non validé). Lève si le modèle n'appelle pas l'outil.
 */
export async function runForcedTool(opts: {
  model: string;
  system: string;
  content: Anthropic.Messages.ContentBlockParam[];
  tool: ToolDef;
  maxTokens?: number;
}): Promise<unknown> {
  const res = await anthropic().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    tools: [opts.tool as Anthropic.Messages.Tool],
    tool_choice: { type: "tool", name: opts.tool.name },
    messages: [{ role: "user", content: opts.content }],
  });

  for (const block of res.content) {
    if (block.type === "tool_use" && block.name === opts.tool.name) {
      return block.input;
    }
  }
  throw new Error(`Le modèle n'a pas appelé l'outil ${opts.tool.name}`);
}
