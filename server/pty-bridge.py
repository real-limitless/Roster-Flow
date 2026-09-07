#!/usr/bin/env python3
"""Allocate a real PTY and exec argv. stdin/stdout are the slave; fd 3 is JSON resize lines."""
import fcntl
import json
import os
import pty
import select
import struct
import sys
import termios

cmd = sys.argv[1:]
if not cmd:
    sys.stderr.write("usage: pty-bridge.py <command> [args...]\n")
    sys.exit(2)

cols = int(os.environ.get("PTY_COLS", "80"))
rows = int(os.environ.get("PTY_ROWS", "24"))


def winsize(fd, r, c):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", max(1, r), max(2, c), 0, 0))


pid, master = pty.fork()
if pid == 0:
    os.environ.setdefault("TERM", "xterm-256color")
    os.execvpe(cmd[0], cmd, os.environ)

winsize(master, rows, cols)
ctrl = 3 if os.environ.get("PTY_CTRL_FD") == "3" else None
if ctrl is not None:
    try:
        os.fstat(ctrl)
    except OSError:
        ctrl = None

stdin = sys.stdin.fileno()
stdout = sys.stdout.fileno()
buf = b""
stdin_open = True

try:
    while True:
        fds = [master]
        if stdin_open:
            fds.append(stdin)
        if ctrl is not None:
            fds.append(ctrl)
        readable, _, _ = select.select(fds, [], [], 0.5)
        try:
            dead, status = os.waitpid(pid, os.WNOHANG)
            if dead:
                break
        except ChildProcessError:
            break
        if stdin_open and stdin in readable:
            data = os.read(stdin, 4096)
            if not data:
                stdin_open = False
                continue
            os.write(master, data)
        if master in readable:
            try:
                data = os.read(master, 4096)
            except OSError:
                break
            if not data:
                break
            os.write(stdout, data)
        if ctrl is not None and ctrl in readable:
            chunk = os.read(ctrl, 4096)
            if not chunk:
                ctrl = None
                continue
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    continue
                if msg.get("type") == "resize":
                    winsize(master, int(msg.get("rows") or rows), int(msg.get("cols") or cols))
finally:
    try:
        os.close(master)
    except OSError:
        pass
    try:
        os.waitpid(pid, 0)
    except (ChildProcessError, OSError):
        pass
