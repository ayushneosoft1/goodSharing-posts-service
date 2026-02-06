This is posts service.

The post domain is a domain speific microservice in a federated graphql architecture whose sole responsibility is to manage posts. It owns the Post entity,stores post data in PostgreSQL,and links each post to a user without owing or storing user data.

The service runs an Apollo Server configured as a Federated Subgraph,meaning it does not expose a complete GraphQL schema by itself. Instead, its schema is composed at runtime by the GraphQL Gateway,together with schemas from other services such as the User Service.

TOPIC : REQUEST ENTRY AND AUTHENTICATION:

All client requests reach this service through the Gateway.

The GateWay:

a. Validates the JWT sent by the client. b. Extracts authenticated user information. c. Injects that information into the x-user request header

The Post Service does not validate JWTs. It trusts the Gateway and reads the x-user header to build context.user . If context.user is missing,the request is treated as unauthenticated.
TOPIC : CONTEXT CREATION AND AUTHORIZATION BOUNDARY:

During request initialization:

a. The service parses x-user. b. Attaches it to context.user. c. Uses this context as the authentication boundary.

Resolvers explicitly check context.user to decide whether an operation is allowed (for example creating a post)
TOPIC: DATABASE INTERACTION:

The service connects to PostgreSQL using: (a) A secure SSL connection(trusted CA) (b) A shared connection pool

All resolvers reuse this pool,allowing efficient concurrent access while preventing connection exhaustion.
The database schema stores: (a) Post data (title,category,description) (b) A user_id foreign key (c) Soft - delete status (is_deleted) (d) Timestamps

TOPIC : Query Flow (getpostDetails)

When a query requests a post:

(a) The service fetches the post by ID. (b) Ensures it is not soft- deleted. (c) Maps database fields to GraphQL fields. (d) Returns a POST object or null if not found.

No authentication is required for reading post details.

TOPIC : MUTATION FLOW(createPost)

When a client creates a post :

Resolvers checks context.user
If unauthenticated -> throws unauthorized
Inserts a new post into the database
Associates the post with context.user.id
Returns the newly created post
Only authenticated users can create posts.

Federation and Cross - Service Linking

The post service does not fetch user data.

Instead, when a Post.user field is requested:

The resolver returns a User reference {\_typename: "User",id}
Apollo Gateway recognizes this reference
Gateway calls the User Service to resolve the actual user data
This ensures:

a. No cross - service database access b. Clear ownership boundaries c. Consistent user data system - wide

TOPIC : Error Handling and Safety

(a) Authentication failures are explicit (b) Missing data returns null (c) Database errors are not leaked directly (d) The service remains predictable and secure

END TO END MODEL

From start to finish:

Client sends request => Gateway
Gateway validates JWT => injects x-user
Post service builds context.user
Resolver enforces authentication rules.
PostgresSQL is queried via pooled connection
Post data is returned
User references are resolved via Federation
Final response is composed by Gateway
Final Takeway

The Post Service is a stateless, scalable, federated GraphQL microservice that:

(a) Owns post data (b) Relies on the Gateway for authentication (c) Uses Apollo Federation to link users (d) Avoids tight coupling with other services

This design keeps the system modular, secure and easy to revolve.
