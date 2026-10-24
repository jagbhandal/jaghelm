### Added
- A Docker Compose stack is now one row in the Services list, not one row per
  container: Immich is one row, not four (its server, machine learning,
  Postgres and Redis), with a "+3" chip after its name. Click it to open a side
  panel (a sheet on a phone) with the stack's status, the heartbeats and response
  time of its main container, and every container with its own state and a
  Details button. Containers with no monitor of their own fold into the stack's
  main container; one with its own monitor and web address (Collabora next to
  Nextcloud) stays a row of its own. The main container is the one named for the
  stack (Immich Server, Nextcloud), the one with a monitor first.
- The stack's row follows its worst container: with Immich's Redis down, the row
  reads "Degraded" in red or amber and says "Immich Redis is down", the Attention
  panel names the same container, and the Services tile and "N of M up" count
  stacks. The per-node container counts on Infrastructure still count each
  container, and pushes still name the container that failed.
- To change how a stack is grouped, use Set lead…, Ungroup and Split out in the
  stack's panel or in Settings → Nodes & Services (in services.yaml: `stacks:`,
  by node and Compose project). A custom group that lists a container shows that
  container as itself.
