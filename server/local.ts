import express from "express";
import path from "path";
import app, { HOST, PORT, isProduction } from "./app.js";

/**
 * Ejecución local: Vite en modo middleware (desarrollo) o dist/ (producción) + app.listen.
 * No se usa en Vercel: allí el frontend sale como estático y /api/* lo sirven las funciones de api/.
 */
async function startServer() {
  if (!isProduction) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    // Hashed build assets never change; index.html must always be revalidated.
    app.use(
      "/assets",
      express.static(path.join(distPath, "assets"), { immutable: true, maxAge: "1y" })
    );
    app.use(express.static(distPath, { setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") }));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`UyMargin server listening on ${HOST}:${PORT} (${isProduction ? "production" : "development"})`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
