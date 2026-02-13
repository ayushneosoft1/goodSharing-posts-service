import Redis from "ioredis";

console.log("Redis host:", process.env.REDIS_HOST);
console.log("Redis port:", process.env.REDIS_PORT);

export const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  connectTimeout: 10000,
});

redis.on("connect", () => {
  console.log(" Connected to Dragonfly");
});

redis.on("error", (err) => {
  console.error(" Dragonfly error:", err);
});

redis.on("connect", async () => {
  console.log("Connected to Redis (post service)");

  const pong = await redis.ping();
  console.log("Redis PING:", pong);
});
