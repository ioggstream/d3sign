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

The API is in the server  network
and is accessed by the request

```mermaid
---
id: fe
title: Front-end
---
graph

subgraph server [server d3f:Network]
request[Web Resource Access d3f:WebResourceAccess]
a[Web Application d3f:WebApplication]
api[Web API Resource d3f:WebAPIResource]
end

b -->|d3f:produces| request
%% request -->|d3f:accesses| api
a -->|d3f:manages| api
```

```mermaid
---
id: be
title: Back-end
---
graph

subgraph server [server d3f:Network]
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

%% Artifacts
subgraph client[client d3f:Network]
  password[d3f:Credential]
  account[d3f:UserAccount User Account]
end

password -->|d3f:authenticates| account
u -->|d3f:uses| account

%% Techniques
subgraph server [server  d3f:Network]
  request-validation[d3f:WebSessionActivityAnalysis Web Session Activity Analysis]
  query-sanitization[d3f:DatabaseQueryStringAnalysis Database Query String Analysis]
end

query-sanitization -->|d3f:analyzes| query
request-validation -->|d3f:analyzes| request
```

The Web Application Firewall
is then introduced to protect the API:
the direct link between
request-->api above is removed.

```mermaid
---
title: Add WAF
id: defenses
---

subgraph server
  waf[d3f:WebApplicationFirewall d3f:Endpoint-basedWebServerAccessMediation]
end

request -->|d3f:access| waf
waf -->|d3f:mediates-access-to| api
```

Add MFA to comply with "NIS2 Article 21(2)".

```mermaid
---
id: legal
title: Legally required defensive techniques
---
graph

subgraph client[client d3f:Network]
  mfa[d3f:Multi-factorAuthentication]
end
mfa -->|d3f:uses| password

```
