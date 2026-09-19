from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid4


@dataclass
class Session:
    """The complete in-memory session shape used by the service."""

    id: str = field(default_factory=lambda: str(uuid4()))
    role_arn: str | None = None
    region: str | None = None
    connected: bool = False
    active_branch: str | None = None
    history: list[dict] = field(default_factory=list)


_sessions: dict[str, Session] = {}


def create_session() -> Session:
    session = Session()
    _sessions[session.id] = session
    return session


def get_session(session_id: str) -> Session | None:
    return _sessions.get(session_id)


def ensure_session(session_id: str | None) -> Session:
    if session_id:
        existing = get_session(session_id)
        if existing is not None:
            return existing
    return create_session()
