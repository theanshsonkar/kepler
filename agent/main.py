from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import json
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agent_core import run_turn
from .session import create_session, get_session

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kepler.service")


class ChatRequest(BaseModel):
    model_config = {"extra": "forbid"}

    session_id: str
    message: str


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Kepler agent service started")
    yield


app = FastAPI(title="Kepler Agent Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/session")
def session() -> dict[str, str]:
    created = create_session()
    return {"session_id": created.id}


@app.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    current = get_session(request.session_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Session not found")
    current.history.append({"role": "user", "content": request.message})

    async def stream() -> AsyncIterator[str]:
        async for item in run_turn(request.message, current.id):
            yield f"data: {json.dumps(item, ensure_ascii=False, separators=(',', ':'))}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
