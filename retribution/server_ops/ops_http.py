"""
OpsHTTPServer: HTTP Static File Server (aiohttp) for Retribution: Engine Ops.
Serves engine_ops/ HTML/CSS/JS frontend assets on port 3001.
"""

import logging
from aiohttp import web
from .config import ENGINE_OPS_DIR

logger = logging.getLogger("OpsHTTPServer")


def create_ops_http_app() -> web.Application:
    """Configure aiohttp application with static routes and CORS headers."""
    app = web.Application()

    @web.middleware
    async def cors_middleware(request, handler):
        response = await handler(request)
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = '*'
        return response

    app.middlewares.append(cors_middleware)

    # Root route -> index.html
    async def index_handler(request):
        index_file = ENGINE_OPS_DIR / "index.html"
        if index_file.exists():
            return web.FileResponse(index_file)
        return web.Response(text="Engine Ops index.html not found.", status=404)

    app.router.add_get('/', index_handler)

    # Static assets (css, js, assets, tests)
    if ENGINE_OPS_DIR.exists():
        app.router.add_static('/engine_ops/', path=str(ENGINE_OPS_DIR), show_index=True)
        if (ENGINE_OPS_DIR / "css").exists():
            app.router.add_static('/css/', path=str(ENGINE_OPS_DIR / "css"))
        if (ENGINE_OPS_DIR / "js").exists():
            app.router.add_static('/js/', path=str(ENGINE_OPS_DIR / "js"))
        if (ENGINE_OPS_DIR / "assets").exists():
            app.router.add_static('/assets/', path=str(ENGINE_OPS_DIR / "assets"))

    return app


async def start_ops_http_server(host: str = "0.0.0.0", port: int = 3001):
    """Start asynchronous static server."""
    app = create_ops_http_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    logger.info(f"Engine Ops HTTP server running at http://localhost:{port}")
    return runner
