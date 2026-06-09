"""Compatibility shims for optional runtime dependencies.

The sandbox used for local verification does not ship with FastAPI or
Pydantic. These shims keep the modules importable and testable while the real
dependencies remain listed in ``backend/requirements.txt`` for production.
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from types import UnionType
from typing import Any, Callable, Union, get_args, get_origin, get_type_hints

try:
    from fastapi import APIRouter, FastAPI, HTTPException
    from fastapi.responses import JSONResponse, RedirectResponse
except ModuleNotFoundError:  # pragma: no cover - exercised indirectly in tests
    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: Any):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class APIRouter:
        def __init__(self, prefix: str = "", tags: list[str] | None = None):
            self.prefix = prefix
            self.tags = tags or []
            self.routes: list[dict[str, Any]] = []

        def _register(
            self, method: str, path: str, **metadata: Any
        ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
            def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
                self.routes.append(
                    {
                        "method": method,
                        "path": path,
                        "handler": func,
                        "metadata": metadata,
                    }
                )
                return func

            return decorator

        def get(
            self, path: str, **metadata: Any
        ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
            return self._register("GET", path, **metadata)

        def post(
            self, path: str, **metadata: Any
        ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
            return self._register("POST", path, **metadata)

        def include_router(self, router: "APIRouter") -> None:
            self.routes.extend(router.routes)

    class FastAPI:
        def __init__(self, title: str = "App"):
            self.title = title
            self.routers: list[APIRouter] = []

        def include_router(self, router: APIRouter) -> None:
            self.routers.append(router)

    class JSONResponse(dict):
        def __init__(self, *, content: Any, status_code: int = 200):
            super().__init__(content)
            self.content = content
            self.status_code = status_code

    class RedirectResponse:
        def __init__(self, url: str, status_code: int = 307):
            self.headers = {"location": url}
            self.status_code = status_code
            self.url = url


try:
    from pydantic import BaseModel, Field
except ModuleNotFoundError:  # pragma: no cover - exercised indirectly in tests
    class _FieldInfo:
        def __init__(
            self,
            default: Any = None,
            *,
            default_factory: Callable[[], Any] | None = None,
        ) -> None:
            self.default = default
            self.default_factory = default_factory

        def materialize(self) -> Any:
            if self.default_factory is not None:
                return self.default_factory()
            return self.default

    def Field(  # type: ignore[misc]
        default: Any = None, *, default_factory: Callable[[], Any] | None = None
    ) -> _FieldInfo:
        return _FieldInfo(default=default, default_factory=default_factory)

    def _coerce_value(annotation: Any, value: Any) -> Any:
        if value is None:
            return None

        origin = get_origin(annotation)
        args = get_args(annotation)

        if origin in {Union, UnionType} and args:
            for option in args:
                if option is type(None):
                    continue
                coerced = _coerce_value(option, value)
                if coerced is not None:
                    return coerced

        if origin is list and args:
            return [_coerce_value(args[0], item) for item in value]
        if origin is dict and len(args) == 2:
            return {
                _coerce_value(args[0], key): _coerce_value(args[1], item)
                for key, item in value.items()
            }
        if origin is tuple and args:
            return tuple(_coerce_value(args[0], item) for item in value)

        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            if isinstance(value, annotation):
                return value
            if isinstance(value, dict):
                return annotation(**value)

        return value

    def _serialize_value(value: Any) -> Any:
        if hasattr(value, "model_dump"):
            return value.model_dump()
        if is_dataclass(value):
            return asdict(value)
        if isinstance(value, list):
            return [_serialize_value(item) for item in value]
        if isinstance(value, tuple):
            return [_serialize_value(item) for item in value]
        if isinstance(value, dict):
            return {key: _serialize_value(item) for key, item in value.items()}
        return value

    class BaseModel:
        def __init__(self, **data: Any) -> None:
            annotations: dict[str, Any] = {}
            for cls in reversed(self.__class__.__mro__):
                annotations.update(get_type_hints(cls))

            for name, annotation in annotations.items():
                if name in data:
                    raw_value = data[name]
                else:
                    default = getattr(self.__class__, name, None)
                    raw_value = (
                        default.materialize()
                        if isinstance(default, _FieldInfo)
                        else default
                    )
                setattr(self, name, _coerce_value(annotation, raw_value))

            for key, value in data.items():
                if key not in annotations:
                    setattr(self, key, value)

        @classmethod
        def model_validate(cls, data: dict[str, Any]) -> "BaseModel":
            return cls(**data)

        def model_dump(self, **_: Any) -> dict[str, Any]:
            annotations: dict[str, Any] = {}
            for cls in reversed(self.__class__.__mro__):
                annotations.update(get_type_hints(cls))
            return {
                name: _serialize_value(getattr(self, name))
                for name in annotations
                if hasattr(self, name)
            }
