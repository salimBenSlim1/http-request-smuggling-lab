# HTTP/1.1 Framing & Request Smuggling Lab

A self-contained, localhost-only lab I built to go past "I solved the PortSwigger
HTTP Request Smuggling labs" and actually trace, byte by byte, *why* those
attacks work: how two different HTTP components can parse the exact same
TCP stream into a different number of requests, and what that desync lets an
attacker do.

This isn't a scanner or an exploit tool. It's three small, incremental
environments, each one isolating a single idea:

| Lab | What it isolates | Core question it answers |
|---|---|---|
| [`01-content-length-framing`](01-content-length-framing) | A single HTTP/1.1 parser, one component | Where exactly does a parser decide a request "ends," and what happens when `Content-Length` lies about the body size? |
| [`02-desync-lab`](02-desync-lab) | Two components (proxy + backend) parsing the same bytes | What happens when the front end and back end *disagree* about framing — and what a trust boundary built on top of that disagreement looks like |
| [`03-otp-rate-limit-race`](03-otp-rate-limit-race) | Concurrency instead of framing | A different kind of HTTP-layer desync: a check-then-act rate limit raced with concurrent requests |

Background and a walkthrough of the PortSwigger labs that motivated this are in
[`docs/findings.md`](docs/findings.md).

## Why framing, not just "the labs"

HTTP/1.1 request smuggling exists because HTTP/1.1 has two independent,
historically-incompatible ways to say "the body ends here":
`Content-Length` (a byte count) and `Transfer-Encoding: chunked` (a
self-delimiting stream). When a request flows through a front-end proxy
and a back-end server, both have to agree on where one request stops and
the next begins — using the *same* bytes. If they don't (CL.TE, TE.CL,
TE.TE via header obfuscation), the front end and back end end up
splitting the TCP stream into a different number of HTTP messages. An
attacker can smuggle a prefix of their next request inside what the
front end thinks is the body of their current one, and have the back end
treat it as the start of someone else's request on the next connection.

Reading about that is one thing. This repo is me building the smallest
possible versions of "two components disagree" and "one component trusts
a header the other should have stripped," then watching the raw TCP bytes
to confirm the mental model is actually correct — not just quoting the
theory back.

## Running it

Each lab folder has its own README with exact run steps. Short version,
Node.js 18+ required:

```bash
# Lab 1 — single-parser framing
cd 01-content-length-framing
node server.js        # terminal 1
node client.js         # terminal 2

# Lab 2 — two-component desync (needs Postgres, see its README)
cd 02-desync-lab
node server-a/server.js    # terminal 1
node server-b/server.js    # terminal 2
node proxy/tcp-introspector.js   # terminal 3
node raw-client/client.js        # terminal 4

# Lab 3 — rate-limit race (targets lab 1's server, no DB needed)
cd 01-content-length-framing && node server.js   # terminal 1
cd 03-otp-rate-limit-race && node load-test-otp.js  # terminal 2
```

## Scope and disclaimer

Everything here runs against `127.0.0.1` only, against servers I wrote,
with fake credentials and fake data. Nothing targets a third party, and
nothing here is a general-purpose smuggling tool. The PortSwigger Web
Security Academy labs referenced in `docs/findings.md` are discussed at
the level of the underlying HTTP concept only — no lab URLs, lab
instance identifiers, or walkthrough steps that would substitute for
actually doing the labs.

## Repo layout

```
.
├── 01-content-length-framing/   # single HTTP/1.1 parser, CL mismatch
├── 02-desync-lab/                # proxy + 2 backends, desync + trust-boundary bug
├── 03-otp-rate-limit-race/       # TOCTOU race on a rate limiter
└── docs/
    └── findings.md               # write-up: concepts, PortSwigger context, findings
```

## License

MIT — see [`LICENSE`](LICENSE). Educational use; see disclaimer above.
