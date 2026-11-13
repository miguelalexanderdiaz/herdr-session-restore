// JSON edits for install/install.sh, which can't edit JSON itself. Runs under Node (any version)
// or under macOS's built-in JavaScript (`osascript -l JavaScript`), so a Mac needs nothing
// installed. The same file can serve other repositories' installers.
//
//   keys-plan  <your keys.json> <repo keys.json>   one line per binding, tab-separated:
//              add|same|conflict <section> <chord> <repo action> [<your action>]
//   keys-set   <your keys.json> <lines file>       "<section>\t<chord>\t<action>" lines: set each
//   keys-unset <your keys.json> <lines file>       the same lines: remove each binding that still
//              has that action (one you changed since is left alone)
//   panel-add  <layout.json> <snippet.json> <id>   append the snippet to the children of the node
//              with that id, unless a node with the snippet's id is already there
//   panel-drop <layout.json> <id>                  remove the node with that id, wherever it is

"use strict";
const isNode = typeof process !== "undefined" && process.versions && process.versions.node;
if (!isNode) ObjC.import("Foundation");

function readText(p) {
  if (isNode) return require("fs").readFileSync(p, "utf8");
  const s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null);
  if (s.isNil()) throw new Error("cannot read " + p);
  return ObjC.unwrap(s);
}
function writeText(p, text) {
  if (isNode) { require("fs").writeFileSync(p, text); return; }
  if (!$(text).writeToFileAtomicallyEncodingError(p, true, $.NSUTF8StringEncoding, null)) throw new Error("cannot write " + p);
}
const readJson = (p) => JSON.parse(readText(p));
const writeJson = (p, v) => writeText(p, JSON.stringify(v, null, 2) + "\n");
const lines = (p) => readText(p).split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split("\t"));

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children || []) { const f = find(c, id); if (f) return f; }
  return null;
}
function drop(node, id) {
  if (!node || !Array.isArray(node.children)) return false;
  const before = node.children.length;
  node.children = node.children.filter((c) => c.id !== id);
  return node.children.length !== before || node.children.some((c) => drop(c, id));
}

function main(args) {
  const [op, a, b, c] = args;
  switch (op) {
    case "keys-plan": {
      const mine = readJson(a), repo = readJson(b), out = [];
      for (const section of Object.keys(repo)) {
        for (const chord of Object.keys(repo[section])) {
          const want = repo[section][chord], have = (mine[section] || {})[chord];
          if (have === undefined) out.push(["add", section, chord, want]);
          else if (have === want) out.push(["same", section, chord, want]);
          else out.push(["conflict", section, chord, want, have]);
        }
      }
      return out.map((l) => l.join("\t")).join("\n");
    }
    case "keys-set": case "keys-unset": {
      const keys = readJson(a);
      for (const [section, chord, action] of lines(b)) {
        if (op === "keys-set") (keys[section] = keys[section] || {})[chord] = action;
        else if (keys[section] && keys[section][chord] === action) {
          delete keys[section][chord];
          if (!Object.keys(keys[section]).length) delete keys[section];
        }
      }
      writeJson(a, keys);
      return "";
    }
    case "panel-add": {
      const layout = readJson(a), snippet = readJson(b), parent = find(layout.root || layout, c);
      if (!parent || !Array.isArray(parent.children)) return "no-node";
      if (parent.children.some((n) => n.id === snippet.id)) return "present";
      parent.children.push(snippet);
      writeJson(a, layout);
      return "added";
    }
    case "panel-drop": {
      const layout = readJson(a);
      if (!drop(layout.root || layout, b)) return "absent";
      writeJson(a, layout);
      return "dropped";
    }
    default: throw new Error("unknown operation: " + op);
  }
}

// Node runs the file top to bottom; osascript calls run(argv) and prints what it returns.
function run(argv) { return main(argv.map(String)); }
if (isNode) { const out = main(process.argv.slice(2)); if (out) process.stdout.write(out + "\n"); }
