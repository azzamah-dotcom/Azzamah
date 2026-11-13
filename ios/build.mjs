// Builds the iPhone app's web content from the same files the website uses (in the folder above),
// so the app and the site stay in step. Nothing in the website files is changed.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const out = join(here, "www");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const files = ["index.html", "app.js", "prayer.js", "azkar.json", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
for (const f of files) cpSync(join(site, f), join(out, f));
cpSync(join(site, "parent"), join(out, "parent"), { recursive: true });
if (existsSync(join(site, "adhan.mp3"))) cpSync(join(site, "adhan.mp3"), join(out, "adhan.mp3"));
cpSync(join(here, "native.js"), join(out, "native.js"));

// Load the native layer before the app's own script.
let html = readFileSync(join(out, "index.html"), "utf8");
if (!html.includes('src="prayer.js"')) throw new Error("index.html layout changed: prayer.js script tag not found");
html = html.replace('<script src="prayer.js"></script>', '<script src="prayer.js"></script>\n<script src="native.js"></script>');
writeFileSync(join(out, "index.html"), html);
console.log("www ready:", files.length + 2, "items");
