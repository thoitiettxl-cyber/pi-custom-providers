import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const YAML = require("./yaml-lite.cjs");
export { YAML };
export default { YAML };
