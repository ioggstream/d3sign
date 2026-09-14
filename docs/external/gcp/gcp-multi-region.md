# GCP Multi-Region Architecture

see: <https://docs.cloud.google.com/architecture/deployment-archetypes/multiregional?hl=it>

```mermaid
graph

u((d3f:User))

dns[d3f:DNSServer - Server with LB/geolocation routing policy]

subgraph GCP[gcp:Cloud - Multi-Region GCP Deployment d3f:has-locationd3f:CloudServiceProvider]
  region
  dns
end

u -->|d3f:uses| dns
```

```mermaid
---
title: GCP Multi-Region Architecture
kind: template
id: Region
root: region
config:
  layout: elk
---
graph


subgraph region[region A d3f:has-location d3f:PhysicalLocation]
  zone-a[zone A d3f:PhysicalLocation]
  zone-b[zone B d3f:PhysicalLocation]
  zone-c[zone C d3f:PhysicalLocation]
end

elb & ilb -->|d3f:has-location| region

elb[d3f:ReverseProxyServer External LB]

elb -->|d3f:accesses| fe


%% :idea:
%% d3f:Artifact -->|d3f:whatever| subgraph
%% means d3f:Artifact d3f:whatever ....
%% evaluate this pattern with examples.
%% problems may arise with subgraphs, but
%% simplifies representations.
subgraph fe
  fe-a[d3f:WebServerApplication]
  fe-b[d3f:WebServerApplication]
  fe-c[d3f:WebServerApplication]
end


fe-a & be-a -->|d3f:has-location| zone-a
fe-b & be-b -->|d3f:has-location| zone-b
fe-c & be-c -->|d3f:has-location| zone-c

ilb[d3f:ReverseProxyServer Internal LB]

subgraph be
  be-a[d3f:WebServerApplication]
  be-b[d3f:WebServerApplication]
  be-c[d3f:WebServerApplication]
end

fe -->|d3f:accesses| ilb
ilb -->|d3f:accesses| be

db[d3f:DatabaseServiceApplication]

%% Can't fan-out n x m relationships directly to avoid polluting the diagram.
be -->|d3f:accesses| db & db-standby

subgraph data
  db-standby[d3f:DatabaseServiceApplication]

  db-standby -->|d3f:copy-of| db
  db-standby -->|d3f:monitors| db
  db-standby -->|d3f:has-location| zone-a
  db -->|d3f:has-location| zone-b
end
```

This diagram reusess the above template
to replicate the infrastructure blocks on two regions.

```mermaid
graph

u -->|d3f:accesses| r0-elb & r1-elb
r0[Region A T:Region]
r1[Region B T:Region]

%% To avoid that r0 and r1 members are directly placed under GCP,
%%   we define them outside the GCP subgraph:
%%   this is how template expansion works.
%%   This allows having a nicer viz.
subgraph GCP
  r0
  r1
end

r0-db -->|d3f:copy-of| r1-db
r0-db -->|d3f:monitors| r1-db
```
