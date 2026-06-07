import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Deal Desk' },
  description: 'The investment-opportunity pipeline — sourcing to screen, diligence to deploy.'
};

/**
 * Deal Desk is the investment-opportunity pipeline, which already lives at
 * `/pipeline` (sourcing → screen → diligence → IC → deploy). Route the rail's
 * "Deal Desk" entry to the real pipeline surface.
 */
export default function DealDeskPage() {
  redirect('/pipeline');
}
