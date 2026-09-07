import { readFileSync } from "node:fs";
import path from "node:path";

// Metadata and generated images cannot inherit CSS custom properties. Read the
// existing palette so those surfaces share the stylesheet's source of truth.
const stylesheet = readFileSync(path.join(process.cwd(), "app/app.css"), "utf8");
const root = stylesheet.match(/:root\s*\{([^}]+)\}/)?.[1] ?? "";
const variables = new Map(
  Array.from(root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), ([, name, value]) => [name, value.trim()]),
);

export function themeColor(name: string): string {
  const resolve = (key: string, visited: Set<string>): string => {
    const value = variables.get(key);
    if (!value || visited.has(key)) throw new Error(`Cannot resolve theme color: ${key}`);
    visited.add(key);
    return value.replace(/var\((--[\w-]+)\)/g, (_, reference: string) =>
      resolve(reference, new Set(visited)),
    );
  };
  return resolve(name, new Set());
}
