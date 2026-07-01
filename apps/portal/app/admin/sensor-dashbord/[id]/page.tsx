'use client';

import { useParams } from 'next/navigation';
import DashbordSkjema from '@/components/sensor/DashbordSkjema';

export default function RedigerDashbordPage() {
  const params = useParams();
  return <DashbordSkjema dashbordId={String(params?.id ?? '')} />;
}
