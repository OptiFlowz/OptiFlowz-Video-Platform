const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const ts = require('typescript');

const literals = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((?!\s*from\b)/gi;
const named = /\b(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blue|brown|chocolate|coral|crimson|cyan|darkblue|darkgray|darkgreen|darkgrey|darkred|fuchsia|gold|goldenrod|gray|green|grey|indigo|ivory|khaki|lavender|lightblue|lightgray|lightgreen|lightgrey|lime|linen|magenta|maroon|navy|olive|orange|orchid|pink|plum|purple|rebeccapurple|red|salmon|silver|skyblue|slateblue|slategray|slategrey|snow|tan|teal|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)\b/gi;
const fixedUtility = /\b(?:bg|text|border|ring|shadow|fill|stroke|from|via|to|outline|decoration|divide|accent|placeholder)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?(?:\/\d+)?\b/g;
const failures = [];
let checked = 0;

function report(file, line, value) {
  failures.push(`${file}:${line}: ${value.trim().slice(0, 160)}`);
}

function checkCss(file, css) {
  postcss.parse(css.replace(/\$\{[^}]*\}/g, "inherit"), { from: file }).walkDecls((declaration) => {
    // The existing central palette is the only source of literal colors.
    if (file === 'app/app.css' && declaration.parent.selector === ':root' && declaration.prop.startsWith('--')) return;
    const matches = [...declaration.value.matchAll(literals), ...declaration.value.matchAll(named)];
    if (matches.length) report(file, declaration.source.start.line, declaration.toString());
  });
}

function checkInlineColors(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function walk(node) {
    if (ts.isPropertyAssignment(node) && /^(?:color|background(?:Color)?|(?:border|outline)(?:Color)?|boxShadow|textShadow|fill|stroke|stopColor)$/.test(node.name.getText(tree))) {
      let ancestor = node.parent;
      while (ancestor && !ts.isVariableDeclaration(ancestor)) ancestor = ancestor.parent;
      // These are persisted menu option IDs; their rendering maps to theme vars.
      const isPreference = ancestor?.name.getText(tree) === 'DEFAULT_CAPTION_PREFERENCES';
      if (!isPreference && ts.isStringLiteral(node.initializer) && [...node.initializer.text.matchAll(named)].length) {
        report(file, tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, node.getText(tree));
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
}

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { visit(file); continue; }
    if (!/\.(?:css|scss|tsx?|jsx?|html|svg|json)$/.test(file)) continue;
    checked++;
    const source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.css')) { checkCss(file, source); continue; }
    if (/\.[jt]sx?$/.test(file)) checkInlineColors(file, source);
    for (const expression of [literals, fixedUtility]) {
      for (const match of source.matchAll(expression)) {
        report(file, source.slice(0, match.index).split('\n').length, match[0]);
      }
    }
    for (const match of source.matchAll(/<style>([\s\S]*?)<\/style>/g)) checkCss(file, match[1]);
    // SVG presentation attributes are colors even when outside a stylesheet.
    for (const match of source.matchAll(/(?:fill|stroke|stop-color|stopColor)=["']([^"']+)["']/g)) {
      if ([...match[1].matchAll(named)].length) report(file, source.slice(0, match.index).split('\n').length, match[0]);
    }
  }
}

visit('app');
visit('public');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${checked} source files: no hardcoded UI colors outside the central CSS palette.`);
}
