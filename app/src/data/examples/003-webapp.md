# A simple webapp

A simple web application
accessed from the client network
via a browser
producing requests to a web API.

```mermaid
---
id: client
title: Client
---
graph LR

u((User d3f:User))

subgraph client[client d3f:Network]
b[Browser d3f:Browser]
end
u -->|d3f:uses| b
```

The API is in the provider network
and is accessed by the request

```mermaid
---
id: fe
title: Front-end
---
graph

subgraph provider[provide d3f:Network]
request[Web Resource Access d3f:WebResourceAccess]
a[Web Application d3f:WebApplication]
api[Web API Resource d3f:WebAPIResource]
end

b -->|d3f:produces| request
request -->|d3f:accesses| api
a -->|d3f:manages| api
```

```mermaid
---
id: be
title: Back-end
---
graph

subgraph provider[provide d3f:Network]
  db[Database Service d3f:DatabaseService]
  query[d3f:DatabaseQuery Database Query]
end

a -->|d3f:produces| query
db -->|d3f:executes| query
```

Defensive techniques can be applied to the web application, the web API, and the database service.

```mermaid
---
id: defenses
title: Defensive techniques
---
graph

subgraph provider[provider d3f:Network]
  request-validation[d3f:WebSessionActivityAnalysis Web Session Activity Analysis]
  query-sanitization[d3f:DatabaseQueryStringAnalysis Database Query String Analysis]
end
query-sanitization -->|d3f:analyzes| query
request-validation -->|d3f:analyzes| request
```
