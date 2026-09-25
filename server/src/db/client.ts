import { PrismaClient } from "@prisma/client";

// Singleton — avoids exhausting SQLite connections under tsx's hot-reload in dev.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__prisma = prisma;
