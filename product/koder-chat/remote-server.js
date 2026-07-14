// Koder Remote Access — LAN mobile view into agent progress (view-only, v1).
// Plain Node `http`, zero new dependencies. Off by default: nothing in this
// file runs any network code until `start()` is called explicitly, which
// only happens from the "Koder: Enable Remote Access" command.
//
// Design + security rationale in full: docs/research/10-remote-control.md.
// This module deliberately does NOT `require("vscode")` — it depends only on
// a small adapter object (`{ getSnapshot }`) so it can be started, driven,
// and torn down in a plain node:test process without the extension host.
// extension.js supplies that adapter and owns the one narrow integration
// point: AgentViewProvider.post() calls `this.remote?.broadcast(msg)`.
//
// Security model (see doc §2.3, §3 for the full accounting):
//  - Off by default; a session-lifetime random token; no disk persistence.
//  - Host-header validated on every request — rejects anything not addressed
//    to exactly the LAN ip:port this server bound to (the concrete mitigation
//    for the 0.0.0.0-day / DNS-rebinding class of attack, doc §1.2).
//  - Token compared with a constant-time comparison.
//  - View-only: no route in this file can mutate agent/session state. There
//    is no POST handler at all.
"use strict";

const http = require("http");
const crypto = require("crypto");
const os = require("os");
const { renderMobilePage } = require("./remote-page.js");

const DEFAULT_BASE_PORT = 47820;
const PORT_SCAN_ATTEMPTS = 20;

/** First non-internal IPv4 LAN address, or null if there isn't one (e.g. offline). */
function lanAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

class RemoteServer {
  /** @param {{ getSnapshot: () => { workspace: string, mode: string, transcript: any[] } }} adapter */
  constructor(adapter) {
    this.adapter = adapter;
    this.server = null;
    this.token = null;
    this.port = null;
    this.host = null; // "<lan-ip>:<port>" — the exact value we validate the Host header against
    this.clients = new Set(); // open SSE response objects
    this.connectionSeen = false;
  }

  get isRunning() {
    return this.server != null;
  }

  /** Starts listening on the LAN interface; resolves with pairing info. Throws if no LAN interface is up. */
  start(basePort = DEFAULT_BASE_PORT) {
    if (this.server) return Promise.resolve(this.info());
    const ip = lanAddress();
    if (!ip) {
      return Promise.reject(new Error("No LAN network interface found — connect to WiFi or Ethernet first."));
    }
    this.token = crypto.randomBytes(16).toString("hex");
    this.connectionSeen = false;
    return this._listen(ip, basePort).then(() => this.info());
  }

  // Sets this.server/this.port/this.host synchronously inside the listen
  // callback (not in a later .then()) so there is no window, however small,
  // between "accepting connections" and "Host-header validation has the
  // right value to check against."
  _listen(ip, basePort) {
    return new Promise((resolve, reject) => {
      const tryPort = (p, attemptsLeft) => {
        const server = http.createServer((req, res) => this._handle(req, res));
        server.once("error", (err) => {
          if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
            tryPort(p + 1, attemptsLeft - 1);
          } else {
            reject(err);
          }
        });
        server.listen(p, ip, () => {
          this.server = server;
          this.port = p;
          this.host = `${ip}:${p}`;
          resolve(p);
        });
      };
      tryPort(basePort, PORT_SCAN_ATTEMPTS);
    });
  }

  /** Pairing info for the QR/URL display. `url` is null if not running. */
  info() {
    return {
      running: this.isRunning,
      host: this.host,
      port: this.port,
      token: this.token,
      url: this.isRunning ? `http://${this.host}/?token=${this.token}` : null,
    };
  }

  /** Stops the server, closes all open SSE connections, and invalidates the token (no rotation/persistence). */
  stop() {
    for (const res of this.clients) {
      try { res.end(); } catch {}
    }
    this.clients.clear();
    if (this.server) {
      try { this.server.close(); } catch {}
      this.server = null;
    }
    this.token = null;
    this.port = null;
    this.host = null;
  }

  /** Fan out one transcript/control event to every connected phone. No-op if nobody's listening. */
  broadcast(msg) {
    if (!this.clients.size) return;
    const frame = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of this.clients) {
      try { res.write(frame); } catch { this.clients.delete(res); }
    }
  }

  _timingSafeTokenMatch(candidate) {
    if (!candidate || !this.token) return false;
    const a = Buffer.from(String(candidate));
    const b = Buffer.from(this.token);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Reject anything whose Host header isn't exactly the LAN ip:port we bound
   * to. This is the concrete mitigation named in doc §1.2/§3 for the
   * 0.0.0.0-day / DNS-rebinding class: a browser tab elsewhere on the LAN (or
   * on the same machine) that tries to reach this server by IP/0.0.0.0/a
   * rebound hostname sends a Host header that won't match, and gets a 400
   * before any handler runs.
   */
  _validHost(req) {
    return req.headers.host === this.host;
  }

  _handle(req, res) {
    this.connectionSeen = true;
    let url;
    try {
      url = new URL(req.url, `http://${this.host}`);
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }

    if (!this._validHost(req)) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("bad host");
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405).end("method not allowed");
      return;
    }

    if (url.pathname === "/") return this._serveIndex(res);
    if (url.pathname === "/state") return this._serveState(url, res);
    if (url.pathname === "/events") return this._serveEvents(url, req, res);
    res.writeHead(404).end("not found");
  }

  _serveIndex(res) {
    // The page shell carries no chat data — it does its own token check via
    // JS before it ever calls /state or /events, which are the routes that
    // actually gate on the token. Handing out the empty shell without a
    // token is equivalent to what a plain "view source" on the QR would show.
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderMobilePage());
  }

  _serveState(url, res) {
    if (!this._timingSafeTokenMatch(url.searchParams.get("token"))) {
      res.writeHead(401, { "Content-Type": "text/plain" }).end("unauthorized");
      return;
    }
    const snap = this.adapter.getSnapshot();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(snap));
  }

  _serveEvents(url, req, res) {
    if (!this._timingSafeTokenMatch(url.searchParams.get("token"))) {
      res.writeHead(401, { "Content-Type": "text/plain" }).end("unauthorized");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write(":connected\n\n");
    this.clients.add(res);
    req.on("close", () => this.clients.delete(res));
  }
}

module.exports = { RemoteServer, lanAddress };
