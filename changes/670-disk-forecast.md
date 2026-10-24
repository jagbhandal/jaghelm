### Added
- Each node's Disk meter on the Infrastructure page and the phone's node cards
  says how many days are left before the disk fills ("12 days left"), from a
  line through the last week of disk use. It turns amber under 14 days and red
  under 3, with an icon and a word as well as the colour; Settings → Nodes &
  Services → Disk forecast moves those two lines. A disk that is flat, shrinking,
  more than a year from full, cleaned up often or without a week of history shows
  nothing, and a node that is shut down or not reporting says "No signal"
  instead of a number. It colours a number and sends no alert.
