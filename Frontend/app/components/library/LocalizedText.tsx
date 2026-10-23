import { cloneElement, Fragment, isValidElement, type ReactNode } from "react";

type Props = {
  text: string;
  components?: Record<string, ReactNode>;
};

/** Translated sentences can reorder emphasis and links without embedding HTML. */
export default function LocalizedText({ text, components = {} }: Props) {
  const tokens = text.split(/(<\/?[a-z][a-z0-9]*\s*\/?>)/g);
  let index = 0;

  function read(closingTag?: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    while (index < tokens.length) {
      const token = tokens[index++];
      const match = /^<(\/?)([a-z][a-z0-9]*)\s*(\/?)>$/.exec(token);
      if (!match) { nodes.push(token); continue; }
      const [, closing, name, selfClosing] = match;
      if (closing && name === closingTag) return nodes;
      if (closing) { nodes.push(token); continue; }
      const key = index;
      if (name === "br") { nodes.push(<br key={key} />); continue; }
      if (selfClosing) {
        nodes.push(<Fragment key={key}>{components[name] ?? token}</Fragment>);
        continue;
      }
      const children = read(name);
      if (name === "strong") nodes.push(<strong key={key}>{children}</strong>);
      else if (isValidElement(components[name])) nodes.push(cloneElement(components[name], { key }, children));
      else nodes.push(<Fragment key={key}>{token}{children}{`</${name}>`}</Fragment>);
    }
    return nodes;
  }

  return <>{read()}</>;
}
