// Entry shim: `node --import ./scripts/node/register.mjs <script>`
import { register } from "node:module";
register("./extensionless-hooks.mjs", import.meta.url);
