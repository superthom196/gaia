"""Entry point for uvicorn: `uvicorn gaia.asgi:app`."""

import logging

from gaia.app import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = create_app()
