import gql from "graphql-tag";

export const typeDefs = gql`
  scalar JSON

  type Query {
    getPostDetails(postId: ID!): Post

    posts: [Post!]!

    notification(id: ID!): Notification

    notifications(limit: Int = 10, offset: Int = 0): [Notification!]!

    mySubscriptions: [PostCategory!]!

    unreadNotificationCount: Int!

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

    subscribeCategories(categories: [PostCategory!]!): Boolean!

    updateSubscriptions(categories: [PostCategory!]!): Boolean!

    unsubscribeCategory(category: PostCategory!): Boolean!

    markNotificationRead(notificationId: ID!): Boolean!

    markAllNotificationsRead: Boolean!
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

  type Notification {
    id: ID!
    userId: ID!
    postId: ID
    title: String!
    message: String!
    isRead: Boolean!
    createdAt: String!

    post: Post
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
