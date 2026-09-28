"""Fetches each feed on its own interval, in the app's own event loop.

A feed is a name, an interval and an async `run(client, store)` that writes
its snapshot. A failure is logged and recorded in the status, and the last
good snapshot stays up. Status survives restarts in `status.json`.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

from gaia import __version__
from gaia.store import Store

log = logging.getLogger("gaia.scheduler")

USER_AGENT = f"Gaia/{__version__} (+https://github.com/superthom196/gaia)"


@dataclass(frozen=True)
class Feed:
    name: str
    interval: float  # seconds
    run: Callable[[httpx.AsyncClient, Store], Awaitable[None]]
    source: str  # who publishes it, for the status and credits
    timeout: float = 120


class Scheduler:
    def __init__(self, store: Store, feeds: list[Feed]):
        self.store = store
        self.feeds = feeds
        self.status: dict[str, dict] = store.read_json("status.json", {}) or {}
        self._tasks: list[asyncio.Task] = []
        self._client: httpx.AsyncClient | None = None

    async def start(self) -> None:
        self._client = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
            timeout=60,
            transport=httpx.AsyncHTTPTransport(retries=3),
        )
        for feed in self.feeds:
            self._tasks.append(asyncio.create_task(self._loop(feed), name=f"feed:{feed.name}"))

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        if self._client:
            await self._client.aclose()

    async def _loop(self, feed: Feed) -> None:
        # After a restart, wait out whatever is left of the interval rather
        # than hitting every source at once.
        last = self.status.get(feed.name, {}).get("last_success")
        if last:
            await asyncio.sleep(max(0.0, last + feed.interval - time.time()))
        failures = 0
        while True:
            ok = await self.run_once(feed)
            failures = 0 if ok else failures + 1
            # Downloads on some boxes drop now and then: after a failure, try
            # again in a minute, backing off, and never later than usual.
            wait = feed.interval if ok else min(feed.interval, 60 * 2 ** (failures - 1))
            await asyncio.sleep(wait)

    async def run_once(self, feed: Feed) -> bool:
        assert self._client is not None
        entry = self.status.setdefault(feed.name, {})
        entry.update(source=feed.source, interval=feed.interval, last_attempt=time.time())
        try:
            await asyncio.wait_for(feed.run(self._client, self.store), feed.timeout)
        except Exception as exc:  # any failure keeps the last snapshot
            log.warning("feed %s failed: %s", feed.name, exc)
            entry["error"] = f"{type(exc).__name__}: {exc}"[:300]
            ok = False
        else:
            entry["last_success"] = time.time()
            entry.pop("error", None)
            ok = True
        self.store.write_json("status.json", self.status)
        return ok

    def report(self) -> list[dict]:
        now = time.time()
        out = []
        for feed in self.feeds:
            entry = self.status.get(feed.name, {})
            last = entry.get("last_success")
            age = now - last if last else None
            out.append(
                {
                    "name": feed.name,
                    "source": feed.source,
                    "interval": feed.interval,
                    "last_success": last,
                    "age": age,
                    # Late means two intervals have passed without a good fetch.
                    "ok": age is not None and age < 2 * feed.interval + 60,
                    "error": entry.get("error"),
                }
            )
        return out
