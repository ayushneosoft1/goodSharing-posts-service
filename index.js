import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { buildSubgraphSchema } from "@apollo/subgraph";

import { typeDefs } from "./schema.js";
import { resolvers } from "./resolvers.js";
import { runStartupMigrations } from "./db.js";

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
});

async function startServer() {
  await runStartupMigrations();

  await startStandaloneServer(server, {
    listen: { port: 4002, host: "0.0.0.0" },
    context: async ({ req }) => {
      console.log("HEADERS: ===============>", req.headers);
      const xUser = req.headers["x-user"];

      return {
        user: xUser ? JSON.parse(xUser) : null,
      };
    },
  });

  console.log("Posts Service running on http://0.0.0.0:4002/graphql");
}

startServer().catch((err) => {
  console.error("Failed to start Posts Service", err);
  process.exit(1);
});
