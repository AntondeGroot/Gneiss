// GitHub Pages has no SPA rewrite: a deep link like /Gneiss/review is a real 404
// because no such file exists. Serving index.html as the 404 page hands the route
// to Angular's router instead, which then resolves it client-side.
//
// Written in Node rather than `cp` so the build works the same on any platform.
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const out = join("dist", "gneiss", "browser");
copyFileSync(join(out, "index.html"), join(out, "404.html"));
console.log("wrote 404.html for SPA routing");
