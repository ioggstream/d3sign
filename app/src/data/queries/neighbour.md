---
SELECT * WHERE {

{
  SELECT DISTINCT ?g WHERE {
    GRAPH ?g {}
    FILTER(!STRSTARTS(STR(?g), STR(K:)))
  }
}

    GRAPH ?g {
      ?this a ?class .
    }
    FILTER(!STRSTARTS(STR(?g), STR(K:)))

    {
    ?rel rdfs:subPropertyOf* d3f:d3fend-object-property .
    ?artifact rdfs:subClassOf* d3f:DigitalArtifact .
    
    { ?artifact ?rel ?class . }
    UNION
    { ?class ?rel ?artifact . }
    }
}