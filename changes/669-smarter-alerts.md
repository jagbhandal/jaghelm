### Added
- A burst of alerts now arrives as one push, such as "5 services down on apps", instead of one per service. Alerts within a minute of the first are grouped (Settings → Notifications → Alert rules: 30 seconds to 5 minutes, or off); a lone alert still goes out as itself, never later than that.
- A notification has Snooze 1h and Ack buttons. Snooze silences that alert for an hour; Ack silences its repeats until it recovers. Both survive a restart, and Settings lists what is silenced with a Lift button to hear about it again.
- Quiet hours (Settings → Notifications): pick the hours (Toronto time) and whether critical alerts still ring or nothing does. What is held arrives as one "While you were away" summary when the quiet hours end.
- Known causes: name a pattern and a label, such as "omada" and "AP auto-upgrade reboot", and a matching alert carries the label on its push and on the Alerts page. An install that never set any starts with that Omada one.
