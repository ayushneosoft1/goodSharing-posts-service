import gql from "graphql-tag";

export const typeDefs = gql`
  type Query {
    # Existing
    getPostDetails(postId: ID!): Post

    #  New Query
    posts: [Post!]!
  }

  type Mutation {
    createPost(
      title: String!
      category: PostCategory!
      description: String!
      imageUrl: String
      location: String
    ): Post
  }

  type Post @key(fields: "id") {
    id: ID!
    title: String!
    category: PostCategory!
    description: String!
    imageUrl: String # camelCase to match resolver: imageUrl: post.image_url
    location: String
    isDeleted: Boolean!
    createdAt: String!
    updatedAt: String!
    owner: User # references user_id in DB
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
