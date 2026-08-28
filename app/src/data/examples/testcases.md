# Test cases

The supported mermaid syntax and its RDF meaning,
one case per section. Each section feeds its first
`mermaid` block to the parser and the emitter, and
the result is snapshotted in
[app/test/snapshots](../../../test/snapshots) by
`rdf-emit.test.js`. The `turtle` block states the
expected quads for a reader; the snapshot is what
the test asserts.

The architecture behind these cases is
[ADR 0003](../../../../docs/adr/0003-diagram-to-trig.md).

## id-is-graph-name

Given

```mermaid
---
id: id-is-graph-name
title: id-is-graph-name
---
graph

%% WHEN a node without a d3f:xxx in the label
%% THEN it is not added to the RDF graph
untagged-node-skipped[Untagged node skipped]

%% GIVEN a graph with an id: frontmatter
%% WHEN a tagged node is added to the graph
%% THEN the RDF graph has an id.
webapp[Web Application<br>d3f:WebApplication]

%% GIVEN a graph with an id: frontmatter
%% WHEN a tagged node is added to the graph
%% THEN the RDF graph has an id.
token@{label: "d3f:Multi-factorAuthentication Secure Key d3f:SecurityToken", icon: "d3f:SecurityToken"}

%% GIVEN a node with a classDef in the label
%% WHEN a tagged node is added to the graph
%% THEN the CSS class information is ignored.
classDef whatever fill:none
classified[Host d3f:Image-to-ImageTranslationGAN]:::whatever
class classified whatever

```

Then

```turtle
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:id-is-graph-name {
    G:webapp a d3f:WebApplication;
        rdfs:label "Web Application" .
    G:token a d3f:Multi-factorAuthentication, d3f:SecurityToken;
        rdfs:label "Secure Key" .
    G:classified a d3f:Image-to-ImageTranslationGAN;
        rdfs:label "Host" .
}
```

## id-default-is-default

Given

```mermaid
---
title: id-default-is-default
---
graph
webapp[Web Application<br>d3f:WebApplication]
```

Then

```turtle
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:>.
G:default {
    G:webapp a d3f:WebApplication;
        rdfs:label "Web Application".
}
```

## subgraph-ignored-without-tag

Given

```mermaid
---
title: subgraph-ignored-without-tag
---
graph

subgraph subgraph-without-tag
  webapp[Web Application d3f:WebApplication]
  browser[Browser d3f:Browser]
end
```

Then

```turtle
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:>.
G:default {
    G:webapp a d3f:WebApplication;
        rdfs:label "Web Application".
    G:browser a d3f:Browser;
        rdfs:label "Browser".
}
```

## subgraph-contains-with-tag

Given

```mermaid
---
title: subgraph-contains-with-tag
---
graph

subgraph net [192.168.0.0/24 d3f:Network]
  webapp[Web Application d3f:WebApplication]
  browser[Browser d3f:Browser]
  %% Cluster is currently untagged, but
  %%   it will be added later, so it is not ignored.
  cluster
end

subgraph cluster [Cluster d3f:OrchestrationServer]
  host-1[Host 1 d3f:Host]
  host-2[Host 2 d3f:Host]
end
```

Then

```turtle
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#>.
@prefix G: <urn:d3fend-graph:>.
G:default {
    G:webapp a d3f:WebApplication;
        rdfs:label "Web Application".
    G:browser a d3f:Browser;
        rdfs:label "Browser".

    G:net a d3f:Network;
        rdfs:label "192.168.0.0/24" ;
        d3f:contains G:webapp, G:browser, G:cluster.

    G:cluster a d3f:OrchestrationServer;
        rdfs:label "Cluster" ;
        d3f:contains G:host-1, G:host-2.
    G:host-1 a d3f:Host;
        rdfs:label "Host 1".
    G:host-2 a d3f:Host;
        rdfs:label "Host 2"
}
```

## complex-node-syntax

Given

```mermaid
---
title: complex-node-syntax
---
graph

p[pre-commit d3f:Process]
p -->|d3f:runs| zizmor@{shape: process, label: "d3f:SystemVulnerabilityAssessment zizmor", icon: "d3f:DefensiveTechnique"}
```

Then

```turtle
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#>.
@prefix G: <urn:d3fend-graph:>.
G:default {
    G:zizmor a d3f:SystemVulnerabilityAssessment;
        rdfs:label "zizmor" .
    G:p a d3f:Process;
        rdfs:label "pre-commit" ;
        d3f:runs G:zizmor.
}
```

## merge-diagrams-with-same-id

Given

