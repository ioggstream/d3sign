# Data Pipeline

A data pipeline have data sources and data sinks.

Data is modeled as a series of artifacts
that goes from one process to another, and each process can be a data source or a data sink.

```mermaid
---
title: Data Pipeline
config:
  layout: elk
---
graph LR

d0[data d3f:DigitalEventRecord]
d1[data d3f:DigitalEventRecord]
d00[data d3f:DigitalImage]
d2[data d3f:DigitalText]

p0[d3f:Process]
p1[d3f:Process]
p2[d3f:Process]

d0 & d00 -->|d3f:accessed-by| p0
p0 -->|d3f:produces| d1
d1 -->|d3f:accessed-by| p1
p1 -->|d3f:writes| d2
d2 -->|d3f:accessed-by| p2
p2 -->|d3f:writes| storage

storage[d3f:CloudStorage]

```

Sequentiality is
described by the `d3f:precedes` property.

```mermaid
---
title: Pipeline sequence
---
graph LR

p0 -->|d3f:precedes| p1 -->|d3f:precedes| p2

```
