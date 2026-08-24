from typing import Any

def _limit_from_raw(value: int) -> int | None:
    if value <= 0:
        return None
    return value

print(_limit_from_raw(100))
print(_limit_from_raw(0))
