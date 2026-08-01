import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

import { typeDefs } from "./schema.js";
import { resolvers } from "./resolvers.js";
import { runStartupMigrations } from "./db.js";

dotenv.config();

console.log("JWT_SECRET =", process.env.JWT_SECRET);

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
});

async function startServer() {
  try {
    // Run DB migrations
    await runStartupMigrations();

    // Start Apollo Server
    await startStandaloneServer(server, {
      listen: {
        port: 4002,
        host: "0.0.0.0",
      },

      context: async ({ req }) => {
        console.log("HEADERS:", req.headers);

        // ----------------------------
        // Case 1: Request comes from Gateway
        // ----------------------------
        const xUser = req.headers["x-user"];

        if (xUser) {
          try {
            const user = JSON.parse(xUser);

            console.log("Authenticated via Gateway:", user);

            return { user };
          } catch (err) {
            console.log("Invalid x-user header:", err.message);
          }
        }

        // ----------------------------
        // Case 2: Direct request to Posts Service
        // ----------------------------
        const authHeader = req.headers.authorization;

        if (!authHeader) {
          console.log("No Authorization header found");

          return {
            user: null,
          };
        }

        try {
          const token = authHeader.startsWith("Bearer ")
            ? authHeader.substring(7)
            : authHeader;

          const user = jwt.verify(token, process.env.JWT_SECRET);

          console.log("Authenticated via JWT:", user);

          return {
            user,
          };
        } catch (err) {
          console.log("JWT Verification Failed:", err.message);

          return {
            user: null,
          };
        }
      },
    });

    console.log("Posts Service running at http://0.0.0.0:4002/graphql");
  } catch (err) {
    console.error("Failed to start Posts Service:", err);
    process.exit(1);
  }
}

startServer();
