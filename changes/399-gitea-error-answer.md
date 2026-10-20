### Fixed
- When Gitea answers the repository search with an error instead of a list of
  repositories (a refused or missing GITEA_TOKEN, or Gitea restarting behind a
  proxy), the server log now says so in one line with the HTTP status and the
  message Gitea sent, such as "Only signed in user is allowed to call APIs.".
  It used to log a JavaScript error instead, such as "filter is not a
  function" or "is not valid JSON". The Pipeline panel shows its Gitea banner
  as before.
