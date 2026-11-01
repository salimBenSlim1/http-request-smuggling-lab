# Lab 2 — Two-component desync + a realistic trust-boundary bug

Two independent HTTP backends behind two different "front door" options
— a raw TCP introspection proxy (for watching framing decisions byte by
byte) and an `nginx` config (for a realistic deployment shape) — so the
same request stream can be observed going through **two** parsers
instead of one, which is the minimum needed for an actual desync.

## Layout

```
02-desync-lab/
├── server-a/server.js          # backend instance A (:3001)
├── server-b/server.js          # backend instance B (:3002)
├── proxy/tcp-introspector.js   # raw TCP proxy, logs byte-level framing decisions (:8080 -> :3001)
├── proxy/nginx.conf            # nginx reverse proxy, round-robins A/B (see finding below)
├── raw-client/client.js        # sends one raw HTTP/1.1 request over a plain TCP socket
└── db/init.sql                 # Postgres schema + seed user for server-a/server-b
```

`server-a` and `server-b` are intentionally near-identical — the point
is to have two real, separately-running backend processes that a load
balancer can round-robin between, since smuggling payloads landing on
the "wrong" backend in a pool is part of what makes the bug exploitable
in production, not just a local curiosity.

## Setup

Requires Node.js 18+ and a local Postgres instance.

```bash
# 1. Create the database and schema
createdb labdb
psql -d labdb -f db/init.sql

# 2. Point each backend at it (defaults match db/init.sql's seed data)
cp .env.example .env
export $(cat .env | xargs)

# 3. Install deps for each backend
(cd server-a && npm install)
(cd server-b && npm install)
```

Seed user: `salim` / `correct-password`, OTP `739421`.

## Run

```bash
node server-a/server.js            # terminal 1, :3001
node server-b/server.js            # terminal 2, :3002
node proxy/tcp-introspector.js     # terminal 3, :8080 -> :3001
node raw-client/client.js          # terminal 4, sends one request through the proxy
```

`tcp-introspector.js` logs, for every TCP chunk it sees: the raw bytes,
where it believes the header block ends, the declared `Content-Length`,
and the byte offset it computed for "this request ends here" —
including when bytes are left over after one complete request, which is
the signal that a second message starts mid-stream.

To instead see the `nginx`-fronted, round-robin version:

```bash
nginx -c "$(pwd)/proxy/nginx.conf"
```

(nginx must be installed separately; the config expects the backends
reachable at `host.docker.internal:3001` / `:3002` if you're running
nginx in Docker, or adjust the `upstream` block to `127.0.0.1` if
running nginx natively.)

## Finding: the proxy forwards a header the backend blindly trusts

`server-a` and `server-b` both skip authentication entirely when
`X-Internal-Admin: true` is present, on the assumption that only a
trusted internal caller can set that header. `proxy/nginx.conf`
forwards whatever the *client* sent in that header
(`$http_x_internal_admin`) rather than setting a fixed, trusted value —
so any external caller can set it directly:

```bash
curl -H "X-Internal-Admin: true" http://127.0.0.1:8080/admin
```

No smuggling or desync required for this one — a single ordinary
request is enough. It's included here because it's the same root cause
(a header trust boundary nobody actually enforces end-to-end) that
smuggling is so often used to abuse in real pipelines. Full write-up in
[`../docs/findings.md`](../docs/findings.md).

## Scope note

As shipped, both backends use the same framing rules (standard Node
`http`/Express parsing), so this lab's two backends alone won't
reproduce a genuine CL.TE/TE.CL desync — see
[`../docs/findings.md`](../docs/findings.md) for what a true
disagreement would need and what's on my list to add.
