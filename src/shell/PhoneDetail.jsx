/**
 * The phone's detail screens on the web (#303): Service, Node and Incident
 * detail, by the name a screen pushes. Their own chunk (lazyViews.js), loaded
 * when the first detail opens, not with the phone's first screen (#309: the
 * detail drawer shares their parts, which a phone's first load then doesn't
 * fetch).
 */
import ServiceDetail from '../phone/views/ServiceDetail.jsx';
import NodeDetail from '../phone/views/NodeDetail.jsx';
import IncidentDetail from '../phone/views/IncidentDetail.jsx';

const DETAILS = { serviceDetail: ServiceDetail, node: NodeDetail, incident: IncidentDetail };

/** The names of the details the web draws. */
export const DETAIL_SCREENS = Object.freeze(Object.keys(DETAILS));

export default function PhoneDetail({ screen, data, nav, params }) {
  const Detail = DETAILS[screen];
  return Detail ? <Detail data={data} nav={nav} params={params} /> : null;
}
