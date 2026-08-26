# My Architecture

This document describes an architecture
using multiple commented mermaid diagrams
in a single markdown file.

Each diagram has an identifier
and an optional title.

I start describing the high-level architecture with a diagram:

```mermaid
---
id: hla
title: High-level architecture
config:
  layout: elk
---
flowchart LR

client[d3f:ClientComputer]

dc-1[Data Center 1<br>d3f:Network d3f:PhysicalLocation]
dc-2[Data Center 2<br>d3f:Network d3f:PhysicalLocation]
CDN[Content Delivery Network<br>d3f:AccessMediator]

dc-1 <-->|d3f:communicates-with| dc-2

client -->|d3f:accesses| CDN
CDN -->|d3f:mediates-access-to| dc-1 & dc-2
```

This produces the following RDF graph in turtle format:

```turtle
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .

G:hla {

    G:dc-1 a d3f:Network, d3f:PhysicalLocation;
        rdfs:label "Data Center 1" .
    G:dc-2 a d3f:Network, d3f:PhysicalLocation;
        rdfs:label "Data Center 2" .
    G:dc-1 d3f:communicates-with G:dc-2 .
    G:dc-2 d3f:communicates-with G:dc-1 .
    G:client a d3f:ClientComputer .
    G:client d3f:accesses G:CDN .
    G:CDN a d3f:AccessMediator .
    G:CDN d3f:mediates-access-to G:dc-1, G:dc-2 .

}
```

Then I detail the infrastructure of
each data center application with a second diagram:

```mermaid
---
id: dc-infra
title: Data Center 1 Infrastructure
---
flowchart LR

subgraph dc-1
  dc-1-kubernetes
end

subgraph dc-1-kubernetes["Kubernetes<br>d3f:ContainerOrchestrationSoftware"]

dc-1-app[Application<br>d3f:WebApplication]
end

subgraph dc-2
  dc-2-kubernetes
end

subgraph dc-2-kubernetes["Kubernetes<br>d3f:ContainerOrchestrationSoftware"]

dc-2-app[Application<br>d3f:WebApplication]
end

IaC["Infrastructure as Code<br>d3f:CodeRepository"]

GitOps["GitOps<br>d3f:CodeRepository"]
IaC -->|d3f:configures| dc-1-kubernetes & dc-2-kubernetes

GitOps -->|d3f:configures| dc-1-app & dc-2-app
```
