# Lab 1 — Content-Length framing, single parser

The smallest possible environment for watching an HTTP/1.1 parser decide
where one request ends and the next begins.

- `server.js` — a tiny Express backend on `:3000`.
- `client.js` — opens one raw TCP socket and writes two concatenated
  HTTP/1.1 requests in a single `write()` call, where the first
  request's `Content-Length` doesn't match the body bytes:

  ```
  POST /one HTTP/1.1
  Host: localhost:3000
  Content-Length: 7

  HELLOGET /two HTTP/1.1
  Host: localhost:3000

  ```

  `Content-Length: 7` but `HELLO` is 5 bytes — the parser will keep
  reading 2 more bytes into what it thinks is request #1's body, which
  eats into the start of request #2's request line (`GE` gets consumed
  as body, leaving `T /two HTTP/1.1...` to be parsed as the next
  "request").

## Run

```bash
node server.js     # terminal 1
node client.js      # terminal 2
```

Watch the server's console output and the response(s) the client
receives — compare what actually happened to what you'd predict from
the request text above.

## Why this is *not* a smuggling vulnerability by itself

Node's `http` module (via Express) is the **only** parser in this lab.
`server.js` plays the role of both "front end" and "back end" — there's
no second component to disagree with it. A real CL.TE/TE.CL/TE.TE
smuggling bug requires **two** independent HTTP parsers in a chain that
make *different* decisions about the same bytes. This lab exists to
make the single-parser baseline concrete and observable before adding
a second component — see [`../02-desync-lab`](../02-desync-lab).

## HTTP/2 note

HTTP/2 doesn't use textual request-line/header framing at all — it uses
length-prefixed binary frames carried over explicit stream IDs, so
there's no `Content-Length`-vs-`Transfer-Encoding` ambiguity to exploit
the way HTTP/1.1 has it. Classic CL.TE-style smuggling is therefore not
directly applicable to HTTP/2-to-HTTP/2 connections. Where HTTP/2 does
show up in smuggling research is at **HTTP/2-to-HTTP/1.1 downgrade
gateways** (H2.CL / H2.TE), where the translation step back into
HTTP/1.1 framing can reintroduce the same class of ambiguity. That's a
different lab from this one — noted here as a boundary of what this
repo covers.
