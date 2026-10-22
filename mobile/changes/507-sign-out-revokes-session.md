### Security
- Log out and Forget this device now end the session on the server as well as
  on the phone, so a copy of the session token stops working. Your other
  sessions, such as a browser, stay signed in. The app logs out at once, even
  when the server can't be reached. A server from before this change
  keeps the session until it expires, as before.
