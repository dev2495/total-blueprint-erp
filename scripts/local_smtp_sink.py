#!/usr/bin/env python3
"""
Isolated local SMTP sink for UI E2E runs.

Accepts mail on 127.0.0.1 only and writes each message to a file; nothing is
relayed anywhere. The test API is pointed here (EMAIL_PROVIDER=SMTP,
SMTP_HOST=127.0.0.1, SMTP_STARTTLS=false) so quotation sends exercise the real
delivery path without any external delivery.

Usage: python scripts/local_smtp_sink.py --port 8025 --out .runtime/ui-e2e/smtp-sink
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import pathlib


class SinkProtocol(asyncio.Protocol):
    def __init__(self, out_dir: pathlib.Path):
        self.out_dir = out_dir
        self.buffer = b""
        self.in_data = False
        self.data_lines: list[bytes] = []
        self.mail_from = ""
        self.rcpt_to: list[str] = []

    def connection_made(self, transport):
        self.transport = transport
        self._reply("220 local-smtp-sink ready")

    def _reply(self, line: str):
        self.transport.write((line + "\r\n").encode())

    def data_received(self, data: bytes):
        self.buffer += data
        while b"\r\n" in self.buffer:
            line, self.buffer = self.buffer.split(b"\r\n", 1)
            self._handle_line(line)

    def _handle_line(self, line: bytes):
        if self.in_data:
            if line == b".":
                self.in_data = False
                stamp = dt.datetime.now().strftime("%Y%m%dT%H%M%S%f")
                target = self.out_dir / f"{stamp}.eml"
                header = f"X-Sink-From: {self.mail_from}\r\nX-Sink-To: {', '.join(self.rcpt_to)}\r\n".encode()
                target.write_bytes(header + b"\r\n".join(self.data_lines))
                self.data_lines, self.rcpt_to = [], []
                self._reply("250 OK: stored")
            else:
                self.data_lines.append(line[1:] if line.startswith(b"..") else line)
            return
        command = line.decode(errors="replace").strip()
        upper = command.upper()
        if upper.startswith(("EHLO", "HELO")):
            self._reply("250 local-smtp-sink")
        elif upper.startswith("MAIL FROM"):
            self.mail_from = command.split(":", 1)[-1].strip()
            self._reply("250 OK")
        elif upper.startswith("RCPT TO"):
            self.rcpt_to.append(command.split(":", 1)[-1].strip())
            self._reply("250 OK")
        elif upper == "DATA":
            self.in_data = True
            self._reply("354 End data with <CR><LF>.<CR><LF>")
        elif upper in {"RSET", "NOOP"}:
            self._reply("250 OK")
        elif upper == "QUIT":
            self._reply("221 Bye")
            self.transport.close()
        else:
            self._reply("502 Command not implemented")


async def main(port: int, out_dir: pathlib.Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    loop = asyncio.get_running_loop()
    server = await loop.create_server(lambda: SinkProtocol(out_dir), "127.0.0.1", port)
    print(f"local-smtp-sink listening on 127.0.0.1:{port}, writing to {out_dir}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8025)
    parser.add_argument("--out", default=".runtime/ui-e2e/smtp-sink")
    args = parser.parse_args()
    asyncio.run(main(args.port, pathlib.Path(args.out)))
