/**
 * Turns the RDF-derived graph model (rdf/graphModel.js) into Cytoscape elements
 * under the current filter state.
 *
 * This module knows nothing about mermaid: its whole input is the model built
 * from the store's quads, so a graph loaded as plain turtle renders exactly like
 * one that came from a diagram.
 *
 * Nodes are resolved before edges, because an edge is only drawable once both of
 * its endpoints are known to survive the node filter.
 *
 * A relation asserted in both directions between the same pair of nodes is drawn
 * once, as a single link with an arrowhead at each end, rather than as two arrows
 * facing each other.
 *
 * A folded container (docs/adr/0012-fold-container-nodes.md) stands in for its
 * whole subtree: its descendants are not emitted, and their links to the outside
 * are re-anchored onto it as *derived* edges. Folding is view state — it never
 * touches the store, so the TriG is the same folded or not.
 *
 * `viewOptions.collapseArtifactPaths` does the same for a *payload*: an artifact
 * whose whole presence in the drawn graph is one producing link in and one
 * consuming link out is not drawn, and the path through it becomes a single arrow
 * carrying its label, so a diagram that reifies HTTP requests and database
 * queries as nodes reads as message passing
 * (docs/adr/0026-collapse-artifact-mediated-paths.md). Also view state, also
 * invisible to the store.
 *
 * Returns `{ elements, stats }`, where stats reports shown-vs-total nodes and
 * links so the header chips can show the effect of the active filters.
 */

/** The end of a link the payload would have to sit on for `flowRole` to hold. */
function payloadEndOf(edge) {
  if (!edge.flowRole) return null;
  return edge.flowRole.payloadEnd === 'object' ? edge.to : edge.from;
}

/** The other end: whoever produced the payload, or whoever consumes it. */
function partyEndOf(edge) {
  return edge.flowRole.payloadEnd === 'object' ? edge.from : edge.to;
}

/**
 * Replaces `A -produces-> b -accessed-by-> C` with one arrow `A → C` carrying
 * `b`'s label, for every `b` being used as nothing but a payload.
 *
 * "Nothing but a payload" is decided structurally rather than from `rdf:type`,
 * and that is the load-bearing choice: D3FEND has no data-versus-processing
 * subtree to ask. `coreCategory === 'Artifact'` is wrong in both directions —
 * `d3f:Process`, `d3f:WebServerApplication` and `d3f:DatabaseServer` are all
 * Artifacts, while `d3f:EventLog` resolves to the Log branch and so has no core
 * category at all. A node whose entire presence in the drawn graph is one
 * producing link in and one consuming link out *is* being used as a message,
 * whatever it claims to be, and nothing is hidden by removing it because it
 * asserts nothing else. The one type check kept is a veto: an actor is never a
 * message.
 *
 * Returns `{ edges, payloads }` — the edge list with each collapsed path's two
 * legs replaced by synthetic edges, and the payload IRIs the caller must not
 * draw. A synthetic edge carries `collapsed: { payload, label, standsFor }` and
 * a predicate of `collapsed:<payload iri>`: not a real CURIE, which would claim
 * an assertion nobody made, and not null, which would make every collapsed edge
 * between one pair of nodes indistinguishable to `reselectEdge`.
 */
