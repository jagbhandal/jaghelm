### Fixed
- When Gitea answers the repository search with an error instead of a list of
  repositories (a refused or missing GITEA_TOKEN, or Gitea restarting behind a
  proxy), the server log now says so in one line with the HTTP status and the
  message Gitea sent, such as "Only signed in user is allowed to call APIs.".
  It used to log a JavaScript error instead, such as "filter is not a
  function" or "is not valid JSON". The Pipeline panel shows its Gitea banner
  as before.
- When Gitea answers the repository search but every request for a
  repository's commits fails (Gitea restarting in between, or a proxy page
  instead of JSON), the Pipeline panel shows its Gitea banner and the server
  log says why in one line. It used to show an empty list with nothing logged.
  When only some of those requests fail, the other repositories are still
  listed, as before.
### Security
- When GITEA_URL contains a user name and password, the line the server logs
  when it cannot reach Gitea no longer includes the password. Node refuses
  such a URL, and its error message, which named the full URL, was logged
  every refresh. The token and URL credentials are now taken out of every
  Gitea error the server logs.
