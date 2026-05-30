import mongoose from "mongoose";
import logger from "../utils/logger.js";

let mongooseConnected = false;
let listenersBound = false;

const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectToDatabase(): Promise<boolean> {
  if (mongooseConnected) {
    logger.info("Mongoose connection already established.");
    return true;
  }

  if (!process.env.MONGODB_URI) {
    logger.warn(
      "MONGODB_URI is not defined. Skipping Mongoose database connection.",
    );
    return false;
  }

  if (!listenersBound) {
    // Mongoose's native auto-reconnect handles drops on an established connection.
    // Bind listeners once so they survive across the cold-start retry loop below.
    mongoose.connection.on("error", (err: Error) => {
      logger.error("Mongoose connection error:", err);
      mongooseConnected = false;
    });
    mongoose.connection.on("disconnected", () => {
      logger.warn("Mongoose connection disconnected.");
      mongooseConnected = false;
    });
    mongoose.connection.on("reconnected", () => {
      logger.info("Mongoose connection reconnected.");
      mongooseConnected = true;
    });
    listenersBound = true;
  }

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      logger.info(
        `Attempting to connect to MongoDB via Mongoose${attempt > 0 ? ` (retry ${attempt}/${RETRY_DELAYS_MS.length})` : ""}...`,
      );
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 20,
        minPoolSize: 2,
        appName: "cfg-bot",
        compressors: "zstd",
        retryWrites: true,
      });
      mongooseConnected = true;
      logger.info("Successfully connected to MongoDB via Mongoose.");
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`MongoDB connect attempt ${attempt + 1} failed: ${msg}`);
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) {
        logger.info(`Retrying MongoDB connect in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  mongooseConnected = false;
  return false;
}

export function isMongooseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function closeDatabaseConnection(): Promise<void> {
  if (
    mongoose.connection.readyState !== 0 &&
    mongoose.connection.readyState !== 3
  ) {
    try {
      await mongoose.disconnect();
      logger.info("Mongoose connection closed successfully.");
      mongooseConnected = false;
    } catch (error) {
      logger.error("Error closing Mongoose connection:", error);
    }
  }
}