function collapseArtifactPaths(visibleEdges, { visibleNodes, containment, representativeOf }) {
  // Which links each node could be an endpoint of, in the role the *written*
  // predicate gives it. `other` counts every incident link that is not a leg of
  // this node's own path — including being the producer or consumer on someone
  // else's — since one is enough to refuse.
  const legsOf = new Map();
  const legsFor = (iri) => {
    let legs = legsOf.get(iri);
    if (!legs) {
      legs = { producing: [], consuming: [], other: 0 };
      legsOf.set(iri, legs);
    }
    return legs;
  };

  for (const edge of visibleEdges) {
    // A self-loop is not a hop, and counting it once per end would let a node
    // look like both the producer and the payload of the same link.
    const payloadEnd = edge.from === edge.to ? null : payloadEndOf(edge);
    for (const iri of new Set([edge.from, edge.to])) {
      if (iri === payloadEnd) legsFor(iri)[edge.flowRole.role].push(edge);
      else legsFor(iri).other += 1;
    }
  }

  const payloads = new Set();
  const consumed = new Set();
  const synthetic = [];

  for (const [iri, legs] of legsOf) {
    if (legs.other > 0) continue;
    if (!legs.producing.length || !legs.consuming.length) continue;
    // N producers × M consumers is N*M arrows for N+M links, which is only a
    // simplification when one side is single. Beyond that, draw the payload.
    if (Math.min(legs.producing.length, legs.consuming.length) !== 1) continue;

    const node = visibleNodes.get(iri);
    if (!node) continue;
    // An agent, a plan or a goal is not a message, whatever its links say.
    if (node.nodeKind === 'actors' || node.nodeKind === 'tactical') continue;
    // A payload with children would take them off screen with it. A payload with
    // a *parent* is fine: the arrow crosses the container's border and the edge
    // panel still names both real triples.
    if (containment.get(iri)?.length) continue;
    // A payload under a folded ancestor has already had its legs re-anchored onto
    // the container, so collapsing here would erase a container the path
    // demonstrably runs through.
    if (representativeOf(iri) !== iri) continue;

    const pairs = [];
    for (const producing of legs.producing) {
      for (const consuming of legs.consuming) {
        pairs.push({ producing, consuming, from: partyEndOf(producing), to: partyEndOf(consuming) });
      }
    }
    // One party on both ends — a scratch file written and read back by the same
    // process — is not a message between two parties, and drawing it as a
    // self-loop would say less than the two links do. Refuse the whole payload
    // rather than emit some of its pairs and hide the rest.
    if (pairs.some(({ from, to }) => from === to)) continue;

    const label = node.label || node.id;
    const triple = (edge) => ({ from: edge.from, predicate: edge.predicate, to: edge.to });
    for (const { producing, consuming, from, to } of pairs) {
      synthetic.push({
        from,
        to,
        predicate: `collapsed:${iri}`,
        kind: 'data-flow',
        inverse: null,
        flowRole: null,
        collapsed: { payload: iri, label, standsFor: [triple(producing), triple(consuming)] },
      });
    }
    payloads.add(iri);
    for (const edge of [...legs.producing, ...legs.consuming]) consumed.add(edge);
  }

  if (!synthetic.length) return { edges: visibleEdges, payloads };
  return { edges: [...visibleEdges.filter((edge) => !consumed.has(edge)), ...synthetic], payloads };
}

