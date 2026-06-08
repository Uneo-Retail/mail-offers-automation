/**
 * Shim minimal des types Vercel pour éviter une dépendance supplémentaire.
 * À l'exécution, Vercel fournit des objets compatibles `http.IncomingMessage` /
 * `http.ServerResponse` enrichis. On ne déclare ici que ce qu'on utilise.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
  headers: IncomingMessage["headers"];
}

export interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  json(body: unknown): VercelResponse;
  send(body: unknown): VercelResponse;
}
