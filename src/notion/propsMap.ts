/**
 * Construction sûre des propriétés Notion à partir de valeurs typées.
 *
 * `PropsBuilder` ne pose une propriété que si elle existe dans le schéma de la
 * data source ET qu'elle est inscriptible ET que le type correspond. Les valeurs
 * null/undefined/"" sont ignorées (on n'écrase jamais avec du vide, on n'invente pas).
 */
import type { DataSourceSchema, PropSchema } from "./client.js";
import { isWritable } from "./client.js";
import { log } from "../log.js";

export class PropsBuilder {
  private props: Record<string, unknown> = {};
  constructor(private schema: DataSourceSchema) {}

  private prop(name: string): PropSchema | undefined {
    return this.schema[name];
  }

  private skip(name: string, reason: string): void {
    log.debug("propsMap: propriété ignorée", { name, reason });
  }

  title(name: string, value: string | null | undefined): this {
    const p = this.prop(name);
    if (!value || !isWritable(p) || p.type !== "title") return this;
    this.props[name] = { title: [{ type: "text", text: { content: trunc(value, 2000) } }] };
    return this;
  }

  text(name: string, value: string | null | undefined): this {
    const p = this.prop(name);
    if (value == null || value === "" || !isWritable(p) || p.type !== "rich_text") return this;
    this.props[name] = { rich_text: [{ type: "text", text: { content: trunc(value, 2000) } }] };
    return this;
  }

  number(name: string, value: number | null | undefined): this {
    const p = this.prop(name);
    if (value == null || !Number.isFinite(value)) return this;
    if (!isWritable(p) || p.type !== "number") {
      if (p) this.skip(name, `type=${p.type} (attendu number)`);
      return this;
    }
    this.props[name] = { number: value };
    return this;
  }

  select(name: string, value: string | null | undefined): this {
    const p = this.prop(name);
    if (!value || !isWritable(p) || p.type !== "select") return this;
    this.props[name] = { select: { name: trunc(value, 100) } };
    return this;
  }

  multiSelect(name: string, values: string[] | null | undefined): this {
    const p = this.prop(name);
    if (!values || values.length === 0 || !isWritable(p) || p.type !== "multi_select") return this;
    this.props[name] = { multi_select: values.map((v) => ({ name: trunc(v, 100) })) };
    return this;
  }

  date(name: string, isoDate: string | null | undefined): this {
    const p = this.prop(name);
    if (!isoDate || !isWritable(p) || p.type !== "date") return this;
    this.props[name] = { date: { start: isoDate } };
    return this;
  }

  email(name: string, value: string | null | undefined): this {
    const p = this.prop(name);
    if (!value || !isWritable(p) || p.type !== "email") return this;
    this.props[name] = { email: value };
    return this;
  }

  phone(name: string, value: string | null | undefined): this {
    const p = this.prop(name);
    if (!value || !isWritable(p) || p.type !== "phone_number") return this;
    this.props[name] = { phone_number: value };
    return this;
  }

  url(name: string, value: string | null | undefined): this {
    const p = this.prop(name);
    if (!value || !isWritable(p) || p.type !== "url") return this;
    this.props[name] = { url: value };
    return this;
  }

  relation(name: string, ids: string[] | null | undefined): this {
    const p = this.prop(name);
    if (!ids || ids.length === 0 || !isWritable(p) || p.type !== "relation") return this;
    this.props[name] = { relation: ids.map((id) => ({ id })) };
    return this;
  }

  /**
   * Propriété fichier : liste d'URLs externes (Azure). Notion accepte des fichiers
   * `external`. On ne pose rien si le type n'est pas `files`.
   */
  files(name: string, urls: { name: string; url: string }[] | null | undefined): this {
    const p = this.prop(name);
    if (!urls || urls.length === 0 || !isWritable(p) || p.type !== "files") return this;
    this.props[name] = {
      files: urls.map((f) => ({ name: trunc(f.name, 100), type: "external", external: { url: f.url } })),
    };
    return this;
  }

  /**
   * Lien : la DB Offres a `PDF`/`URL` dont le type exact varie (file vs url).
   * On s'adapte au schéma réel (point À VALIDER §10.3).
   */
  fileOrUrl(name: string, value: { name: string; url: string } | null | undefined): this {
    const p = this.prop(name);
    if (!value || !isWritable(p)) return this;
    if (p.type === "url") return this.url(name, value.url);
    if (p.type === "files") return this.files(name, [value]);
    if (p.type === "rich_text") return this.text(name, value.url);
    return this;
  }

  build(): Record<string, unknown> {
    return this.props;
  }
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
