### Changed
- Settings opens on an index of its sections, a card each with its icon and
  a line saying what it holds: Nodes & Services, Integrations, Apps & links,
  Appearance and System. Its search finds a setting by name, not only a
  section ("font" finds Appearance), says which settings matched, and opens
  the section at the first of them. The name of a tab Settings had before
  ("widgets", "security") finds where it went, in the command palette too.
- The 13 Settings tabs are now parts of those sections, every setting as it
  was. Appearance holds what was General, Typography and Appearance, the
  weather and the clock (Widgets), the Quick Launch, Pipeline and Checklist
  switches (Sections), the temperature unit and the cards' blur (Layout).
  Nodes & Services holds Nodes, Services and the custom groups (Sections).
  Apps & links holds Tabs, Links, where links open (Layout) and the web
  search (Widgets). System holds Security, Backup and the refresh interval
  (Layout).
- An old Settings address, such as a bookmark of `/settings/links`, opens
  the section that holds it now, at the part that does.
- The temperature unit is one setting in Appearance; Layout and Widgets each
  had a copy of it.
- The Edit, Hide, Show and Try again buttons in Nodes & Services have the new
  design's look; they were unstyled.

### Removed
- The welcome message setting: nothing has shown the message since the new
  header.

### Fixed
- Backup's Choose File is a button the keyboard and screen readers reach;
  it opens the file picker as a click did.
- The data refresh slider is named by its label, so a screen reader says
  what it sets.
