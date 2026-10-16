// tsc copies catalog.json into dist/; point the compiled code at the package
// root copy instead, so there is exactly one catalog.json (also the file
// Handy's Rust side compiles in).
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const index = new URL("../dist/src/index.js", import.meta.url);
const source = readFileSync(index, "utf8");
const patched = source.replace('from "../catalog.json"', 'from "../../catalog.json"');
if (patched === source) throw new Error("postbuild: catalog.json import not found in dist/src/index.js");
writeFileSync(index, patched);
rmSync(new URL("../dist/catalog.json", import.meta.url));
