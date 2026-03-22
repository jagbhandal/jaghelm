import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import ServiceCard from './ServiceCard';

/**
 * DraggableServiceCard — Wraps a ServiceCard to make it draggable between panels.
 * 
 * Uses dnd-kit's useDraggable hook. The drag data includes the container name
 * and source panel info so the drop handler knows where it came from.
 * 
 * Props:
 *   service        — the service object
 *   sourcePanel    — string identifying the source panel (e.g. 'node-production', 'group-abc')
 *   showDockerStats — pass through to ServiceCard
 *   showAppData     — pass through to ServiceCard
 *   disabled        — if true, card is not draggable (e.g. on mobile)
 */
export default function DraggableServiceCard({ service, sourcePanel, showDockerStats, showAppData, disabled }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `svc-${service.container}`,
    data: {
      container: service.container,
      sourcePanel,
      service,
    },
    disabled: disabled || false,
  });

  const style = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.4 : 1,
    cursor: disabled ? 'default' : 'grab',
    position: 'relative',
    zIndex: isDragging ? 1000 : 'auto',
    touchAction: 'none',
  };

  return (
    <div ref={setNodeRef} style={style} {...(disabled ? {} : { ...listeners, ...attributes })}>
      <ServiceCard
        service={service}
        showDockerStats={showDockerStats}
        showAppData={showAppData}
      />
    </div>
  );
}
