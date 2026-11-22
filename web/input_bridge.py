# SPDX-License-Identifier: GPL-3.0-or-later
"""Serve read-only Windows XInput snapshots to the local Node server over stdin/stdout."""

from __future__ import annotations

import json
import sys

from x20ctl.input import XInputReader
from x20ctl.protocol import Key


STANDARD_BUTTONS = (
    Key.A, Key.B, Key.X, Key.Y, Key.LB, Key.RB, Key.LT, Key.RT,
    Key.SELECT, Key.START, Key.L3, Key.R3, Key.DPAD_UP, Key.DPAD_DOWN,
    Key.DPAD_LEFT, Key.DPAD_RIGHT, Key.HOME,
)


def axis(value: int) -> float:
    return value / (32768 if value < 0 else 32767)


def snapshot(reader: XInputReader) -> dict:
    state = reader.poll()
    if state is None:
        return {"available": reader.available, "pads": []}

    triggers = {Key.LT: state.left_trigger / 255, Key.RT: state.right_trigger / 255}
    keys = STANDARD_BUTTONS if reader.reports_home else STANDARD_BUTTONS[:-1]
    buttons = [
        {"pressed": key in state.buttons, "value": triggers.get(key, int(key in state.buttons))}
        for key in keys
    ]
    lx, ly = state.left_stick
    rx, ry = state.right_stick
    return {"available": True, "pads": [{
        "index": state.slot,
        "id": f"XInput 手柄 {state.slot + 1}",
        "mapping": "standard",
        "buttons": buttons,
        "axes": [axis(lx), -axis(ly), axis(rx), -axis(ry)],
    }]}


def main() -> None:
    reader = XInputReader()
    for request in sys.stdin:
        if request.strip() == "state":
            print(json.dumps(snapshot(reader)), flush=True)


if __name__ == "__main__":
    main()
