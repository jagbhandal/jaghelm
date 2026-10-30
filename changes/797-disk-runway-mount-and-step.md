### Fixed
- Disk runway names the mount and its size on every row ("nas /ugreen, 4.2 GB"), and a node whose fullest mount is not its main data volume now also shows that volume as its own row. The Infrastructure and phone node cards name the size too.
- A single step up in disk use (one install or update on a small partition, flat before and after) is no longer read as steady growth with a made-up fill date; the forecast starts after the step.
