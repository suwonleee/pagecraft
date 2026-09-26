import { spawn } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { createHtmlEditorServer } from "./server.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2).filter((arg) => arg !== "--");
let target: string | undefined;
let port = 4317;
let openBrowser = true;

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--no-open") openBrowser = false;
  else if (arg === "--port") port = Number(args[++i]);
  else if (arg === "--help" || arg === "-h") {
    console.log("Pagecraft · Visual HTML editor\nnpm start -- [HTML file or folder] [--port 4317] [--no-open]\nWithout an argument, opens a local workspace in .pagecraft/.");
    process.exit(0);
  } else if (arg.startsWith("--")) throw new Error(`Unsupported option: ${arg}`);
  else if (target) throw new Error("Specify one HTML file or folder.");
  else target = resolve(arg);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be an integer from 0 to 65535.");

async function copyIfMissing(source: string, destination: string) {
  try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

let root: string;
let file: string | undefined;
if (target) {
  const info = await stat(target);
  root = info.isDirectory() ? target : dirname(target);
  if (!info.isDirectory()) {
    if (!/\.html?$/i.test(target)) throw new Error("Specify an .html or .htm file.");
    file = basename(target);
  }
} else {
  root = join(projectRoot, ".pagecraft");
  await mkdir(root, { recursive: true });
  file = "getting-started.html";
  await copyIfMissing(fileURLToPath(new URL("../fixtures/welcome.html", import.meta.url)), join(root, file));
}

const server = createHtmlEditorServer({ root });
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is in use. Try --port 4318.` : error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") return;
  const url = `http://127.0.0.1:${address.port}/${file ? `?file=${encodeURIComponent(file)}` : ""}`;
  console.log(`Pagecraft · HTML editor: ${url}
Save folder: ${root}
Stop: Ctrl+C`);
  if (openBrowser) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const child = spawn(command, [url], { stdio: "ignore", detached: true });
    child.on("error", () => console.log(`Open ${url} in your browser.`));
    child.unref();
  }
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.close(); server.closeAllConnections(); });
