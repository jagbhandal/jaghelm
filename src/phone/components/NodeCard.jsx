import React from 'react';
import { NodeCard as SharedNodeCard } from '@ui/node-card';

/**
 * Compact node card, drawn from the status model (#325; data/board.js
 * nodeCardsOf). Header: node name (Outfit) + subtitle (mono) + the node's
 * StatusLamp, its state and word the model's (named by the word: "Healthy",
 * "Warning", "Unreachable", "No signal"). Then its hosted services as the
 * model counts them, "4 / 5 services up · 1 down" with the down count red
 * (steel while the status is stale: `downState`), or
 * "No services" for a node that hosts none (a Proxmox host), never "0 up".
 * Then CPU + MEM + a third bar (TEMP, or DISK when the node has no
 * temperature or the model has its disk over a line, #273), each coloured by
 * the model's level for it. The detail screen shows all four. Tap →
 * onTap(nodeKey).
 *
 * The card (#303) is the shared NodeCard, as the desktop's Infrastructure
 * section draws a node (infrastructureView.js, which board.js nodeCardsOf
 * builds on): its lamp and word, a meter for each reading the model judged,
 * its reason when it isn't healthy, the hosted services and the uptime. The
 * whole card opens the node.
 */
export default function NodeCard({ node, onTap }) {
  return (
    <SharedNodeCard
      data-node={node.id}
      name={node.name}
      host={node.host}
      subtitle={node.subtitle}
      colour={node.colour}
      state={node.state}
      word={node.word}
      reason={node.reason}
      readings={node.readings}
      services={node.services}
      uptime={node.uptime}
      trend={node.trend}
      onOpen={() => onTap(node.key)}
    />
  );
}
