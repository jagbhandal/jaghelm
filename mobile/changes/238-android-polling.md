### Changed
- The app stops refreshing while it is in the background and refreshes at once when you come back to it, so it no longer uses data and battery while closed and no longer opens on data up to one refresh old.
- Refreshes after the first load ask the server only for what changed: an unchanged service list or UPS reading comes back as a short `304 Not Modified` instead of the full data. Tapping the status bar still fetches everything.
- The countdown in the status bar now matches when the next refresh really happens, including after a slow refresh or a change to the refresh interval.
