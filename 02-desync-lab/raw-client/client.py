#!/usr/bin/env python3
"""
Python port of client.js.

Opens a raw TCP connection to the proxy in front of server-a/server-b
(tcp-introspector.js on :8080, or nginx on :8080) and sends one
ordinary HTTP/1.1 request, so you can watch it in the proxy's framing
log.

Usage:
    python3 client.py [--host 127.0.0.1] [--port 8080]
"""
import argparse
import socket

REQUEST = (
    "POST /inspect HTTP/1.1\r\n"
    "Host: 127.0.0.1\r\n"
    "Connection: keep-alive\r\n"
    "Content-Length: 5\r\n"
    "\r\n"
    "hello"
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    data = REQUEST.encode("latin1")

    print("SENDING:")
    print(repr(REQUEST))

    with socket.create_connection((args.host, args.port)) as sock:
        sock.sendall(data)

        print("\nSERVER SENT:")
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            print(chunk.decode("latin1"), end="")

    print("\nServer closed connection")


if __name__ == "__main__":
    main()
