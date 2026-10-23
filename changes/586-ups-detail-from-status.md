### Changed
- The UPS's panel now gets its load, model and runtime on mains from JagHelm's
  status, like its charge, so having it open no longer asks for the UPS's
  readings on every refresh. Its load is rounded down, as every other reading
  is. The load and the runtime on mains are at most about 5 minutes old, and
  update at once when anything else about the UPS changes, so a calm board
  isn't sent again on every refresh just for them. `/api/ups` stays as it is
  for apps already installed.
