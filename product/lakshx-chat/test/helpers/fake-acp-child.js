#!/usr/bin/env node
// Tiny scripted ndjson JSON-RPC "agent runtime" for acp-client.test.js.
// Reads one JSON-RPC message per line from stdin, dispatches on `method`:
//   - "quick"  -> responds immediately with { echoed: params }
//   - "hang"   -> never responds (simulates a wedged runtime process — the
//                 exact failure mode AcpClient.request()'s timeout exists
//                 to recover from)
//   - "notify" (no id) -> ignored, just like a real fire-and-forget notify
// Anything else gets a JSON-RPC error response so a mistyped method name
// fails loudly in a test rather than hanging silently.
"use strict";

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === undefined) continue; // notification, nothing to respond to
    if (msg.method === "quick") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echoed: msg.params } }) + "\n");
    } else if (msg.method === "hang") {
      // deliberately never respond
    } else {
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { message: `unknown method ${msg.method}` } }) + "\n",
      );
    }
  }
});
