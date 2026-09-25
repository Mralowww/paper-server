"""Lets the web thread hand work to the Discord bot's event loop."""
import asyncio

bot = None  # set by mctl.bot when the bot starts


def running():
    return bot is not None and bot.is_ready()


def submit(coro_fn, *args):
    """Schedules bot coroutine `coro_fn(*args)` without waiting; skipped when the bot is offline."""
    if not running():
        return False
    asyncio.run_coroutine_threadsafe(coro_fn(*args), bot.loop)
    return True


def call(coro_fn, *args, timeout=20):
    """Runs a bot coroutine and waits for its result. Raises RuntimeError when the bot is offline."""
    if not running():
        raise RuntimeError("bot_offline")
    return asyncio.run_coroutine_threadsafe(coro_fn(*args), bot.loop).result(timeout=timeout)
