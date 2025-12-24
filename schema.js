import gql from "graphql-tag";

export const typeDefs = gql`
  type Query {
    # Query API 1
    getPostDetails(postId: ID!): Post
  }

  type Mutation {
    # Mutation API 1
    createPost(
      title: String!
      category: PostCategory!
      description: String!
    ): Post
  }

  type Post @key(fields: "id") {
    id: ID!
    title: String!
    category: PostCategory!
    description: String!
    isDeleted: Boolean!
    createdAt: String!
    updatedAt: String!
    user: User!
  }

  extend type User @key(fields: "id") {
    id: ID! @external
  }

  enum PostCategory {
    BOOK
    CLOTH
    ELECTRONIC
    TOYS
  }
`;
