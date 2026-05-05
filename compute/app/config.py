"""Runtime configuration loaded from environment variables.

All settings are pydantic-validated; missing required values fail fast at boot.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- Chain ---------------------------------------------------------------
    rpc_url: str = Field(default="http://127.0.0.1:8545", alias="RPC_URL")
    contract_address: str = Field(default="0x0000000000000000000000000000000000000000", alias="CONTRACT_ADDRESS")
    chain_id: int = Field(default=11155111, alias="CHAIN_ID")  # Sepolia

    # ---- Storage -------------------------------------------------------------
    ipfs_gateway: str = Field(
        default="https://gateway.pinata.cloud/ipfs/",
        alias="IPFS_GATEWAY",
    )

    # ---- LLM -----------------------------------------------------------------
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    llm_backend: Literal["openai", "local"] = Field(default="openai", alias="LLM_BACKEND")
    llm_model: str = Field(default="gpt-4o-mini", alias="LLM_MODEL")

    # ---- GPU -----------------------------------------------------------------
    gpu_device: str = Field(default="cuda:0", alias="GPU_DEVICE")

    # ---- Auth ----------------------------------------------------------------
    jwt_secret: str = Field(default="dev-only-do-not-use-in-prod", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")

    # ---- Cache ---------------------------------------------------------------
    cache_dir: Path = Field(default=Path("./persona_cache"), alias="CACHE_DIR")
    cache_ttl_seconds: int = Field(default=300, alias="CACHE_TTL_SECONDS")
    cache_max_personas: int = Field(default=8, alias="CACHE_MAX_PERSONAS")

    # ---- HTTP / CORS ---------------------------------------------------------
    backend_url: str = Field(default="http://localhost:4000", alias="BACKEND_URL")
    frontend_url: str = Field(default="http://localhost:3000", alias="FRONTEND_URL")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
