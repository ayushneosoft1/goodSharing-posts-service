import gql from "graphql-tag";

export const typeDefs = gql`
  enum PostCategory {
    BOOK
    CLOTH
    ELECTRONIC
    TOYS
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

  type Query {
    getPostDetails(postId: ID!): Post
  }

  type Mutation {
    createPost(
      title: String!
      category: PostCategory!
      description: String!
    ): Post
  }
`;
