#!/usr/bin/env python3
"""
Python port of client.js.

Opens one raw TCP socket to the lab server and writes two concatenated
HTTP/1.1 requests in a single send(), where the first request's
Content-Length doesn't match the body bytes that actually follow it.
See ./README.md for what this demonstrates and why it's a single-parser
baseline, not a smuggling vulnerability by itself.

Usage:
    python3 client.py [--host 127.0.0.1] [--port 3000]
"""
import argparse
import socket

REQUEST = (
    "POST /one HTTP/1.1\r\n"
    "Host: localhost:3000\r\n"
    "Content-Length: 7\r\n"
    "\r\n"
    "HELLO"
    "GET /two HTTP/1.1\r\n"
    "Host: localhost:3000\r\n"
    "\r\n"
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()

    with socket.create_connection((args.host, args.port)) as sock:
        sock.sendall(REQUEST.encode("latin1"))
        sock.shutdown(socket.SHUT_WR)

        print("SERVER RESPONSE:")
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            print(chunk.decode("latin1"), end="")

    print("\nConnection closed")


if __name__ == "__main__":
    main()
