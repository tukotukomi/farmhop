// Farm Hop jam relay (Cloudflare Worker + Durable Object).
//
// The game on a TV or computer is the "host" of a room; up to four phones join it
// as "player"s by scanning the QR code on the Jam Stage. The relay only passes text
// messages between them. It never stores or logs what they say.
//
//   wss://<worker>/room/<roomId>?role=host
//   wss://<worker>/room/<roomId>?role=player&pid=<random id the phone keeps>
//
// Each player gets a slot, 1 to 4. A phone that reconnects with the same pid gets
// its old slot back.
//   - A player's message reaches the host as {"t":"from","p":<slot>,"m":"<message>"}.
//   - The host sends "<slot>|<message>" to one player, or "*|<message>" to all.
//   - Both sides get {"t":"sys", ...} notes when someone joins or leaves.
// Messages are size- and rate-capped, and only the origins below may connect.

const ALLOWED_ORIGINS = [
  "https://www.tuckermills.com",
  "https://tuckermills.com",
  // Local development / testing only -- safe to remove for production.
  "http://localhost:5500",
  "http://localhost:5501",
];

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
const PID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SLOTS = 4;
const MAX_HOST_MESSAGE = 16384;
const MAX_PLAYER_MESSAGE = 1024; // players only send small commands (a note, a drum hit)
const MAX_MESSAGES_PER_SECOND = { host: 120, player: 60 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!match) return new Response("Farm Hop relay", { status: 200 });

    const origin = request.headers.get("Origin");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    if (!ROOM_ID_PATTERN.test(match[1])) return new Response("Bad room id", { status: 400 });
    const role = url.searchParams.get("role");
    if (role !== "host" && role !== "player") return new Response("Bad role", { status: 400 });
    if (role === "player" && !PID_PATTERN.test(url.searchParams.get("pid") || "")) {
      return new Response("Bad player id", { status: 400 });
    }
    return env.ROOM.get(env.ROOM.idFromName(match[1])).fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    // Answered without waking the object: both sides send "ping" every ~25s.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.recent = new WeakMap(); // per-socket message times, for the rate cap
  }

  send(ws, obj) {
    try {
      ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
    } catch (e) {}
  }

  hosts() {
    return this.state.getWebSockets("host");
  }

  // Slot number (1-4) for each player socket, from its tags.
  slotOf(ws) {
    const tag = this.state.getTags(ws).find((t) => /^p\d$/.test(t));
    return tag ? +tag.slice(1) : 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === "host") {
      for (const old of this.hosts()) {
        try {
          old.close(4000, "replaced");
        } catch (e) {}
      }
      this.state.acceptWebSocket(server, ["host"]);
      const players = [];
      for (let p = 1; p <= SLOTS; p++) if (this.state.getWebSockets("p" + p).length) players.push(p);
      this.send(server, { t: "sys", ev: "welcome", role: "host", players });
      for (let p = 1; p <= SLOTS; p++) {
        for (const ws of this.state.getWebSockets("p" + p)) this.send(ws, { t: "sys", ev: "peer-joined", role: "host" });
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    // A player: the same phone gets its old slot back; otherwise the first free one.
    const pid = url.searchParams.get("pid");
    let slot = 0;
    for (const old of this.state.getWebSockets("pid:" + pid)) {
      slot = this.slotOf(old);
      try {
        old.close(4000, "replaced");
      } catch (e) {}
    }
    if (!slot) {
      for (let p = 1; p <= SLOTS && !slot; p++) if (!this.state.getWebSockets("p" + p).length) slot = p;
    }
    if (!slot) {
      server.accept();
      this.send(server, { t: "sys", ev: "full" });
      server.close(4001, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }
    this.state.acceptWebSocket(server, ["player", "p" + slot, "pid:" + pid]);
    this.send(server, { t: "sys", ev: "welcome", role: "player", p: slot, host: this.hosts().length > 0 });
    for (const h of this.hosts()) this.send(h, { t: "sys", ev: "peer-joined", role: "player", p: slot });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string") return; // text only
    const role = this.state.getTags(ws)[0];
    if (message.length > (role === "host" ? MAX_HOST_MESSAGE : MAX_PLAYER_MESSAGE)) {
      ws.close(1009, "message too large");
      return;
    }
    const now = Date.now();
    const stamps = (this.recent.get(ws) || []).filter((t) => now - t < 1000);
    if (stamps.length >= MAX_MESSAGES_PER_SECOND[role]) {
      ws.close(1008, "rate limit");
      return;
    }
    stamps.push(now);
    this.recent.set(ws, stamps);

    if (role === "host") {
      const bar = message.indexOf("|");
      if (bar < 1) return;
      const to = message.slice(0, bar), body = message.slice(bar + 1);
      const targets = to === "*" ? this.state.getWebSockets("player") : this.state.getWebSockets("p" + to);
      for (const p of targets) this.send(p, body);
    } else {
      const wrapped = '{"t":"from","p":' + this.slotOf(ws) + ',"m":' + JSON.stringify(message) + "}";
      for (const h of this.hosts()) this.send(h, wrapped);
    }
  }

  webSocketClose(ws) {
    this.left(ws);
  }

  webSocketError(ws) {
    this.left(ws);
  }

  left(ws) {
    const tags = this.state.getTags(ws);
    if (!tags.length) return;
    if (tags[0] === "host") {
      if (this.hosts().some((h) => h !== ws)) return; // replaced by its own reconnect
      for (const p of this.state.getWebSockets("player")) if (p !== ws) this.send(p, { t: "sys", ev: "peer-left", role: "host" });
    } else {
      const slot = this.slotOf(ws);
      // Only a real leave: a phone replaced by its own reconnect is still in its slot.
      const still = this.state.getWebSockets("p" + slot).some((p) => p !== ws);
      if (!still) for (const h of this.hosts()) this.send(h, { t: "sys", ev: "peer-left", role: "player", p: slot });
    }
    try {
      ws.close();
    } catch (e) {}
  }
}
