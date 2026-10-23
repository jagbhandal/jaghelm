### Changed
- The UPS's panel now gets its load, model and runtime on mains from JagHelm's
  status, like its charge, so having it open no longer asks for the UPS's
  readings on every refresh. Its load is rounded down, as every other reading
  is. On a calm board those two numbers update when anything else on the
  board changes, or when you reload the page. `/api/ups` stays as it is for
  apps already installed.
