## Cryptography
Blue Marble telemetry server uses a salted SHA 512 hash for user ids.
This is so user data is anonymous, even in the event of a database breach.
The user data is not anonymous if the salt is leaked...
However, all Personally Identifiable Information (PII) is destroyed after 2 hours.
Tracking users would require access to the entire server, and all data.