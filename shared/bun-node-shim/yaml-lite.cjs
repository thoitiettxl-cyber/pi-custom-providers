"use strict";
/** Tiny YAML subset for omp frontmatter under Node (maps/scalars/lists). Not full YAML. */
function parse(text) {
  if (text == null) return null;
  const src = String(text).replace(/\t/g, "  ");
  try {
    // Prefer full parser when available (optional)
    return require("yaml").parse(src);
  } catch {
    /* fall through */
  }
  const lines = src.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, obj: root, key: null, isArr: false }];
  for (let raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.slice(indent);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    const arrMatch = line.match(/^- (.*)$/);
    if (arrMatch) {
      const val = coerce(arrMatch[1]);
      if (!Array.isArray(parent.obj[parent.key])) parent.obj[parent.key] = [];
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        parent.obj[parent.key].push(val);
        stack.push({ indent, obj: val, key: null, isArr: false });
      } else {
        parent.obj[parent.key].push(val);
      }
      continue;
    }
    const kv = line.match(/^([^:#]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const rest = kv[2];
    if (rest === "" || rest === "|" || rest === ">") {
      const child = {};
      parent.obj[key] = child;
      stack.push({ indent, obj: child, key: null, isArr: false });
    } else if (rest === "[]") {
      parent.obj[key] = [];
    } else {
      parent.obj[key] = coerce(rest);
      parent.key = key;
    }
  }
  return root;
}
function coerce(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}
function stringify(value) {
  try {
    return require("yaml").stringify(value);
  } catch {
    return JSON.stringify(value, null, 2);
  }
}
module.exports = { parse, stringify };
