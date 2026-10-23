/**
 * The anchors of the places that draw an entity on the Overview (#297): each
 * place carries, as its `id`, the anchor of the entity it draws, by the status
 * model's id (docs/ARCHITECTURE.md §4.7), so a page can link to it:
 *
 *   services/<node>:<container>   a service's row in the Services section
 *                                 (OverviewServices, #300)
 *   nodes/<key>                   a node's card in the Infrastructure section
 *                                 (OverviewInfrastructure, #299), or its row
 *                                 in the table
 *
 * Issue rows led to these places until entities had URLs of their own; since
 * #309 a row opens its entity's detail (entityNav.js). The list of places
 * drawn, which the rows read, went with the old board (#306), whose panels
 * were most of them.
 */

/**
 * The anchor of the place that draws `entityId`: the id behind a prefix, every
 * character but letters, digits and `. : / -` written as `_<hex>_`, so it is a
 * valid HTML id and URL fragment, and two ids never share one.
 */
export function entityAnchor(entityId) {
  const safe = String(entityId).replace(
    /[^A-Za-z0-9.:/-]/gu,
    (c) => `_${c.codePointAt(0).toString(16)}_`
  );
  return `entity-${safe}`;
}