export function toCytoscapeElements(model, filterState, viewOptions = {}) {
  const { visiblePredicates, direction, visibleKinds, visibleNodeKinds, foldedNodes } = filterState;
  const { nodes, edges, containment, parentOf } = model;
  const elements = [];

  // 1. Node-kind filter. `visibleNodeKinds` may be absent when a caller passes a
  //    bare filter state, in which case nothing is filtered out.
  const visibleNodes = new Map();
  for (const [iri, node] of nodes) {
    if (!visibleNodeKinds || visibleNodeKinds.has(node.nodeKind)) visibleNodes.set(iri, node);
  }

  /** True for a node that still has at least one child left to fold away. */
  const hasVisibleChild = (iri) => Boolean(containment.get(iri)?.some((child) => visibleNodes.has(child)));

  // 2. Folds that actually apply. A folded IRI is skipped when the node filter
  //    removed it — its children must resurface, exactly as visibleParentOf makes
  //    them — or when it has no visible child left, which would draw a fold
  //    marker over nothing.
  const foldRoots = new Set();
  for (const iri of foldedNodes ?? []) {
    if (visibleNodes.has(iri) && hasVisibleChild(iri)) foldRoots.add(iri);
  }

  /**
   * Nearest ancestor that survived the filter, so a hidden container's contents
   * stay visible. The seen-set keeps a cyclic `contains` chain — legal RDF, but
   * not a legal compound hierarchy — from looping forever.
   */
  const visibleParentOf = (iri) => {
    const seen = new Set([iri]);
    let parent = parentOf.get(iri);
    while (parent !== undefined && !visibleNodes.has(parent)) {
      if (seen.has(parent)) return undefined;
      seen.add(parent);
      parent = parentOf.get(parent);
    }
    return parent;
  };

  /**
   * The node drawn in place of `iri`: its *outermost* folded ancestor, or `iri`
   * itself when no ancestor is folded. Outermost wins so that folding both :a
   * and :b in `:a contains :b contains :c` draws :c's links on :a. The walk runs
   * past unfolded ancestors, so a fold still gathers a subtree whose middle was
   * removed by the node filter. Memoised: this is called once per node and twice
   * per edge.
   */
  const representatives = new Map();
  const representativeOf = (iri) => {
    const cached = representatives.get(iri);
    if (cached !== undefined) return cached;
    let representative = iri;
    const seen = new Set([iri]);
    let ancestor = parentOf.get(iri);
    while (ancestor !== undefined && !seen.has(ancestor)) {
      seen.add(ancestor);
      if (foldRoots.has(ancestor)) representative = ancestor;
      ancestor = parentOf.get(ancestor);
    }
    representatives.set(iri, representative);
    return representative;
  };

  // How many nodes each fold hides — which is exactly the set skipped below, so it
  // needs no traversal of its own, only its own pass: a fold root can be emitted
  // before the descendants standing behind it. Transitive for free, since
  // representativeOf already resolves to the outermost fold.
  const hiddenByFold = new Map();
  for (const iri of visibleNodes.keys()) {
    const representative = representativeOf(iri);
    if (representative !== iri) hiddenByFold.set(representative, (hiddenByFold.get(representative) ?? 0) + 1);
  }

  // 3. Edges: the predicate and link-kind filters, plus both endpoints surviving.
  const visibleEdges = edges.filter(
    (e) =>
      visiblePredicates.has(e.predicate) &&
      visibleKinds.has(e.kind) &&
      visibleNodes.has(e.from) &&
      visibleNodes.has(e.to),
  );

  // 3½. Collapse artifact-mediated paths. Fed from `visibleEdges` rather than from
  //      the model, so every filter stays authoritative: hiding either leg leaves
  //      the path incomplete and the payload is drawn with its surviving link
  //      instead of vanishing. Gated on the data-flow kind because a collapse *is*
  //      a data-flow rendering — every predicate it composes is one.
  const collapsedPayloads = new Set();
  let effectiveEdges = visibleEdges;
  if (viewOptions.collapseArtifactPaths && visibleKinds.has('data-flow')) {
    const collapse = collapseArtifactPaths(visibleEdges, {
      visibleNodes,
      containment,
      representativeOf,
    });
    for (const iri of collapse.payloads) collapsedPayloads.add(iri);
    effectiveEdges = collapse.edges;
  }

  /**
   * True for a node that still has a child left *on screen* — which a collapsed
   * payload is not. Distinct from `hasVisibleChild`: that one decides which folds
   * apply, and runs before the collapse, whereas this decides whether a container
   * is still drawn as one. A container whose only child was collapsed away would
   * otherwise be an empty box with a label band.
   */
  const hasDrawnChild = (iri) =>
    Boolean(
      containment.get(iri)?.some((child) => visibleNodes.has(child) && !collapsedPayloads.has(child)),
    );

  // 3a. Re-anchor each edge onto the nodes actually drawn, and drop the ones that
  //     collapse into a single fold: a link between two children of the same
  //     folded container is the internal detail folding exists to hide.
  const anchored = [];
  for (const edge of effectiveEdges) {
    const dir = direction.get(edge.predicate) || 'forward';
    const showInverse = dir === 'inverse' && edge.inverse;
    const fromIri = showInverse ? edge.to : edge.from;
    const toIri = showInverse ? edge.from : edge.to;
    // A collapsed path is labelled with its payload, which is the fact the
    // collapse removed from the drawing. It has no inverse and its predicate is
    // synthetic, so `dir` above is always 'forward': `s` cannot flip it.
    let predicateLabel = showInverse ? edge.inverse : edge.predicate;
    if (edge.collapsed) predicateLabel = edge.collapsed.label;
    // What decides that two links are one drawing. Namespaced for a collapsed
    // path so a node labelled like a CURIE cannot land in a predicate's group.
    const groupToken = edge.collapsed ? `payload:${predicateLabel}` : predicateLabel;

    const source = representativeOf(fromIri);
    const target = representativeOf(toIri);
    if (source === target) continue;

    anchored.push({
      edge,
      source,
      target,
      predicateLabel,
      groupToken,
      fromIri,
      toIri,
      // A collapsed path is derived whether or not a fold moved its endpoints:
      // it is not a quad in the store, which is what `derived` means to the
      // stylesheet, the edge panel and go-to-source.
      derived: Boolean(edge.collapsed) || source !== fromIri || target !== toIri,
      // The same relation can be asserted in more than one visible graph, and a
      // fold can bring several child links to the same place: both land on one id.
      baseId: `${source}->${target}:${groupToken}`,
    });
  }

  // 3b. Group by that id. A group holding any re-anchored member becomes a single
  //     derived element carrying the count, since N child links to one target
  //     must not stack N identical beziers. A group of purely asserted edges
  //     keeps one element each, as the store has them, so none is silently lost.
  const groups = new Map();
  for (const item of anchored) {
    const group = groups.get(item.baseId);
    if (group) group.push(item);
    else groups.set(item.baseId, [item]);
  }

  // 3c. A relation asserted in *both* directions between the same pair is one
  //     relation to read, not two arrows to compare: it is what mermaid's `<-->`
  //     writes, and what a symmetric predicate such as d3f:connected-to normally
  //     carries. The reciprocal group is drawn into the same element — a head at
  //     each end, `bidirectional` on the data (see graphStyle.js) — and consumed
  //     so it is not also drawn on its own.
  //
  //     Only the *same* predicate pairs up. `:a d3f:reads :b` with
  //     `:b d3f:read-by :a` is one assertion written twice, not a two-way
  //     relation, and merging those would claim that :b reads :a.
  const mergedIntoReciprocal = new Set();

  let edgesShown = 0;
  for (const [baseId, group] of groups) {
    if (mergedIntoReciprocal.has(baseId)) continue;
    const [first] = group;

    const reciprocalId = `${first.target}->${first.source}:${first.groupToken}`;
    const reciprocal = groups.get(reciprocalId);
    // The label alone cannot tell two predicates apart once an inverse name is
    // drawn, so the written CURIE is what decides.
    const bothWays = Boolean(reciprocal) && reciprocal[0].edge.predicate === first.edge.predicate;
    const back = bothWays ? reciprocal : [];
    if (bothWays) mergedIntoReciprocal.add(reciprocalId);

    const common = {
      source: first.source,
      target: first.target,
      kind: first.edge.kind,
      predicate: first.edge.predicate,
      invertible: Boolean(first.edge.inverse),
    };

    if (group.some((item) => item.derived) || back.some((item) => item.derived)) {
      const foldedCount = group.length + back.length;
      const data = {
        ...common,
        id: baseId,
        // The count rides in the label rather than in the stylesheet, so
        // turning edge labels off still hides it (see graphStyle.js).
        label: foldedCount > 1 ? `${first.predicateLabel} ×${foldedCount}` : first.predicateLabel,
        derived: true,
        foldedCount,
      };
      // A group is homogeneous: a collapsed path's group token is namespaced, so
      // it can never share an id with a fold-derived link.
      if (first.edge.collapsed) {
        data.collapsed = true;
        data.payload = first.edge.collapsed.payload;
        data.payloadLabel = first.edge.collapsed.label;
        // Two triples with two *different* predicates, which is precisely what
        // foldedFrom/foldedTo cannot express: they are two endpoint sets read
        // against one predicate.
        data.standsFor = [...group, ...back].flatMap((i) => i.edge.collapsed.standsFor);
      } else {
        // What the edge really stands for, kept so the collapse is not lossy.
        // The endpoints are recorded as *drawn*, so a reciprocal member — which
        // runs the other way — contributes its `toIri` to this element's source
        // end and its `fromIri` to the target end.
        data.foldedFrom = [...new Set([...group.map((i) => i.fromIri), ...back.map((i) => i.toIri)])];
        data.foldedTo = [...new Set([...group.map((i) => i.toIri), ...back.map((i) => i.fromIri)])];
      }
      if (bothWays) data.bidirectional = true;
      elements.push({ data });
      edgesShown += 1;
      continue;
    }

    // Asserted edges keep one element each, as the store has them, so none is
    // silently lost. Pairing with the reciprocal group is therefore index-wise:
    // a relation asserted twice one way and once the other draws one two-way
    // link and one one-way link, not two of each.
    const twoWayCount = Math.min(group.length, back.length);
    const total = Math.max(group.length, back.length);
    for (let occurrence = 0; occurrence < total; occurrence += 1) {
      const forward = occurrence < group.length;
      const item = forward ? group[occurrence] : back[occurrence];
      const id = forward ? baseId : reciprocalId;
      const data = {
        ...common,
        ...(forward ? {} : { source: common.target, target: common.source }),
        id: occurrence === 0 ? id : `${id}#${occurrence}`,
        label: item.predicateLabel,
      };
      if (occurrence < twoWayCount) data.bidirectional = true;
      elements.push({ data });
      edgesShown += 1;
    }
  }

  // 4. Node elements, reparented onto the nearest surviving ancestor.
  let nodesShown = 0;
  for (const [iri, node] of visibleNodes) {
    // Drawn by a folded ancestor instead.
    if (representativeOf(iri) !== iri) continue;
    // Drawn as the label on the arrow that replaced it.
    if (collapsedPayloads.has(iri)) continue;

    const folded = foldRoots.has(iri);
    // The label goes out in parts as well as stacked, because *how much of it is
    // drawn* is a view preference: `drawnLabel` in viz/graphPrefs.js composes one
    // from the other, and the hover tooltip shows whatever it left off. The stacked
    // `label` stays the whole thing, so anything that wants a node's identity
    // rather than its drawing still has it.
    const name = node.label && node.label !== node.id ? node.label : null;
    // What the fold is standing in for, so the user can tell whether unfolding is
    // worth it without doing it. Only on a folded node: an open container has
    // nothing to report, its contents are right there.
    const hidden = hiddenByFold.get(iri) ?? 0;
    const foldNote = folded ? `▸ ${hidden} node${hidden === 1 ? '' : 's'}` : null;
    const lines = [node.id, name, node.rdfType, foldNote].filter(Boolean);

    const data = {
      id: iri,
      label: lines.join('\n'),
      displayId: node.id,
      coreCategory: node.coreCategory,
    };
    if (name) data.name = name;
    if (node.rdfType) data.rdfType = node.rdfType;
    if (foldNote) data.foldNote = foldNote;
    // The D3FEND local name of the node's first class, which is what the icon
    // set is keyed on. Resolving it to an icon is the stylesheet's job
    // (viz/graphStyle.js) — this module stays a pure view of the RDF.
    if (node.rdfType?.startsWith('d3f:')) data.typeName = node.rdfType.slice('d3f:'.length);
    // Whose plan this is, for `nodeColor` in viz/graphStyle.js — an attack is red
    // whatever branch it sits on. Set only when true, like `folded` and `foldable`.
    if (node.offensive) data.offensive = true;
    // What the context menu offers Fold/Unfold on, whether it is open or shut. A
    // container whose children were all filtered out — or all collapsed into the
    // arrows that carried them — is no longer a container.
    if (hasDrawnChild(iri)) data.foldable = true;
    // A folded container draws as a plain node: dropping isContainer takes the
    // label band, the compound styling and ELK's reserved padding with it.
    if (folded) data.folded = true;
    else if (data.foldable) data.isContainer = true;
    const parent = visibleParentOf(iri);
    if (parent !== undefined) data.parent = parent;

    elements.push({ data });
    nodesShown += 1;
  }

  return {
    elements,
    // Counted from what was emitted, not from what survived the filters, so the
    // chips report the folded picture the user is looking at.
    stats: {
      nodesShown,
      nodesTotal: nodes.size,
      edgesShown,
      edgesTotal: edges.length,
    },
  };
}
