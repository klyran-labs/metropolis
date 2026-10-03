import { en, type Catalog, type MessageKey } from "./en.ts";

export type { Catalog, MessageKey };

/** Names of the `{placeholders}` in a template, as a union: Params<"a {x} b {y}"> is "x" | "y". */
type Params<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Params<Rest> : never;

type ParamsFor<K extends MessageKey> = Params<(typeof en)[K]>;

/** Messages without placeholders take no second argument; messages with them require every one. */
type Args<K extends MessageKey> = [ParamsFor<K>] extends [never]
  ? []
  : [params: Record<ParamsFor<K>, string | number>];

/** Keys whose message has no placeholders: safe to look up with a key chosen at run time. */
export type SimpleKey = { [K in MessageKey]: [ParamsFor<K>] extends [never] ? K : never }[MessageKey];

// One catalog today. A second language is another file of the same `Catalog` shape plus a lookup here.
const catalog: Catalog = en;

export function has(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(catalog, key);
}

/** Looks up a message and fills in its placeholders. */
export function t<K extends MessageKey>(key: K, ...args: Args<K>): string {
  const template = catalog[key];
  const params = (args[0] ?? {}) as Record<string, string | number>;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    // Typed callers cannot get here; this guards untyped ones (data-driven keys) from rendering blanks.
    if (value === undefined) throw new Error(`Message "${key}" needs "${name}"`);
    return String(value);
  });
}
