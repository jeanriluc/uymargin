// Función de Vercel para /api/audits: reutiliza el app Express de server/app.ts (sin app.listen).
import app from "../server/app.js";

export default app;