```mermaid
---
id: merge-me
title: merge-diagrams-with-same-id 1
---
graph

subgraph dc-1[Data Center 1 d3f:Network d3f:PhysicalLocation]
    dc-1-net[192.168.0.0/24 d3f:Network]
end
```

and

```mermaid
---
id: merge-me
title: merge-diagrams-with-same-id 2
---
graph

subgraph dc-1-net[d3f:Network]
  dc-1-vm[OpenStack d3f:VirtualizationSoftware]
end
```

Then

```trig
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:merge-me {
    G:dc-1 a d3f:Network, d3f:PhysicalLocation;
        rdfs:label "Data Center 1" .
    G:dc-1-net a d3f:Network;
        rdfs:label "Data Center 1" .
    G:dc-1-net d3f:contains G:dc-1-vm .
    G:dc-1-vm a d3f:VirtualizationSoftware;
        rdfs:label "OpenStack"
}
```

## inherit-subgraph-without-tag-1

Given

```mermaid
---
title: inherit-subgraph-without-tag-1
---
graph

subgraph net [net d3f:Network]
  %% Nested subgraph without a tag is ignored, but its children are inherited.
  subgraph padding [Untagged]
    a[Host 1 d3f:Host]
  end
end
```

Then

```trig
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:default {
    G:net a d3f:Network;
        rdfs:label "net" ;
        d3f:contains G:a .
    G:a a d3f:Host;
        rdfs:label "Host 1"
}
```

## inherit-subgraph-without-tag-2

Given

```mermaid
---
title: inherit-subgraph-without-tag-2
---
graph

subgraph net [net d3f:Network]
  %% I don't know if it's tagged or not,
  %%   so I won't ignore it unless after
  %%   parsing all the file, it turns out to be untagged.
  padding
end

subgraph padding [Untagged]
    a[Host 1 d3f:Host]
end
```

Then

```trig
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:default {
    G:net a d3f:Network;
        rdfs:label "net" ;
        d3f:contains G:a .
    G:a a d3f:Host;
        rdfs:label "Host 1"
}
```

## subgraph-with-relationships

Given

```mermaid
---
title: subgraph-with-relationships
---
graph

a[Host 1 d3f:Host]
b[Host 2 d3f:Host]

subgraph net [net d3f:Network]
  a -->|d3f:reads| b
end
```

Then

```trig
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:default {
    G:a a d3f:Host;
        rdfs:label "Host 1" .
    G:a d3f:reads G:b .
    G:b a d3f:Host;
        rdfs:label "Host 2" .
    G:net a d3f:Network;
        rdfs:label "net" ;
        d3f:contains G:a, G:b
}
```

## parse-links

Given

```mermaid
---
id: parse-links
title: parse-links
---
graph

a[Host 1 d3f:Host]
b[Host 2 d3f:Host]

a -->|d3f:reads| b

a-->|d3f:writes| b
```

Then

```trig
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:parse-links {
    G:a a d3f:Host;
        rdfs:label "Host 1" .
    G:a d3f:reads G:b .
    G:a d3f:writes G:b .
    G:b a d3f:Host;
        rdfs:label "Host 2"
}
```

## node-shape-forms

Given every mermaid node shape, plus the
`id@{key: value}` attribute form.

```mermaid
---
id: node-shape-forms
title: node-shape-forms
---
graph

%% WHEN an id is declared with no label
%% THEN it carries no d3f: class and is skipped
bare-id

rect[Rect d3f:Host]
round(Round d3f:Host)
circle((Circle d3f:Host))
subroutine[[Subroutine d3f:Host]]
cylinder[(Cylinder d3f:Host)]
stadium([Stadium d3f:Host])
rhombus{Rhombus d3f:Host}
hexagon{{Hexagon d3f:Host}}
parallelogram[/Parallelogram d3f:Host/]
parallelogram-alt[\Parallelogram alt d3f:Host\]
trapezoid[/Trapezoid d3f:Host\]
trapezoid-alt[\Trapezoid alt d3f:Host/]
flag>Flag d3f:Host]

%% WHEN shape: and icon: are given as attributes
%% THEN they drive mermaid's preview only
attrs@{label: "Attrs d3f:Host", shape: process, icon: "d3f:Host"}
```

Then the shape is dropped and every tagged id
yields the same two triples.

