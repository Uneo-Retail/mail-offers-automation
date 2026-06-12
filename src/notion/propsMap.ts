/**
 * Construction sûre des propriétés Notion à partir de valeurs typées.
 *
 * `PropsBuilder` ne pose une propriété que si elle existe dans le schéma de la
 * data source ET qu'elle est inscriptible ET que le type correspond. Les valeurs
 * null/undefined/"" sont ignorées (on n'écrase jamais avec du vide, on n'invente pas).
 *
 * ⚠️ Si une VALEUR utile est fournie mais que la propriété est introuvable / non
 * inscriptible / d'un type inattendu, on émet un `log.warn` : c'est le signal d'un
 * mauvais mapping (nom de propriété divergent du schéma réel du client). On ne
 * bloque pas — on rend visible.
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

  /**
   * Décide si on peut écrire `name` au type `expectedType`. Si une valeur utile est
   * fournie mais la propriété est absente/non inscriptible/du mauvais type → warn.
   */
  private canWrite(name: string, expectedType: string, hasValue: boolean): boolean {
    if (!hasValue) return false; // valeur vide → on n'écrit rien : cas normal, pas de warn
    const p = this.prop(name);
    if (isWritable(p) && p.type === expectedType) return true;
    log.warn("propsMap: valeur fournie mais propriété non écrite", {
      name,
      expectedType,
      found: p?.type ?? "absente",
    });
    return false;
  }

  title(name: string, value: string | null | undefined): this {
    if (this.canWrite(name, "title", !!value)) {
      this.props[name] = { title: [{ type: "text", text: { content: trunc(value!, 2000) } }] };
    }
    return this;
  }

  text(name: string, value: string | null | undefined): this {
    if (this.canWrite(name, "rich_text", value != null && value !== "")) {
      this.props[name] = { rich_text: [{ type: "text", text: { content: trunc(value!, 2000) } }] };
    }
    return this;
  }

  /** Rich text déjà assemblé (mentions de page, liens…) pour une propriété rich_text. */
  richText(name: string, richText: unknown[] | null | undefined): this {
    if (this.canWrite(name, "rich_text", !!richText && richText.length > 0)) {
      this.props[name] = { rich_text: richText };
    }
    return this;
  }

  number(name: string, value: number | null | undefined): this {
    if (this.canWrite(name, "number", value != null && Number.isFinite(value))) {
      this.props[name] = { number: value };
    }
    return this;
  }

  select(name: string, value: string | null | undefined): this {
    if (this.canWrite(name, "select", !!value)) {
      this.props[name] = { select: { name: trunc(value!, 100) } };
    }
    return this;
  }

  multiSelect(name: string, values: string[] | null | undefined): this {
    if (this.canWrite(name, "multi_select", !!values && values.length > 0)) {
      this.props[name] = { multi_select: values!.map((v) => ({ name: trunc(v, 100) })) };
    }
    return this;
  }

  date(name: string, isoDate: string | null | undefined): this {
    if (this.canWrite(name, "date", !!isoDate)) {
      this.props[name] = { date: { start: isoDate } };
    }
    return this;
  }

  email(name: string, value: string | null | undefined): this {
    if (this.canWrite(name, "email", !!value)) {
      this.props[name] = { email: value };
    }
    return this;
  }

  phone(name: string, value: string | null | undefined): this {
    if (this.canWrite(name, "phone_number", !!value)) {
      this.props[name] = { phone_number: value };
    }
    return this;
  }

  url(name: string, value: string | null | undefined): this {
    if (this.canWrite(name, "url", !!value)) {
      this.props[name] = { url: value };
    }
    return this;
  }

  relation(name: string, ids: string[] | null | undefined): this {
    if (this.canWrite(name, "relation", !!ids && ids.length > 0)) {
      this.props[name] = { relation: ids!.map((id) => ({ id })) };
    }
    return this;
  }

  /**
   * Propriété fichier : liste d'URLs externes (Azure). Notion accepte des fichiers
   * `external`. On ne pose rien si le type n'est pas `files`.
   */
  files(name: string, urls: { name: string; url: string }[] | null | undefined): this {
    if (this.canWrite(name, "files", !!urls && urls.length > 0)) {
      this.props[name] = {
        files: urls!.map((f) => ({ name: trunc(f.name, 100), type: "external", external: { url: f.url } })),
      };
    }
    return this;
  }

  /**
   * Lien : la DB Offres a `PDF`/`URL` dont le type exact varie (file vs url vs texte).
   * On s'adapte au schéma réel (point À VALIDER §10.3). Si la valeur est fournie mais
   * le type n'est aucun des trois attendus → warn (mapping à vérifier).
   */
  fileOrUrl(name: string, value: { name: string; url: string } | null | undefined): this {
    if (!value) return this;
    const p = this.prop(name);
    if (isWritable(p)) {
      if (p.type === "url") return this.url(name, value.url);
      if (p.type === "files") return this.files(name, [value]);
      if (p.type === "rich_text") return this.text(name, value.url);
    }
    log.warn("propsMap: valeur fournie mais propriété non écrite", {
      name,
      expectedType: "url|files|rich_text",
      found: p?.type ?? "absente",
    });
    return this;
  }

  build(): Record<string, unknown> {
    return this.props;
  }
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
