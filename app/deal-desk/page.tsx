import { redirect } from 'next/navigation';

/**
 * Deal Desk is the investment-opportunity pipeline, which already lives at
 * `/pipeline` (sourcing → screen → diligence → IC → deploy). Route the rail's
 * "Deal Desk" entry to the real pipeline surface.
 */
export default function DealDeskPage() {
  redirect('/pipeline');
}
