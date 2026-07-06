import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL!;

const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
