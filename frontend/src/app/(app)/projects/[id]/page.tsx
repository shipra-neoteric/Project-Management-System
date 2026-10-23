'use client';

import { useParams } from 'next/navigation';
import { GanttView } from '@/components/gantt/GanttView';

export default function ProjectGanttPage() {
  const { id } = useParams<{ id: string }>();
  return <GanttView projectId={id} />;
}
