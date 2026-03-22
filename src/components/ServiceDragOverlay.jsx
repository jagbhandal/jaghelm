import React from 'react';
import ServiceCard from './ServiceCard';

/**
 * ServiceDragOverlay — Visual preview shown while dragging a service card.
 * 
 * Renders a semi-transparent copy of the service card that follows the cursor.
 * Used inside dnd-kit's <DragOverlay> component.
 */
export default function ServiceDragOverlay({ service }) {
  if (!service) return null;

  return (
    <div style={{
      width: 220,
      opacity: 0.9,
      transform: 'rotate(2deg)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      borderRadius: 12,
      pointerEvents: 'none',
    }}>
      <ServiceCard
        service={service}
        showDockerStats={false}
        showAppData={false}
      />
    </div>
  );
}
