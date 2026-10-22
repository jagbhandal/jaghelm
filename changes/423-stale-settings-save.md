### Fixed
- A Settings tab left open from before a change can no longer undo it. Saving
  Nodes or Services used to send back the whole configuration as that tab
  last read it, so an integration added, a credential stored or a node edited
  since, in another tab, in Settings → Integrations or in `services.yaml` by
  hand, was deleted. Now such a save is refused: Settings says "Settings
  changed elsewhere; reloaded" and shows what is stored, and you make your
  change again.
