import { GraphQLClient, gql } from "graphql-request";

const client = new GraphQLClient(process.env.USER_SERVICE_URL, {
  headers: {
    "x-service-secret": process.env.INTERNAL_SERVICE_SECRET,
  },
});

const GET_PUSH_TOKENS = gql`
  query GetPushTokens($userIds: [ID!]!) {
    getPushTokens(userIds: $userIds) {
      userId
      pushToken
    }
  }
`;

export async function getPushTokens(userIds) {
  const data = await client.request(GET_PUSH_TOKENS, {
    userIds,
  });

  return data.getPushTokens;
}
