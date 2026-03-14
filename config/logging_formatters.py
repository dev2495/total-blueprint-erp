import json
import logging
from datetime import datetime, timezone

from .request_context import get_request_context


class JsonFormatter(logging.Formatter):
    """Structured JSON logs with request context."""

    def format(self, record):
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update(get_request_context())

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=True)
