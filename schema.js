import gql from "graphql-tag";

export const typeDefs = gql`
  scalar JSON

  type Query {
    getPostDetails(postId: ID!): Post

    posts: [Post!]!

    testPostCache(postId: ID!): CacheDebug
  }

  type Mutation {
    createPost(
      title: String!
      category: PostCategory!
      description: String!
      imageUrl: String
      location: String
    ): Post!
  }

  type Post @key(fields: "id") {
    id: ID!
    title: String!
    category: PostCategory!
    description: String!
    imageUrl: String
    location: String
    isDeleted: Boolean!
    createdAt: String!
    updatedAt: String!

    owner: User
  }

  extend type User @key(fields: "id") {
    id: ID! @external
  }

  type CacheDebug {
    cacheKey: String!
    ttl: Int!
    cachedData: JSON
  }

  enum PostCategory {
    BOOK
    CLOTH
    ELECTRONIC
    TOYS
  }
`;