```trig
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:node-shape-forms {
    G:rect a d3f:Host; rdfs:label "Rect" .
    G:round a d3f:Host; rdfs:label "Round" .
    G:circle a d3f:Host; rdfs:label "Circle" .
    G:subroutine a d3f:Host; rdfs:label "Subroutine" .
    G:cylinder a d3f:Host; rdfs:label "Cylinder" .
    G:stadium a d3f:Host; rdfs:label "Stadium" .
    G:rhombus a d3f:Host; rdfs:label "Rhombus" .
    G:hexagon a d3f:Host; rdfs:label "Hexagon" .
    G:parallelogram a d3f:Host;
        rdfs:label "Parallelogram" .
    G:parallelogram-alt a d3f:Host;
        rdfs:label "Parallelogram alt" .
    G:trapezoid a d3f:Host; rdfs:label "Trapezoid" .
    G:trapezoid-alt a d3f:Host;
        rdfs:label "Trapezoid alt" .
    G:flag a d3f:Host; rdfs:label "Flag" .
    G:attrs a d3f:Host; rdfs:label "Attrs"
}
```

## edge-forms

Given the labelled-arrow forms.

```mermaid
---
id: edge-forms
title: edge-forms
---
graph

a[Host A d3f:Host]
b[Host B d3f:Host]
c[Host C d3f:Host]
d[Host D d3f:Host]

%% WHEN arrows are chained on one line
%% THEN each arrow is an edge of its own
a -->|d3f:reads| b -->|d3f:writes| c

%% WHEN endpoints are joined with &
%% THEN every source pairs with every target
a & b -->|d3f:abuses| d

%% WHEN the arrow head is a circle or a cross
%% THEN the head is style, the triple is the same
c --o|d3f:reads| d
c --x|d3f:blocks| d

%% WHEN both ends carry a head
%% THEN the triple is emitted in both directions
b <-->|d3f:related| c
a o--o|d3f:connected-to| b

%% WHEN the arrow is dotted
%% THEN the style is dropped, the triple is not
a -.->|d3f:adds| d

%% WHEN the label has no vocabulary prefix
%% THEN nothing is emitted and the banner names the label
%% (it used to be expanded to d3f:causes, which cannot tell a shorthand for a real
%%  property from prose — mta.md's |a| became the nonexistent d3f:a the same way)
a -->|causes| c
```

Then

```trig
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:edge-forms {
    G:a a d3f:Host;
        rdfs:label "Host A" .
    G:b a d3f:Host;
        rdfs:label "Host B" .
    G:c a d3f:Host;
        rdfs:label "Host C" .
    G:d a d3f:Host;
        rdfs:label "Host D" .
    G:a d3f:reads G:b .
    G:b d3f:writes G:c .
    G:a d3f:abuses G:d .
    G:b d3f:abuses G:d .
    G:c d3f:reads G:d .
    G:c d3f:blocks G:d .
    G:b d3f:related G:c .
    G:c d3f:related G:b .
    G:a d3f:connected-to G:b .
    G:b d3f:connected-to G:a .
    G:a d3f:adds G:d .
}
```

## unlabelled-arrows-dropped

Given arrows with no `|predicate|`.

```mermaid
---
id: unlabelled-arrows-dropped
title: unlabelled-arrows-dropped
---
graph

a[Host 1 d3f:Host]
b[Host 2 d3f:Host]

%% WHEN an arrow carries no predicate
%% THEN there is no triple to emit:
%%   the statement is reported as unrecognized,
%%   or dropped when it still looks like an edge.
a --> b
a --text between dashes--> b
a <--> b
```

Then only the nodes are emitted.

```trig
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:unlabelled-arrows-dropped {
    G:a a d3f:Host;
        rdfs:label "Host 1" .
    G:b a d3f:Host;
        rdfs:label "Host 2"
}
```

## back-arrows-rejected

Given arrows with a head on the left only.

```mermaid
---
id: back-arrows-rejected
title: back-arrows-rejected
---
graph

a[Host 1 d3f:Host]
b[Host 2 d3f:Host]

%% WHEN a head sits on the left and nowhere else
%% THEN the line is a mermaid syntax error:
%%   `<--`, `o--` and `x--` only open a link that
%%   a head on the right has to close. Nothing is
%%   emitted, a warning names the arrow, and the
%%   editor paints the line red.
a <--|d3f:reads| b
a o--|d3f:reads| b
a x--|d3f:reads| b
a <-- b
```

Then only the nodes are emitted.

```trig
@prefix d3f: <https://d3fend.mitre.org/ontologies/d3fend.owl#> .
@prefix G: <urn:d3fend-graph:> .
G:back-arrows-rejected {
    G:a a d3f:Host;
        rdfs:label "Host 1" .
    G:b a d3f:Host;
        rdfs:label "Host 2"
}
```
